/**
 * LIVE EXAMPLE of the per-locale twin (also guards the harness itself): the same harness a
 * language lane uses, run for `es`, with its OWN file snapshot. Not a copy of
 * activityTranslationSnapshotLock.test.ts (that file stays frozen and untouched).
 */
import { defineActivityLocaleTwin } from './helpers/activityLocaleTwin';

const LOCALE = 'es';
defineActivityLocaleTwin(LOCALE);
