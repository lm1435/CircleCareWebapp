import { createContext, useContext } from 'react';

/**
 * Which in-page control opened the New menu, carried to the form the menu then opens
 * (`entry_form_opened.entry`). Omitted = the nav's own New (`add_menu`).
 */
export type AddMenuEntry = 'header' | 'list_button' | 'empty_state';

export interface OpenAddMenuOptions {
  entry?: AddMenuEntry;
}

export interface AddMenuContextValue {
  openAddMenu: (options?: OpenAddMenuOptions) => void;
}

/**
 * Lets a page under AppLayout open the SAME New menu the nav's New owns (mobile twin:
 * mobile/src/navigation/AddMenuContext.ts). Calendar's header "+", its in-page "Add event" and
 * its empty-state CTAs open it (owner 2026-11-08), instead of a page-local form.
 */
export const AddMenuContext = createContext<AddMenuContextValue>({
  openAddMenu: () => {},
});

export function useAddMenu(): AddMenuContextValue {
  return useContext(AddMenuContext);
}
