import type { JSX } from '../../../jsx';
import { type TraversalContext } from '../traversal';
/**
 * Phase 3: Apply parent-child inheritance rules
 * - visible: child AND parent (if parent invisible, child is invisible)
 * - enabled: child AND parent (if parent disabled, child is disabled)
 * - x/y/width/height: already resolved to absolute Pocket-space texels by the layout phase;
 *   this phase only quantizes them to integers for stable JSON UI behavior.
 *
 * This must run AFTER tree expansion and layout so all properties are set.
 *
 * @param element - Element to apply inheritance to
 * @param context - Traversal context with parentState
 * @returns Element with inherited properties applied
 */
export declare function applyInheritance(element: JSX.Element, context: TraversalContext): JSX.Element;
