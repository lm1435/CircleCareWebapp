import { describe, expect, it } from 'vitest';
import enHelp from '../en/help.json';
import frHelp from '../fr/help.json';
import frCAHelp from '../fr-CA/help.json';
import esHelp from '../es/help.json';
import deHelp from '../de/help.json';
import itHelp from '../it/help.json';
import ptHelp from '../pt/help.json';
import ptPTHelp from '../pt-PT/help.json';
import enProfile from '../en/profile.json';
import frProfile from '../fr/profile.json';
import frCAProfile from '../fr-CA/profile.json';
import esProfile from '../es/profile.json';
import deProfile from '../de/profile.json';
import itProfile from '../it/profile.json';
import ptProfile from '../pt/profile.json';
import ptPTProfile from '../pt-PT/profile.json';

type Help = { sections: { notifications: { items: Array<{ answer: string }> } } };
type Profile = { notifications: { groups: { shifts: string } } };

// The Help FAQ describes the notification groups on Profile: there are FIVE now
// (Shifts is the fifth), in the same words mobile uses.
const LOCALES: Array<[string, Help, Profile]> = [
  ['en', enHelp as Help, enProfile as unknown as Profile],
  ['es', esHelp as Help, esProfile as unknown as Profile],
  ['fr', frHelp as Help, frProfile as unknown as Profile],
  ['fr-CA', frCAHelp as Help, frCAProfile as unknown as Profile],
  ['de', deHelp as Help, deProfile as unknown as Profile],
  ['it', itHelp as Help, itProfile as unknown as Profile],
  ['pt', ptHelp as Help, ptProfile as unknown as Profile],
  ['pt-PT', ptPTHelp as Help, ptPTProfile as unknown as Profile],
];

describe('help FAQ: notification groups', () => {
  it.each(LOCALES)('%s names the Shifts group and counts five', (_code, help, profile) => {
    const items = help.sections.notifications.items;
    expect(items[1].answer).toContain(profile.notifications.groups.shifts);
    expect(items[3].answer).not.toBe('');
  });

  it('en says five groups and five switches, never four', () => {
    const items = enHelp.sections.notifications.items;
    expect(items[1].answer).toMatch(/five groups/);
    expect(items[1].answer).toContain('Shifts (new open shifts');
    expect(items[3].answer).toMatch(/five switches/);
    expect(JSON.stringify(enHelp)).not.toMatch(/four (groups|switches)/);
  });
});
