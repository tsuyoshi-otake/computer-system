import { Player } from '@minecraft/server';
import { Fiber } from './types';
export declare function createFiber(id: string, player: Player): Fiber;
export declare function getFiber(id: string): Fiber | undefined;
export declare function deleteFiber(id: string): void;
/**
 * Get all fibers for a specific player.
 * @param player - Player instance to filter fibers by
 * @returns Array of fiber IDs belonging to this player
 */
export declare function getFibersForPlayer(player: Player): Fiber[];
/**
 * Activate a fiber and evaluate `fn` within its dynamic scope.
 * Resets hookIndex and schedules effects; effects are flushed after `fn`.
 */
export declare function activateFiber<T>(fiber: Fiber, fn: () => T): T;
/**
 * Helper to run an arbitrary callback under the current fiber context.
 * Useful for async continuations where hooks are not called but code relies
 * on the same dynamic fiber (e.g., reading getCurrentFiber()).
 */
export declare function runInFiber<R>(fiber: Fiber, cb: () => R): R;
