export function invariant(condition, message) {
    if (!condition) {
        throw new Error(`[fiber] ${message} called outside an active fiber`);
    }
}
export function nextHookSlot(fiber, tag) {
    const idx = fiber.hookIndex++;
    let slot = fiber.hookStates[idx];
    if (!slot) {
        slot = { value: undefined, tag };
        fiber.hookStates[idx] = slot;
    }
    else if (slot.tag !== tag) {
        // Soft guard to aid debugging when hook order shifts across types
        slot.tag = tag;
    }
    return slot;
}
