import { medicationsSummaryText } from '../medicationsSummary';

const sch = { asNeeded: false };
const prn = { asNeeded: true };

describe('medicationsSummaryText (Meds tab summary line)', () => {
  it('none', () => {
    expect(medicationsSummaryText([])).toEqual({ key: 'meds:page.summary.none' });
  });
  it('scheduled only carries the count for the plural', () => {
    expect(medicationsSummaryText([sch])).toEqual({
      key: 'meds:page.summary.scheduled',
      options: { count: 1 },
    });
    expect(medicationsSummaryText([sch, sch, sch]).options).toEqual({ count: 3 });
  });
  it('mixed', () => {
    expect(medicationsSummaryText([sch, sch, prn])).toEqual({
      key: 'meds:page.summary.mixed',
      options: { count: 2, scheduled: 2, asNeeded: 1 },
    });
  });
  it('as-needed only', () => {
    expect(medicationsSummaryText([prn, prn])).toEqual({
      key: 'meds:page.summary.asNeededOnly',
      options: { asNeeded: 2 },
    });
  });
});
