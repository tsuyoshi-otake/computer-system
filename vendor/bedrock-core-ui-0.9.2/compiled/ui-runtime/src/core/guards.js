export const isFunction = (value) => typeof value === 'function';
export function isElement(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value) && 'type' in (value);
}
export function isNode(value) {
    if (value === null || value === undefined) {
        return true;
    }
    if (typeof value === 'string') {
        return true;
    }
    if (Array.isArray(value)) {
        return value.every(item => item === null || item === undefined || isElement(item));
    }
    return isElement(value);
}
/**
 * Narrows a {@link FormTarget} to an `ActionFormData`. The button slot
 * (`form.button()`) only exists on the ActionForm backend, so writers/presenters
 * guard on this before emitting interactive buttons.
 */
export function isActionForm(form) {
    return 'button' in form;
}
/**
 * Narrows a {@link FormTarget} to a `ModalFormData`. The typed modal controls
 * (`toggle`/`slider`/`dropdown`/`textField`) live on the modal backend.
 */
export function isModalForm(form) {
    return 'toggle' in form;
}
/**
 * Narrows a {@link SerializationContext} to the ActionForm walk (button index +
 * onPress map). Pairs with {@link isActionForm}.
 */
export function isActionContext(ctx) {
    return ctx.mode === 'action';
}
/**
 * Narrows a {@link SerializationContext} to the modal walk (control ordinal +
 * onChange map). Pairs with {@link isModalForm}.
 */
export function isModalContext(ctx) {
    return ctx.mode === 'modal';
}
export function isSerializablePrimitive(value) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return true;
    }
    // Check for ReservedBytes object
    if (typeof value === 'object' && value !== null && value !== undefined && 'bytes' in value) {
        return true;
    }
    return false;
}
