import { getCurrentFiber, invariant } from '../core';
/**
 * Event subscription hook for Minecraft events.
 * Subscribes on mount, updates the subscription when dependencies change, and unsubscribes on unmount.
 *
 * @typeParam T - Event payload type.
 * @typeParam O - Subscription options type for the event.
 * @param signal - Event signal with `subscribe` and `unsubscribe` methods.
 * @param callback - Function invoked when the event fires.
 * @param options - Optional options forwarded to `subscribe`.
 * @param deps - Optional dependency list to resubscribe when values change. Omit for stable subscription.
 */
export function useEvent(signal, callback, options, deps) {
    const [, d] = getCurrentFiber();
    invariant(d, 'useEvent');
    d.useEvent(signal, callback, options, deps);
}
