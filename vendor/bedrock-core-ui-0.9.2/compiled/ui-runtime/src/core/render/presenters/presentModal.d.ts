import { type Player } from '@minecraft/server';
import { type FormConfig } from '../../../components/Form';
import type { JSX } from '../../../jsx';
import { type PresentResult } from './shared';
/**
 * Present one snapshot of a modal `<Form>` tree as a native `ModalFormData`.
 *
 * The modal is atomic: every field is added up front (via each control's `build`
 * callback during {@link serialize}), the form is shown once, and nothing comes back
 * until the player submits — at which point the positional `formValues` are re-keyed
 * by each control's `name` (recorded by ordinal in the serialize walk) into a single
 * result object handed to `config.onSubmit`. Dismissal calls `config.onCancel`.
 *
 * Submit/cancel run through the same interactive-transaction + re-present/cleanup path
 * as the ActionForm button callbacks, so background logic stays suppressed for the
 * callback and the session tears down (or re-presents) on the same rules.
 *
 * @param player - Player to show the modal to.
 * @param tree - Built tree containing the `modal-form` marker.
 * @param config - Chrome + lifecycle read off the marker.
 * @returns Whether to re-present, clean up, or do nothing.
 */
export declare function presentModal(player: Player, tree: JSX.Element, config: FormConfig): Promise<PresentResult>;
