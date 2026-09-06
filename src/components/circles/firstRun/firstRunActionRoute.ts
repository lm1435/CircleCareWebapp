export type FirstRunAction = 'medication' | 'appointment' | 'invite' | 'emergency' | 'skip';

/** The in-place modals the wizard can hand off to. */
export type FirstRunModal = 'appointment' | 'invite' | 'fullForm';

export type FirstRunRoute =
  /** Swap the wizard for an existing modal, on the page it is already mounted over. */
  | { scope: 'modal'; modal: FirstRunModal }
  /** Leave for a full page. */
  | { scope: 'navigate'; to: string }
  /** Dismiss the wizard and stay on the circle overview it is mounted over. */
  | { scope: 'close' };

/**
 * Where screen ①'s non-medication actions go.
 *
 * `medication` is absent on purpose: it advances the wizard rather than
 * dispatching, so it has no route. A pure descriptor for the same reason mobile
 * keeps one — the mapping is assertable without a router, and the wizard gets a
 * single dispatch point instead of four scattered branches.
 *
 * WEB DIFFERS FROM MOBILE IN ONE STRUCTURAL WAY, and it is what makes this
 * simpler rather than harder. Mobile's destinations are SCREENS it must push
 * onto a stack — which is why its descriptor carries a `scope` naming WHICH
 * navigator, and why it resets the stack first so the wizard cannot survive the
 * action it dispatched. Two of web's three destinations are MODALS
 * (`AddEventModal`, `InviteMemberModal`) that already live on the circle, so the
 * wizard simply swaps itself for one in place: nothing is pushed, so nothing can
 * be left behind for the user to come back to. Only Emergency Info is a page.
 *
 * `skip` maps to `{ scope: 'close' }` because the wizard is already mounted over
 * the circle overview — mobile resets to CircleDetail to reach the same place
 * from a full-screen modal.
 */
export function firstRunActionRoute(
  action: Exclude<FirstRunAction, 'medication'>,
  ctx: { circleId: string }
): FirstRunRoute {
  switch (action) {
    case 'appointment':
      return { scope: 'modal', modal: 'appointment' };
    case 'invite':
      return { scope: 'modal', modal: 'invite' };
    case 'emergency':
      return { scope: 'navigate', to: `/circles/${ctx.circleId}/emergency` };
    case 'skip':
      return { scope: 'close' };
  }
}
