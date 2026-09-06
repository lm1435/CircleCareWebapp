// Single dynamic-import entry point for the Spanish locale.
//
// Every es/*.json namespace is imported HERE (not from `../index.ts`) so Vite
// bundles them into exactly one chunk that only downloads when a session
// actually needs Spanish (browser-detected on first load, or a mid-session
// `i18n.changeLanguage('es')`) — see the `read()` in `../index.ts`, which is
// the only caller of `import('./es/index')`. English never pays for this
// chunk: `en` ships eagerly in the main bundle instead.
import common from './common.json';
import auth from './auth.json';
import overview from './overview.json';
import calendar from './calendar.json';
import tasks from './tasks.json';
import notes from './notes.json';
import meds from './meds.json';
import activity from './activity.json';
import emergency from './emergency.json';
import documents from './documents.json';
import members from './members.json';
import invite from './invite.json';
import vitals from './vitals.json';
import profile from './profile.json';
import circles from './circles.json';
import ai from './ai.json';
import help from './help.json';
import freemium from './freemium.json';
import upgrade from './upgrade.json';

const esResources = {
  common,
  auth,
  overview,
  calendar,
  tasks,
  notes,
  meds,
  activity,
  emergency,
  documents,
  members,
  invite,
  vitals,
  profile,
  circles,
  ai,
  help,
  freemium,
  upgrade,
};

export default esResources;
