import { type Player } from '@minecraft/server';
import { ModalFormData, type ModalFormResponse } from '@minecraft/server-ui';
/**
 * Adds the control(s) to a freshly-created `ModalFormData`. Typically adds a
 * single control (text field, dropdown, slider, …) for an input-like component.
 */
export type ModalFormBuilder = (form: ModalFormData) => void;
/**
 * Optional chrome for the modal opened by {@link showModalForm}.
 *
 * Note: `ModalFormData` has no `body()` in `@minecraft/server-ui` v2 — `body`
 * is rendered as a leading `label` line above the control(s).
 */
export interface ShowModalFormOptions {
    /** Modal title. */
    title?: string;
    /** Descriptive text shown above the control(s) (rendered as a label). */
    body?: string;
    /** Text for the confirm/submit button. */
    submitLabel?: string;
}
/**
 * Build & show a single-control `ModalFormData` from inside an ActionForm button
 * callback, returning the player's response. The runtime owns this "open the
 * sub-form, return to the system" transition: it is invoked while the presenter's
 * interactive transaction is active, so background logic passes stay suppressed
 * for the whole modal lifetime, and the root ActionForm re-presents afterward.
 *
 * @param player - Player to show the modal to.
 * @param build - Adds the control(s) to the form.
 * @param opts - Optional title / body / submit-button text.
 * @returns The modal response (`canceled` + `formValues`).
 */
export declare function showModalForm(player: Player, build: ModalFormBuilder, opts?: ShowModalFormOptions): Promise<ModalFormResponse>;
