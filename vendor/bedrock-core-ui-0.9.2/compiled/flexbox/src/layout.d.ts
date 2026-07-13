import type { LayoutNode } from './types';
/**
 * Compute absolute texel positions and sizes for all nodes in the tree.
 *
 * Runs the 3-pass solve, then — when measured leaves exist (`node.measure`,
 * e.g. wrapping text) — re-measures each leaf at the width the solve granted
 * it and re-solves until sizes settle (bounded fixpoint, see
 * MAX_MEASURE_ROUNDS). Trees without measured leaves solve exactly once.
 *
 * After this call every `node.layout` holds absolute texel values:
 *  - `x`, `y`       — top-left corner from screen origin (0,0)
 *  - `width`, `height` — dimensions in texels
 *  - `zIndex`       — resolved (inherits from parent when not explicitly set)
 *
 * @param root     Root layout node. Its x/y default to 0,0.
 * @param refWidth  Reference width for the root's percentage resolution (default: pocket screen).
 * @param refHeight Reference height for the root's percentage resolution (default: pocket screen).
 */
export declare function computeLayout(root: LayoutNode, refWidth?: number, refHeight?: number): void;
