import { ModalValue } from '../../core/types';
import { FunctionComponent, JSX } from '../../jsx';
import { type FormButtonProps } from './FormButton';
import { type FormDropdownProps } from './FormDropdown';
import { type FormInlineSelectProps } from './FormInlineSelect';
import { type FormInputProps } from './FormInput';
import { type FormOptionProps } from './FormOption';
import { type FormSliderProps } from './FormSlider';
import { type FormToggleProps } from './FormToggle';
/**
 * The host `type` string emitted by {@link Form}. The serializer treats it as
 * transparent (no payload, children only); the presenter detects it on the built
 * tree to switch from the ActionForm backend to the native `ModalFormData` one.
 */
export declare const MODAL_FORM_SLOT_TYPE = "modal-form";
/** The result object handed to {@link FormProps.onSubmit}, keyed by each control's `name`. */
export type FormValues = Record<string, ModalValue>;
/**
 * Resolved chrome + lifecycle the presenter reads off the `modal-form` node. The
 * callbacks are not primitives, so the serializer keeps them as callbacks and walks
 * the children.
 */
export interface FormConfig {
    /**
     * Called once when the player submits, with every control's value keyed by its
     * `name`. The native modal is atomic — this is the only place values arrive.
     */
    onSubmit?: (values: FormValues) => void;
    /** Called when the player dismisses the modal (X / Esc / a `Form.Button` exit). */
    onCancel?: () => void;
}
/**
 * Marks that the calling subtree is inside a `<Form>`. The restriction pass reads it
 * to enforce that modal controls only appear under a `Form` and that no `Button` /
 * nested `Form` appears within one. `null` (the default) means "not in a modal".
 */
export declare const ModalContext: import("../..").Context<FormConfig | null>;
export interface FormProps extends FormConfig {
    /**
     * Modal contents: the field declarations (`Form.Toggle` / `Form.Slider` /
     * `Form.Dropdown` / `Form.Input`), decorative nodes (`Image` / `Panel` / `Text`),
     * and the form's action buttons — exactly ONE `Form.Button type="submit"` (required)
     * and optionally one `Form.Button type="exit"`, positioned anywhere in the flow.
     * A regular `Button` is rejected.
     */
    children?: JSX.Node;
}
interface FormComponent extends FunctionComponent<FormProps> {
    Toggle: FunctionComponent<FormToggleProps>;
    Slider: FunctionComponent<FormSliderProps>;
    Dropdown: FunctionComponent<FormDropdownProps>;
    InlineSelect: FunctionComponent<FormInlineSelectProps>;
    Option: FunctionComponent<FormOptionProps>;
    Input: FunctionComponent<FormInputProps>;
    Button: FunctionComponent<FormButtonProps>;
}
/**
 * The `Form` root plus its field-control members. Assembled with `Object.assign` so
 * the namespace shape is built structurally (no narrowing cast).
 */
export declare const Form: FormComponent;
export {};
