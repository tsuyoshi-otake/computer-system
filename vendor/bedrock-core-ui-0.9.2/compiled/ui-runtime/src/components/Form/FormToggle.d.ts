import { type Writer } from '../../core/types';
import { FunctionComponent } from '../../jsx';
import { type StateBackgroundProps } from '../control';
import { FormControlBase } from './shared';
/** Host type for the native modal toggle slot (modal-only; the restriction pass rejects it elsewhere). */
export declare const MODAL_TOGGLE_SLOT_TYPE = "modal-toggle";
export interface FormToggleProps extends FormControlBase, StateBackgroundProps {
    /** Initial on/off state. Defaults to `false`. */
    defaultValue?: boolean;
    /** Checked (on) base texture. Defaults to the resolved unchecked base. */
    checkedBackground?: string;
    /** Checked hover texture. Defaults to the resolved checked base. */
    checkedHover?: string;
    /** Checked locked texture. Defaults to the resolved checked base. */
    checkedLocked?: string;
}
/**
 * Boolean toggle field → `ModalFormData.toggle`. Result (`Form.onSubmit`): `boolean`.
 * Modal-only; render inside a `<Form>`. Accepts the same control/layout props as any
 * component; geometry is computed by the layout phase and encoded into the label
 * payload for the RP to position/style the native widget.
 */
export declare const FormToggle: FunctionComponent<FormToggleProps>;
/** Serializes a `modal-toggle` into the native modal toggle control. */
export declare const formToggleWriter: Writer;
