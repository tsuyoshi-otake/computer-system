import { Player } from '@minecraft/server';
/**
 * Start locking camera and movement input for a player
 */
export declare function startInputLock(player: Player): void;
/**
 * Stop locking camera and movement input for a player, restoring previous permissions
 */
export declare function stopInputLock(player: Player): void;
