import { FunctionComponent, JSX } from '../../jsx';
import { type SerializableProps, type Writer } from '../../core/types';
import { type ControlProps, type StateBackgroundProps } from '../control';
/** Which form action the button triggers. */
/**
 * Host type for `Form.Button` — NOT a native control: it consumes no `formValues` slot;
 * its payload rides the form TITLE (assembled by the presenter post-layout).
 */
export declare const MODAL_FORM_BUTTON_SLOT_TYPE = "modal-form-button";
export type FormButtonKind = 'submit' | 'exit';
export interface FormButtonProps extends ControlProps, StateBackgroundProps {
    /**
     * `'submit'` presses the native submit (values return via `Form.onSubmit`);
     * `'exit'` closes the form like Esc (`Form.onCancel`, no values). A form must
     * declare exactly ONE submit button and at most one exit button.
     */
    type: FormButtonKind;
    /** Button text. Defaults to `'Submit'` / `'Close'` by kind. */
    label?: string;
}
/**
 * A form action button, positioned in the scroll flow like any other row. It is NOT
 * a native modal control (no factory entry, no `formValues` slot): the presenter
 * collects these post-layout and encodes their geometry + styling into the form
 * TITLE payload (after the scroll block), where the RP renders and wires them to
 * the engine's submit / close button ids.
 *
 * Layout defaults mirror the field controls: full row width, native row height.
 */
export declare const FormButton: FunctionComponent<FormButtonProps>;
/**
 * No-op writer: the button is not a native modal control — it consumes NO
 * `ModalFormData` entry and NO `formValues` slot. Its payload rides the form
 * title, assembled by the presenter from the laid-out tree.
 */
export declare const formButtonWriter: Writer;
/**
 * Collect the form's `Form.Button` ELEMENTS from the laid-out tree and enforce the
 * cardinality rules: exactly one submit (required — the modal has no built-in
 * submit), at most one exit. Component-owned, like the writer: the component
 * module knows its own rules and serialized shape.
 *
 * @throws ModalFormError on a missing submit or a duplicate of either kind.
 */
export declare function collectFormButtons(tree: JSX.Element): {
    submit: JSX.Element;
    exit?: JSX.Element;
};
/**
 * The button's serialized TITLE fields, in contract order: width, height, x, y
 * (layout-computed), visible, enabled, label, background/hover/pressed/locked.
 * An UNDECLARED button (element `undefined`) yields its absent-state defaults —
 * hidden, zero geometry, empty strings — so both blocks always serialize and the
 * title offsets stay fixed. The absolute offsets are locked by the modal title
 * offset-contract test and decoded by modal_container.json.
 *
 * @param prefix - Field-name prefix (`'submit'` / `'exit'`), also the block order.
 * @param element - The laid-out `Form.Button` element, or undefined when undeclared.
 */
export declare function formButtonTitleFields(prefix: FormButtonKind, element?: JSX.Element): SerializableProps;
