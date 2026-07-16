import { type Player } from '@minecraft/server';
import { type FormConfig } from '../../../components/Form';
import type { JSX } from '../../../jsx';
import type { ScrollMetrics } from '../../serializer';
/**
 * Outcome of presenting one form snapshot:
 * - `'present'` — re-render immediately (a callback requested another snapshot).
 * - `'cleanup'` — tear the session down (ESC / dismissal / programmatic exit).
 * - `'none'`    — player dismissed with no callback; do nothing.
 */
export type PresentResult = 'present' | 'cleanup' | 'none';
/**
 * Find the `modal-form` marker on the built tree and return its config, or
 * `undefined` if the tree is an ordinary ActionForm tree. The marker is transparent,
 * so it sits a couple of provider levels below the root — walk children until found.
 *
 * @param node - Tree node to search from (typically the built root).
 * @returns The Form config when a modal tree, else `undefined`.
 */
export declare function findModalConfig(node: JSX.Node): FormConfig | undefined;
/**
 * Find the first `<Background>` marker on the built tree and return its texture
 * path, or `''` when the tree declares none. Mirrors {@link findModalConfig}: the
 * marker is transparent and may sit anywhere (ActionForm root level or inside a
 * `<Form>`), so walk the whole tree depth-first — first one wins.
 *
 * @param node - Tree node to search from (typically the built root).
 * @returns The backdrop texture path, or `''`.
 */
export declare function findBackground(node: JSX.Node): string;
/**
 * Run a form callback inside an interactive transaction (background logic passes
 * suppressed for its lifetime), then decide whether the session should re-present or
 * tear down. Shared by both the ActionForm button path and the modal submit/cancel
 * path so the transaction + cleanup semantics stay identical.
 *
 * @param player - Player whose session the callback runs against.
 * @param callback - The form callback (`onPress` / `onSubmit` / `onCancel`).
 * @returns `'cleanup'` if a fiber requested exit during the callback, else `'present'`.
 */
export declare function runInteractiveCallback(player: Player, callback: () => unknown | Promise<unknown>): Promise<PresentResult>;
/**
 * Read the per-scroll geometry the layout pass surfaced on the tree (one
 * `{ axis, x, y, width, height, extent }` per scroll, index 0 is the root scroll) and
 * sanitize it. Falls back to a single full-screen vertical scroll if the tree produced
 * nothing usable, so the RP always receives at least the root scroll. Consumes (deletes)
 * the transient `jsonUIScrolls` / `jsonUIHeight` props off the root.
 *
 * Shared by both presenters: the ActionForm and the native modal use the IDENTICAL
 * title-encoded scroll-geometry protocol (v0007) so a label-only tree sizes the same in
 * both — the modal repurposes its native title for this metadata (it has no separate
 * user title; a heading is authored as a `<Text>`).
 */
export declare function resolveScrolls(tree: JSX.Element): ScrollMetrics[];
