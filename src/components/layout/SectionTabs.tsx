import type { ReactElement } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { SegmentedControl, type SegmentedControlOption } from '@/components/ui';

/**
 * The Care/Health section switcher (spec §5.3; mobile's Care/Health top tab
 * bars) — `CareTabs` and `HealthTabs` are three-line wrappers over this,
 * supplying only their label and options (K3: they were byte-identical
 * otherwise).
 *
 * Below 1024px the FloatingNavBar's CARE/HEALTH cells only reach one page
 * each; this is how the other pages in that group are reached. From `xl` up
 * the sidebar lists every page, so the control is hidden rather than
 * duplicated.
 *
 * It reads the route itself (rather than taking a `value` prop) so every page
 * mounts it identically — `<PageMasthead>…<CareTabs /></PageMasthead>`.
 *
 * L2 — focus-across-remount: `SegmentedControl.onChange` navigates, and
 * `AppLayout` keys the routed subtree by `pathname` (so a caught render error
 * clears on navigation, and so does an in-progress page transition), which
 * remounts this component on every tab switch. A click-driven switch loses
 * nothing (a mouse doesn't care), but an arrow-key switch would otherwise
 * strand focus on `<body>` the instant the old `SegmentedControl` unmounts —
 * this module-level flag survives that remount to say "the next instance's
 * selected segment should re-claim focus", consumed exactly once so a
 * same-route re-render (no remount) doesn't keep re-focusing.
 */
let pendingTabFocus = false;

function consumePendingTabFocus(): boolean {
  const focus = pendingTabFocus;
  pendingTabFocus = false;
  return focus;
}

export interface SectionTabsProps {
  /** Accessible name for the tablist (there is no visible label). */
  label: string;
  options: SegmentedControlOption[];
}

export function SectionTabs({ label, options }: SectionTabsProps): ReactElement | null {
  const { circleId } = useParams<{ circleId: string }>();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  if (!circleId) return null;

  const current = pathname.split('/').filter(Boolean)[2] ?? '';

  // `pb-3`: the tab strip is the masthead's last row, and the page's first
  // control (the calendar's date nav, the task filters) follows it with little
  // or no top spacing of its own — without this the two touched.
  return (
    <div className="px-5 pb-3 pt-1 xl:hidden">
      <SegmentedControl
        label={label}
        value={current}
        focusOnMount={consumePendingTabFocus()}
        onChange={(value, meta) => {
          if (meta?.viaKeyboard) pendingTabFocus = true;
          navigate(`/circles/${circleId}/${value}`);
        }}
        options={options}
      />
    </div>
  );
}
