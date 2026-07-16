import { Fiber, HookSlot } from './types';
export declare function invariant(condition: unknown, message: string): asserts condition;
export declare function nextHookSlot(fiber: Fiber, tag: HookSlot['tag']): HookSlot;
