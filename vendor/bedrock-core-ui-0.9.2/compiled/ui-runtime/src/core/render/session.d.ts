import type { Player } from '@minecraft/server';
import type { JSX } from '../../jsx';
export declare function setPlayerRoot(player: Player, root: JSX.Element): void;
export declare function getPlayerRoot(player: Player): JSX.Element | undefined;
export declare function setBuildRunner(player: Player, runBuild: () => void): void;
export declare function clearPlayerRoot(player: Player): void;
/**
 * Schedule a background logic pass for this player. Coalesces multiple
 * requests within the same microtask into a single build run. Does not
 * present or serialize UI; it only rebuilds to evaluate effects.
 */
export declare function scheduleLogicPass(player: Player): void;
export declare function beginInteractiveTransaction(player: Player): void;
export declare function endInteractiveTransaction(player: Player): void;
export declare function isInInteractiveTransaction(player: Player): boolean;
export declare function triggerCleanup(player: Player, shouldClose?: boolean): void;
