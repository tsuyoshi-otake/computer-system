import { type Player } from '@minecraft/server';
import type { JSX } from '../../jsx';
/**
 * Build the complete JSX element tree by running all transformation phases.
 * This is the entry point for the RENDERING PHASE where all components are
 * called, instances created, and hooks initialized.
 *
 * TWO-PHASE ARCHITECTURE:
 * Phase 1 (Rendering - this function): Build tree, create instances, initialize hooks
 * Phase 2 (Logic - background): Effects run while form is displayed
 *
 * Four-phase tree building:
 * Phase 1: Expand function components and resolve contexts
 * Phase 2: Compute layout using flexbox algorithm (resolves sizes and positions to absolute Pocket-space texels)
 * Phase 3: Apply parent-child inheritance rules (visibility, enabled)
 *
 * @param element - Root JSX element to build
 * @param player - Player rendering the component
 * @returns Fully processed JSX element tree and list of created instances
 */
export declare function buildTree(element: JSX.Element, player: Player): JSX.Element;
/**
 * Clean up all fibers for a player (stop effects, delete instances).
 *
 * @param player - Player whose components are being cleaned up
 */
export declare function cleanupComponentTree(player: Player): void;
