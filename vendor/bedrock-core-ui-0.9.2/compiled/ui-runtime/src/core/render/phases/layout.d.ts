import type { JSX } from '../../../jsx';
/**
 * Phase 2 of the render pipeline: compute layout for the full JSX element tree.
 *
 * There is ALWAYS a main scroll (index 0) = the whole tree laid out full-screen, with
 * each `<Scroll>` treated as a leaf box (its viewport rect comes from the normal flow).
 * Each `<Scroll>` then becomes an additional scroll (index 1+): its content is laid out
 * region-locally inside its viewport rect. Per-scroll `{ axis, x, y, width, height,
 * extent }` is written to `tree.props.jsonUIScrolls` (index 0 = main) for the presenter.
 *
 * @param tree Root JSX element after Phase 1 (function components expanded).
 * @returns The same element tree, mutated in-place with layout values.
 */
export declare function computeLayout(tree: JSX.Element): JSX.Element;
