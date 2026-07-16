import { presentAction } from './presentAction';
import { presentModal } from './presentModal';
import { findModalConfig } from './shared';
/**
 * Build and show one form snapshot for `player`, dispatching by form mode detected on
 * the built tree: a `<Form>` marker routes to the native modal backend
 * ({@link presentModal}); otherwise the default ActionForm backend ({@link presentAction})
 * renders.
 *
 * @param player - Player to show the form to.
 * @param tree - Fully built tree for this snapshot.
 * @returns `'present'` to re-render immediately (programmatic close), `'cleanup'` to
 *   tear the session down, or `'none'` when the player dismissed with no callback.
 */
export async function present(player, tree) {
    const modalConfig = findModalConfig(tree);
    if (modalConfig) {
        return presentModal(player, tree, modalConfig);
    }
    return presentAction(player, tree);
}
