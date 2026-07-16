/* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
import { isFunction } from '../';
import { isInInteractiveTransaction, scheduleLogicPass, triggerCleanup } from '../render/session';
import { getCurrentFiber } from './registry';
import { invariant, nextHookSlot } from './utils';
export const MountDispatcher = {
    useState(initial) {
        const [fiber] = getCurrentFiber();
        invariant(fiber, 'useState');
        const slot = nextHookSlot(fiber, 'state');
        const value = isFunction(initial) ? initial() : initial;
        slot.value = value;
        slot.initial = value;
        slot.resolved = false;
        const setter = (v) => {
            const prevVal = slot.value;
            const nextVal = isFunction(v) ? v(prevVal) : v;
            if (!Object.is(nextVal, prevVal)) {
                slot.value = nextVal;
                if (!slot.resolved && !Object.is(nextVal, slot.initial)) {
                    slot.resolved = true;
                }
                scheduleLogicPass(fiber.player);
            }
        };
        return [slot.value, setter];
    },
    useEffect(effect, deps) {
        const [fiber] = getCurrentFiber();
        invariant(fiber, 'useEffect');
        const slotIndex = fiber.hookIndex;
        const slot = nextHookSlot(fiber, 'effect');
        slot.deps = deps;
        fiber.pendingEffects.push({ slotIndex, effect, deps });
    },
    useRef(initial) {
        const [fiber] = getCurrentFiber();
        invariant(fiber, 'useRef');
        const slot = nextHookSlot(fiber, 'ref');
        if (!slot.value) {
            slot.value = { current: initial };
        }
        return slot.value;
    },
    useContext(ctx) {
        const [fiber] = getCurrentFiber();
        invariant(fiber, 'useContext');
        const slot = nextHookSlot(fiber, 'context');
        const value = (fiber.contextSnapshot?.get(ctx)) ?? ctx.defaultValue;
        slot.value = value;
        return value;
    },
    useReducer(reducer, initial) {
        const [fiber] = getCurrentFiber();
        invariant(fiber, 'useReducer');
        const slot = nextHookSlot(fiber, 'reducer');
        slot.value = initial;
        slot.initial = initial;
        slot.resolved = false;
        const dispatch = (action) => {
            const prevVal = slot.value;
            const nextVal = reducer(prevVal, action);
            if (!Object.is(nextVal, prevVal)) {
                slot.value = nextVal;
                if (!slot.resolved && !Object.is(nextVal, slot.initial)) {
                    slot.resolved = true;
                }
                scheduleLogicPass(fiber.player);
            }
        };
        return [slot.value, dispatch];
    },
    usePlayer() {
        const [fiber] = getCurrentFiber();
        invariant(fiber, 'usePlayer');
        return fiber.player;
    },
    useExit() {
        const [fiber] = getCurrentFiber();
        invariant(fiber, 'useExit');
        return () => {
            fiber.shouldRender = false;
            // If not in an interactive transaction (e.g., called from useEffect),
            if (!isInInteractiveTransaction(fiber.player)) {
                triggerCleanup(fiber.player, true);
            }
        };
    },
    useEvent(signal, callback, options, deps) {
        const allDeps = deps ? [...deps, signal, callback, options] : [signal, callback, options];
        return this.useEffect(() => {
            signal.subscribe(callback, options);
            return () => {
                signal.unsubscribe(callback);
            };
        }, allDeps);
    },
};
export const UpdateDispatcher = {
    useState(initial) {
        const [fiber] = getCurrentFiber();
        invariant(fiber, 'useState');
        const slot = nextHookSlot(fiber, 'state');
        // On update, slot.value must exist; if not, hook order changed
        if (slot.value === undefined) {
            // initialize if genuinely first run on this position (edge case)
            slot.value = isFunction(initial) ? initial() : initial;
            if (slot.initial === undefined) {
                slot.initial = slot.value;
                slot.resolved = false;
            }
        }
        const setter = (v) => {
            const prevVal = slot.value;
            const nextVal = isFunction(v) ? v(prevVal) : v;
            if (!Object.is(nextVal, prevVal)) {
                slot.value = nextVal;
                if (!slot.resolved && !Object.is(nextVal, slot.initial)) {
                    slot.resolved = true;
                }
                scheduleLogicPass(fiber.player);
            }
        };
        return [slot.value, setter];
    },
    useEffect(effect, deps) {
        const [fiber] = getCurrentFiber();
        invariant(fiber, 'useEffect');
        const slotIndex = fiber.hookIndex;
        const slot = nextHookSlot(fiber, 'effect');
        // No deps = run every render; otherwise use shallow comparison of array items
        if (deps === undefined) {
            // Always schedule when no dependency list is provided
            slot.deps = undefined;
            fiber.pendingEffects.push({ slotIndex, effect, deps });
            return;
        }
        // If we have a dependency array, schedule only when changed
        const prevDeps = slot.deps;
        let changed = false;
        if (!prevDeps) {
            // First run after mount in update phase, or previously uninitialized
            changed = true;
        }
        else if (prevDeps.length !== deps.length) {
            changed = true;
        }
        else {
            for (let i = 0; i < deps.length; i++) {
                if (!Object.is(prevDeps[i], deps[i])) {
                    changed = true;
                    break;
                }
            }
        }
        if (changed) {
            slot.deps = deps;
            fiber.pendingEffects.push({ slotIndex, effect, deps });
        }
    },
    useRef(initial) {
        const [fiber] = getCurrentFiber();
        invariant(fiber, 'useRef');
        const slot = nextHookSlot(fiber, 'ref');
        if (!slot.value) {
            slot.value = { current: initial };
        }
        return slot.value;
    },
    useContext(ctx) {
        const [fiber] = getCurrentFiber();
        invariant(fiber, 'useContext');
        const slot = nextHookSlot(fiber, 'context');
        const value = (fiber.contextSnapshot?.get(ctx)) ?? ctx.defaultValue;
        slot.value = value;
        return value;
    },
    useReducer(reducer, initial) {
        const [fiber] = getCurrentFiber();
        invariant(fiber, 'useReducer');
        const slot = nextHookSlot(fiber, 'reducer');
        if (slot.value === undefined) {
            slot.value = initial;
            if (slot.initial === undefined) {
                slot.initial = slot.value;
                slot.resolved = false;
            }
        }
        const dispatch = (action) => {
            const prevVal = slot.value;
            const nextVal = reducer(prevVal, action);
            if (!Object.is(nextVal, prevVal)) {
                slot.value = nextVal;
                if (!slot.resolved && !Object.is(nextVal, slot.initial)) {
                    slot.resolved = true;
                }
                scheduleLogicPass(fiber.player);
            }
        };
        return [slot.value, dispatch];
    },
    usePlayer() {
        const [fiber] = getCurrentFiber();
        invariant(fiber, 'usePlayer');
        return fiber.player;
    },
    useExit() {
        const [fiber] = getCurrentFiber();
        invariant(fiber, 'useExit');
        return () => {
            fiber.shouldRender = false;
            // If not in an interactive transaction (e.g., called from useEffect),
            if (!isInInteractiveTransaction(fiber.player)) {
                triggerCleanup(fiber.player, true);
            }
        };
    },
    useEvent(signal, callback, options, deps) {
        const allDeps = deps ? [...deps, signal, callback, options] : [signal, callback, options];
        return this.useEffect(() => {
            signal.subscribe(callback, options);
            return () => {
                signal.unsubscribe(callback);
            };
        }, allDeps);
    },
};
