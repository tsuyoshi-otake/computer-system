export class SerializationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'SerializationError';
    }
}
/**
 * @deprecated No longer thrown: a `localizationKey` missing from the map measures as the
 * literal key string (mirroring Bedrock's unmatched-key rendering). Kept for API compat.
 */
export class TranslationKeysError extends Error {
    constructor(message) {
        super(message);
        this.name = 'TranslationKeysError';
    }
}
export class ItemAuxError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ItemAuxError';
    }
}
export class ScrollLimitError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ScrollLimitError';
    }
}
/**
 * Thrown when a tree violates the modal-form restrictions: a regular interactive
 * control (e.g. `Button`) inside a `<ModalForm>`, a nested `<ModalForm>`, a modal
 * form mixed with ActionForm-only roots, or a modal-only control used outside any
 * `<ModalForm>`. A modal renders the native `ModalFormData`, which only supports
 * toggle/slider/dropdown/textField/label plus the hardcoded submit + esc buttons.
 */
export class ModalFormError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ModalFormError';
    }
}
