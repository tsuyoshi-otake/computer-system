import { type Player } from '@minecraft/server';
import type { JSX } from '../../../jsx';
import { type PresentResult } from './shared';
/**
 * Present one snapshot of an ordinary (ActionForm) tree.
 *
 * Encodes the scroll geometry into the form title (v0007 protocol), serializes the
 * tree into `button()` / `label()` slots, and shows it. A button press dispatches the
 * recorded `onPress` through {@link runInteractiveCallback}; ESC tears the session
 * down.
 *
 * @param player - Player to show the form to.
 * @param tree - Built tree (no `modal-form` marker).
 * @returns Whether to re-present, clean up, or do nothing.
 */
export declare function presentAction(player: Player, tree: JSX.Element): Promise<PresentResult>;
