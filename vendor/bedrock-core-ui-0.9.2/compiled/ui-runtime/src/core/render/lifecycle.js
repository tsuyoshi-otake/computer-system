import { registerNativeComponents } from '../../components';
import { startInputLock } from '../../util';
import { present } from './presenters';
import { setBuildRunner, setPlayerRoot, triggerCleanup } from './session';
import { buildTree } from './tree';
export function render(root, player) {
    // Ensure the built-in native components are registered before the first build/
    // serialize. Idempotent — safe to call on every render.
    registerNativeComponents();
    startInputLock(player);
    // Convert function component to JSX element if needed
    const rootElement = typeof root === 'function' ? { type: root, props: {} } : root;
    // Register this player's session root and a background build runner
    setPlayerRoot(player, rootElement);
    setBuildRunner(player, () => {
        buildTree(rootElement, player);
    });
    // Helper to build and present once
    const presentOnce = () => {
        let tree;
        try {
            tree = buildTree(rootElement, player);
        }
        catch (err) {
            console.error(`[ui-runtime] buildTree error: ${String(err)}`);
            return;
        }
        present(player, tree)
            .then((result) => {
            if (result === 'present') {
                // Another snapshot requested (programmatic close); rebuild and present again immediately
                presentOnce();
            }
            else if (result === 'cleanup') {
                triggerCleanup(player);
            }
            else {
                // none: do nothing; user dismissed without callbacks
            }
        })
            .catch((err) => {
            console.error(`[ui-runtime] present error: ${String(err)}`);
        });
    };
    // Kick off initial present
    presentOnce();
}
