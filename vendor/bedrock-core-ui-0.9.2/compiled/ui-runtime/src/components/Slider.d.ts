import { FunctionComponent, JSX } from '../jsx';
import { ModalFieldProps } from './modalField';
/** @deprecated Prefer `Form.Slider` inside a `<Form>`. See {@link ModalFieldProps}. */
export interface SliderProps extends ModalFieldProps {
    /** Minimum selectable value. */
    min: number;
    /** Maximum selectable value. */
    max: number;
    /** Increment between selectable values. Defaults to `1` (native default). */
    step?: number;
    /** Controlled value. When provided, the field reflects this on every render. */
    value?: number;
    /** Initial value for the uncontrolled case. Defaults to `min`. */
    defaultValue?: number;
    /** Called with the new value when the player confirms the modal. */
    onChange?: (value: number) => void;
    /** Called when the player cancels (X / Esc) the modal. */
    onCancel?: () => void;
    /**
     * Overrides the default text face. When provided, this node is rendered inside
     * the button instead of the value `Text`, letting styled wrappers draw a custom
     * face (e.g. a track and thumb) while reusing the modal/state logic.
     */
    face?: JSX.Node;
}
/**
 * A numeric slider rendered as a `Button` that *looks like* a field. Pressing it
 * opens a single-slider `ModalFormData`; on confirm the chosen value is committed
 * (internal state + `onChange`), on cancel nothing changes (`onCancel`). Either
 * way the root form re-presents with the current value.
 *
 * Supports both controlled (`value` + `onChange`) and uncontrolled
 * (`defaultValue`) usage, like {@link Input}.
 *
 * This is the unstyled runtime primitive (a peer of the base `Button`); supply a
 * `background` or compose a styled wrapper for a field-like appearance.
 *
 * @deprecated One-modal-per-field legacy. Use `Form.Slider` inside a `<Form>` — all
 * controls share a single modal. Kept for existing screens; slated for removal.
 */
export declare const Slider: FunctionComponent<SliderProps>;
