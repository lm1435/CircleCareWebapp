import fs from 'node:fs';
import type { FullConfig } from '@playwright/test';
import { databaseIsReachable, nonLocalDbTargetReasons, nonLocalTargetAllowed } from './db';
import { purgeRun, runDir, runNeedsIsolation, selectedProjectNames } from './isolation';
import { currentRunId } from './runId';
import { purgeRunMail } from './unhappy';

/**
 * Remove THIS RUN's isolated accounts (worker slots, the read-only account,
 * every lazily-provisioned persona and every run-scoped signup address) and
 * everything they own. Other runs' accounts are never touched — a concurrent
 * run is still using its own.
 *
 * Playwright runs globalTeardown after the run whether it passed, failed or was
 * cut short by --max-failures, so this is the deterministic half of the
 * teardown contract: even a spec that dies mid-mutation leaves nothing behind,
 * because the whole account it was mutating goes away. A run that is KILLED
 * (no teardown) is swept by a later run's globalSetup once it is stale.
 *
 * Teardown never throws: a cleanup failure must not turn a green run red (and a
 * red run's real cause must not be buried under a cleanup stack trace). It warns
 * instead.
 */
async function globalTeardown(config: FullConfig): Promise<void> {
  try {
    // Mirror globalSetup: an a11y-only run provisioned nothing, so it must not
    // touch (or require) a database on the way out either.
    if (!runNeedsIsolation(selectedProjectNames(config.projects.map((p) => p.name)))) return;
    const runId = currentRunId();

    // Same local-only guard as globalSetup, BEFORE the hard-deleting purge.
    // A refusal is a warning here, not a throw (see above) — globalSetup has
    // already refused the same target, so nothing was provisioned to remove.
    const nonLocal = nonLocalDbTargetReasons();
    if (nonLocal.length > 0 && !nonLocalTargetAllowed()) {
      // eslint-disable-next-line no-console
      console.warn(
        `[e2e isolation] teardown REFUSED to purge a non-local target: ${nonLocal.join('; ')}`
      );
      return;
    }

    if (databaseIsReachable()) {
      const removed = await purgeRun(runId);
      // eslint-disable-next-line no-console
      console.log(`[e2e isolation] run ${runId} torn down: ${removed} account(s) and their circles removed`);
    }
    await purgeRunMail(runId).catch(() => undefined);
    if (process.env.PW_KEEP_RUN_DIR !== '1') {
      fs.rmSync(runDir(runId), { recursive: true, force: true });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[e2e isolation] teardown could not complete:', err);
  }
}

export default globalTeardown;
