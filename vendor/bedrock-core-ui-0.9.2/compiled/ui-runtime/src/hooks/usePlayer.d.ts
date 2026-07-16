import { Player } from '@minecraft/server';
/**
 * Hook that returns the Player associated with the current render session.
 * Provides access to the player for whom the UI is being presented.
 *
 * @returns The current Player instance.
 */
export declare function usePlayer(): Player;
