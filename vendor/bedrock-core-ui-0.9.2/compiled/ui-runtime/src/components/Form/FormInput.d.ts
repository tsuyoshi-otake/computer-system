import { type Writer } from '../../core/types';
import { FunctionComponent } from '../../jsx';
import { type StateBackgroundProps } from '../control';
import { type LabelFont } from './controlPayload';
import { FormControlBase } from './shared';
/** Host type for the native modal text-field slot (modal-only). */
export declare const MODAL_INPUT_SLOT_TYPE = "modal-input";
export interface FormInputProps extends FormControlBase, StateBackgroundProps {
    /** Placeholder shown inside the native text field when empty. */
    placeholder?: string;
    /** Initial text. Defaults to `''`. */
    defaultValue?: string;
    /** Field text font family (typed value + placeholder). Defaults to `'mojangles'`. */
    font?: LabelFont;
    /** Field text scale multiplier relative to the standard glyph size. Default `1.0`. */
    scale?: number;
    /** Typed-value X offset (px) from the box's left-middle frame. Default `8`. */
    textOffsetX?: number;
    /** Typed-value Y offset (px). Default: vertically centered (−lineHeight/2). */
    textOffsetY?: number;
    /** Placeholder X offset (px). Default `8`. */
    placeholderOffsetX?: number;
    /** Placeholder Y offset (px). Default: vertically centered. */
    placeholderOffsetY?: number;
}
/**
 * Text field → `ModalFormData.textField`. Result (`Form.onSubmit`): `string`.
 * Modal-only; render inside a `<Form>`. Accepts the same control/layout props as any
 * component; geometry is computed by the layout phase and encoded into the label
 * payload for the RP to position/style the native widget.
 */
export declare const FormInput: FunctionComponent<FormInputProps>;
/** Serializes a `modal-input` into the native modal text field control. */
export declare const formInputWriter: Writer;
