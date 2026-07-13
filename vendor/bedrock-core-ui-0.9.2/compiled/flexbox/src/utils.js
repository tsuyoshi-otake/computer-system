/** Returns true when a size value is a percentage string. */
export function isPercent(value) {
    return typeof value === 'string' && (value).endsWith('%');
}
/**
 * Resolve a FlexSize to an absolute texel value.
 * - number  → returned as-is
 * - Percent → (n / 100) * parentSize
 * - undefined / 'auto' → undefined (caller decides the fallback)
 */
export function resolveSize(value, parentSize) {
    if (value === undefined || value === 'auto') {
        return undefined;
    }
    if (typeof value === 'number') {
        return value;
    }
    return (parseFloat(value) / 100) * parentSize;
}
/**
 * Resolve a single Spacing value (number or percent) to absolute texels.
 * Returns 0 when undefined.
 */
function resolveSpacing(value, base) {
    if (value === undefined) {
        return 0;
    }
    if (typeof value === 'number') {
        return value;
    }
    return (parseFloat(value) / 100) * base;
}
/**
 * Resolve padding shorthand to individual edges (texels).
 * Priority: individual side > shorthand `padding`.
 *
 * Per CSS, percentage padding resolves against the parent's content-box width
 * for ALL four sides (yes, even top/bottom). Caller must pass that base.
 */
export function resolvePadding(style, parentWidth) {
    const base = style.padding;
    return {
        top: resolveSpacing(style.paddingTop ?? base, parentWidth),
        right: resolveSpacing(style.paddingRight ?? base, parentWidth),
        bottom: resolveSpacing(style.paddingBottom ?? base, parentWidth),
        left: resolveSpacing(style.paddingLeft ?? base, parentWidth),
    };
}
/**
 * Resolve margin shorthand to individual edges (texels).
 * Priority: individual side > shorthand `margin`.
 *
 * Per CSS, percentage margin resolves against the parent's content-box width
 * for ALL four sides. Caller must pass that base.
 */
export function resolveMargin(style, parentWidth) {
    const base = style.margin;
    return {
        top: resolveSpacing(style.marginTop ?? base, parentWidth),
        right: resolveSpacing(style.marginRight ?? base, parentWidth),
        bottom: resolveSpacing(style.marginBottom ?? base, parentWidth),
        left: resolveSpacing(style.marginLeft ?? base, parentWidth),
    };
}
/**
 * Return the gap between items on the row axis (horizontal between siblings).
 * Percent values resolve against the container's own content-box width.
 */
export function resolveRowGap(style, containerWidth) {
    return resolveSpacing(style.rowGap ?? style.gap, containerWidth);
}
/**
 * Return the gap between items on the column axis (vertical between siblings).
 * Percent values resolve against the container's own content-box height.
 */
export function resolveColumnGap(style, containerHeight) {
    return resolveSpacing(style.columnGap ?? style.gap, containerHeight);
}
/**
 * Return the effective flex-grow value for an item.
 * `flex` shorthand sets flex-grow when `flexGrow` is not explicitly set.
 */
export function resolveFlexGrow(style) {
    if (style.flexGrow !== undefined) {
        return style.flexGrow;
    }
    if (style.flex !== undefined) {
        return style.flex;
    }
    return 0;
}
/**
 * Return the effective flex-shrink value for an item.
 *
 * CSS default is 1 (items shrink to fit). We follow the same default so that
 * overflow is automatically distributed; opt out with `flexShrink: 0`.
 */
export function resolveFlexShrink(style) {
    return style.flexShrink ?? 1;
}
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
export function resolveFlexBasisMain(style, measuredMain) {
    if (typeof style.flexBasis === 'number') {
        return style.flexBasis;
    }
    // 'auto' (or a percent basis we don't resolve here) falls back to the measured size.
    if (style.flexBasis !== undefined && style.flexBasis !== 'auto') {
        return measuredMain;
    }
    if (style.flexBasis === undefined && resolveFlexGrow(style) > 0) {
        return 0;
    }
    return measuredMain;
}
/**
 * Return the effective alignment for a child, respecting `alignSelf` override.
 * Falls back to the parent's `alignItems` when alignSelf is 'auto' or not set.
 */
export function resolveAlignSelf(childStyle, parentAlignItems) {
    const as = childStyle.alignSelf ?? 'auto';
    if (as !== 'auto') {
        return as;
    }
    return parentAlignItems;
}
