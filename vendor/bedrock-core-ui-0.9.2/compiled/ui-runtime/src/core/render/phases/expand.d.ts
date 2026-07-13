import type { Player } from '@minecraft/server';
import type { JSX } from '../../../jsx';
import { type TraversalContext } from '../traversal';
/**
 * Phase 1: Expand function components and resolve context providers in depth-first order.
 * This ensures context is available when function components that use useContext() are called.
 *
 * CRITICAL: Each function component now gets its own instance, hooks, and lifecycle.
 * This is the core fix for per-component instance management.
 *
 * Order of operations:
 * 1. If function component → CREATE INSTANCE, push to stack, call it, pop from stack
 * 2. If context provider → push context, process children, pop context
 * 3. For regular elements → recursively process children
 *
 * @param element - Element that may have function components or context providers
 * @param context - Traversal context with player, parent path, and instance tracking
 * @param player - Player rendering the component
 * @returns Element with all function components expanded and contexts resolved
 */
export declare function expandAndResolveContexts(element: JSX.Element, context: TraversalContext, player: Player): JSX.Element;
