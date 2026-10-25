/**
 * "Manager" only ever means the circle-manager role (1.3.0). The member who gets
 * the care recipient's medication reminders is "Medication reminders" (badge
 * "Med reminders"). Owner decision 2026-10-24, option A.
 */
import fs from 'fs';
import path from 'path';
import en from '../en/members.json';
import es from '../es/members.json';

const root = path.join(__dirname, '..');
const OLD = /medication manager|manages medication|gère les rappels|administra los recordatorios|encargado de medicamentos|gestisce i promemoria|gerencia os lembretes|gere os lembretes|verwaltet medikamentenerinnerungen/i;

describe('medication reminders wording', () => {
  it('no locale still calls the reminders member a "medication manager"', () => {
    for (const lang of fs.readdirSync(root).filter((n) => fs.statSync(path.join(root, n)).isDirectory() && n !== '__tests__')) {
      for (const f of fs.readdirSync(path.join(root, lang)).filter((n) => n.endsWith('.json'))) {
        const text = fs.readFileSync(path.join(root, lang, f), 'utf8');
        expect({ lang, f, hit: OLD.test(text) }).toEqual({ lang, f, hit: false });
      }
    }
  });

  it('has no separate clear item any more', () => {
    expect((en.manage as Record<string, string>).clearMedResponsible).toBeUndefined();
  });

  it('pins the EN and ES labels and toasts', () => {
    expect(en.manage.medReminders).toBe('Medication reminders');
    expect(en.list.medResponsible).toBe('Med reminders');
    expect(en.manage.medResponsibleSet).toBe("{{name}} now gets {{recipientName}}'s medication reminders.");
    expect(en.manage.medResponsibleCleared).toBe('Medication reminders go back to {{recipientName}}.');
    expect(es.manage.medReminders).toBe('Recordatorios de medicamentos');
    expect(es.list.medResponsible).toBe('Recordatorios');
  });
});
