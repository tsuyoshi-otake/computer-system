import { uiManager } from '@minecraft/server-ui';
import { stopInputLock } from '../../util';
import { getFibersForPlayer } from '../fabric';
import { cleanupComponentTree } from './tree';
const sessions = new Map();
function getOrCreate(player) {
    const id = player.id;
    let session = sessions.get(id);
    if (!session) {
        session = { pending: false, suppress: false };
        sessions.set(id, session);
    }
    return session;
}
export function setPlayerRoot(player, root) {
    const session = getOrCreate(player);
    session.root = root;
}
export function getPlayerRoot(player) {
    return sessions.get(player.id)?.root;
}
export function setBuildRunner(player, runBuild) {
    const session = getOrCreate(player);
    session.runBuild = runBuild;
}
export function clearPlayerRoot(player) {
    const session = sessions.get(player.id);
    if (!session) {
        return;
    }
    session.root = undefined;
    session.runBuild = undefined;
    session.pending = false;
    session.suppress = false;
}
/**
 * Schedule a background logic pass for this player. Coalesces multiple
 * requests within the same microtask into a single build run. Does not
 * present or serialize UI; it only rebuilds to evaluate effects.
 */
export function scheduleLogicPass(player) {
    const session = getOrCreate(player);
    // Skip if an interactive transaction is active
    if (session.suppress) {
        return;
    }
    if (session.pending) {
        return;
    }
    if (!session.root || !session.runBuild) {
        return;
    }
    // Skip if exit requested
    const exiting = getFibersForPlayer(player).some(f => !f.shouldRender);
    if (exiting) {
        return;
    }
    session.pending = true;
    // Schedule in a microtask to avoid re-entrancy and coalesce bursts.
    Promise.resolve().then(() => {
        session.pending = false;
        // The session could have been cleared between schedule and flush.
        const state = sessions.get(player.id);
        if (!(state?.root && state?.runBuild)) {
            return;
        }
        if (state.suppress) {
            return;
        }
        const exitingNow = getFibersForPlayer(player).some(f => !f.shouldRender);
        if (exitingNow) {
            return;
        }
        try {
            state.runBuild();
        }
        catch (err) {
            // Swallow errors to avoid destabilizing runtime during background passes.
            console.warn(`[ui-runtime] background build error: ${String(err)}`);
        }
    });
}
export function beginInteractiveTransaction(player) {
    const session = getOrCreate(player);
    session.suppress = true;
    session.pending = false; // cancel pending microtask; flush path also checks suppress
}
export function endInteractiveTransaction(player) {
    const session = getOrCreate(player);
    session.suppress = false;
}
export function isInInteractiveTransaction(player) {
    const session = sessions.get(player.id);
    return session?.suppress ?? false;
}
export function triggerCleanup(player, shouldClose = false) {
    stopInputLock(player);
    cleanupComponentTree(player);
    clearPlayerRoot(player);
    if (shouldClose) {
        uiManager.closeAllForms(player);
    }
}
