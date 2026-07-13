import type { FlexStyle, LayoutNode, MeasureFunc } from './types';
/**
 * Create a layout node with an optional style, children, and content measure
 * (leaves whose size depends on the granted width, e.g. wrapping text).
 * The `layout` field is zeroed and will be filled by `computeLayout()`.
 */
export declare function createNode(style?: FlexStyle, children?: LayoutNode[], measure?: MeasureFunc): LayoutNode;
