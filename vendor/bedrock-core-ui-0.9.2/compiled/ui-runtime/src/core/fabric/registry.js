export const FiberRegistry = new Map();
let currentFiber = undefined;
let currentDispatcher = undefined;
export function setCurrentFiber(fiber, dispatcher) {
    currentFiber = fiber;
    currentDispatcher = dispatcher;
}
export function getCurrentFiber() {
    return [currentFiber, currentDispatcher];
}
