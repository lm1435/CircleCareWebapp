import { firstRunActionRoute } from '../firstRunActionRoute';

const ctx = { circleId: 'circle-1' };

describe('firstRunActionRoute', () => {
  it('swaps in the event form for an appointment', () => {
    expect(firstRunActionRoute('appointment', ctx)).toEqual({
      scope: 'modal',
      modal: 'appointment',
    });
  });

  it('swaps in the invite modal', () => {
    expect(firstRunActionRoute('invite', ctx)).toEqual({ scope: 'modal', modal: 'invite' });
  });

  it('navigates to emergency info, which is a page and not a modal', () => {
    expect(firstRunActionRoute('emergency', ctx)).toEqual({
      scope: 'navigate',
      to: '/circles/circle-1/emergency',
    });
  });

  /**
   * `skip` is routed rather than short-circuited in the caller: the wizard
   * records `first_run_skipped` and then FALLS THROUGH to this dispatch, so
   * closing early there would leave this branch unreachable — dead code reading
   * as live routing.
   */
  it('closes on skip', () => {
    expect(firstRunActionRoute('skip', ctx)).toEqual({ scope: 'close' });
  });

  it('never navigates away from the circle it was given', () => {
    const route = firstRunActionRoute('emergency', { circleId: 'other-circle' });
    expect(route).toMatchObject({ to: expect.stringContaining('other-circle') });
  });
});
