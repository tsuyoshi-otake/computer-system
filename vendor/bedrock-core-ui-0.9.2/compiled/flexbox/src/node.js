function zeroLayout() {
    return { x: 0, y: 0, width: 0, height: 0, zIndex: 0 };
}
/**
 * Create a layout node with an optional style, children, and content measure
 * (leaves whose size depends on the granted width, e.g. wrapping text).
 * The `layout` field is zeroed and will be filled by `computeLayout()`.
 */
export function createNode(style = {}, children = [], measure) {
    return measure !== undefined
        ? { style, children, layout: zeroLayout(), measure }
        : { style, children, layout: zeroLayout() };
}
