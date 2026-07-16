import type { AlignItems, FlexSize, FlexStyle, Percent } from './types';
/** Returns true when a size value is a percentage string. */
export declare function isPercent(value: unknown): value is Percent;
/**
 * Resolve a FlexSize to an absolute texel value.
 * - number  → returned as-is
 * - Percent → (n / 100) * parentSize
 * - undefined / 'auto' → undefined (caller decides the fallback)
 */
export declare function resolveSize(value: FlexSize | 'auto' | undefined, parentSize: number): number | undefined;
export interface ResolvedEdges {
    top: number;
    right: number;
    bottom: number;
    left: number;
}
/**
 * Resolve padding shorthand to individual edges (texels).
 * Priority: individual side > shorthand `padding`.
 *
 * Per CSS, percentage padding resolves against the parent's content-box width
 * for ALL four sides (yes, even top/bottom). Caller must pass that base.
 */
export declare function resolvePadding(style: FlexStyle, parentWidth: number): ResolvedEdges;
/**
 * Resolve margin shorthand to individual edges (texels).
 * Priority: individual side > shorthand `margin`.
 *
 * Per CSS, percentage margin resolves against the parent's content-box width
 * for ALL four sides. Caller must pass that base.
 */
export declare function resolveMargin(style: FlexStyle, parentWidth: number): ResolvedEdges;
/**
 * Return the gap between items on the row axis (horizontal between siblings).
 * Percent values resolve against the container's own content-box width.
 */
export declare function resolveRowGap(style: FlexStyle, containerWidth: number): number;
/**
 * Return the gap between items on the column axis (vertical between siblings).
 * Percent values resolve against the container's own content-box height.
 */
export declare function resolveColumnGap(style: FlexStyle, containerHeight: number): number;
/**
 * Return the effective flex-grow value for an item.
 * `flex` shorthand sets flex-grow when `flexGrow` is not explicitly set.
 */
export declare function resolveFlexGrow(style: FlexStyle): number;
/**
 * Return the effective flex-shrink value for an item.
 *
 * CSS default is 1 (items shrink to fit). We follow the same default so that
 * overflow is automatically distributed; opt out with `flexShrink: 0`.
 */
export declare function resolveFlexShrink(style: FlexStyle): number;
/**
 * The main-axis BASIS (px) a flex item grows/shrinks from — the floor the parent
 * reserves before distributing free space. `measuredMain` is the item's already-laid-out
 * main-axis size (its content/explicit size).
 *
 * CSS `flex: 1` is shorthand for `flex: 1 1 0%` — a grown item starts from basis 0, so
 * equal-grow siblings end EQUAL regardless of their content width. Without this, two
 * `flex: 1` items grow from their own content sizes and stay unequal (e.g. two labeled
 * form fields whose captions differ in width). So: an item with an explicit grow and no
 * explicit `flexBasis` gets basis 0; an explicit numeric `flexBasis` wins; otherwise the
 * basis is the measured size (`flex-basis: auto`).
 */
export declare function resolveFlexBasisMain(style: FlexStyle, measuredMain: number): number;
/**
 * Return the effective alignment for a child, respecting `alignSelf` override.
 * Falls back to the parent's `alignItems` when alignSelf is 'auto' or not set.
 */
export declare function resolveAlignSelf(childStyle: FlexStyle, parentAlignItems: AlignItems): AlignItems;
