import { type Writer } from '../../core/types';
import { FunctionComponent } from '../../jsx';
import { type StateBackgroundProps } from '../control';
import { FormControlBase } from './shared';
/** Host type for the native modal slider slot (modal-only). */
export declare const MODAL_SLIDER_SLOT_TYPE = "modal-slider";
export interface FormSliderProps extends FormControlBase, StateBackgroundProps {
    /** Minimum selectable value. */
    min: number;
    /** Maximum selectable value. */
    max: number;
    /** Increment between selectable values. Defaults to `1` (native default). */
    step?: number;
    /** Initial value. Defaults to `min`. */
    defaultValue?: number;
    /** Progress-fill texture (left of the thumb). Defaults to the resolved track base. */
    progress?: string;
    /** Progress-fill hover texture. Defaults to the resolved progress texture. */
    progressHover?: string;
    /** Thumb (draggable handle) texture. Defaults to the resolved track base. */
    thumb?: string;
    /** Thumb hover texture. Defaults to the resolved thumb texture. */
    thumbHover?: string;
    /** Thumb pressed/dragged (indent) texture. Defaults to the resolved thumb texture. */
    thumbPressed?: string;
    /** Thumb locked/disabled texture. Defaults to the resolved thumb texture. */
    thumbLocked?: string;
    /**
     * Track (and progress fill) height in px. The track always spans the full control
     * width and is vertically centered; this sets how tall it draws. Default `10`.
     */
    trackHeight?: number;
    /** Thumb (draggable handle) width in px. Default `16`. */
    thumbWidth?: number;
    /** Thumb (draggable handle) height in px. Default `16`. */
    thumbHeight?: number;
}
/**
 * Numeric slider field → `ModalFormData.slider`. Result (`Form.onSubmit`): `number`.
 * Modal-only; render inside a `<Form>`. Accepts the same control/layout props as any
 * component; geometry is computed by the layout phase and encoded into the label
 * payload for the RP to position/style the native widget.
 */
export declare const FormSlider: FunctionComponent<FormSliderProps>;
/** Serializes a `modal-slider` into the native modal slider control. */
export declare const formSliderWriter: Writer;
