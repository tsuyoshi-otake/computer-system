import { Dispatcher, Fiber } from './types';
export declare const FiberRegistry: Map<string, Fiber>;
export declare function setCurrentFiber(fiber: Fiber | undefined, dispatcher: Dispatcher | undefined): void;
export declare function getCurrentFiber(): [Fiber | undefined, Dispatcher | undefined];
