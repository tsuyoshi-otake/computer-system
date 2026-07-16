import { type Writer } from '../../core/types';
import { FunctionComponent, JSX } from '../../jsx';
import { type StateBackgroundProps } from '../control';
import { type LabelFont } from './controlPayload';
import { FormControlBase } from './shared';
/** Host type for the native modal dropdown slot (modal-only). */
export declare const MODAL_DROPDOWN_SLOT_TYPE = "modal-dropdown";
export interface FormDropdownProps extends FormControlBase, StateBackgroundProps {
    /**
     * Initial selection as an option VALUE (matched against each `Form.Option`'s `value`,
     * mapped to its index). Defaults to the first option. `Form.onSubmit` reports the
     * selected option's INDEX (native behavior).
     */
    defaultValue?: string;
    /**
     * Popup container background texture — the surface behind the option list when the
     * dropdown is open. Defaults to the unstyled placeholder texture.
     */
    popupBackground?: string;
    /** Default option row background texture (idle). Defaults to the unstyled placeholder. */
    optionBackground?: string;
    /** Default option row hover-state texture. Defaults to the resolved option background. */
    optionHover?: string;
    /** Default option row selected-state texture. Defaults to the resolved option background. */
    optionSelected?: string;
    /** Default option label font family (popup rows). Defaults to `'mojangles'`. */
    optionFont?: LabelFont;
    /** Default option label scale multiplier relative to the standard glyph size. Default `1.0`. */
    optionScale?: number;
    /** Default option label alignment (TS-computed into the label position). Default `'left'`. */
    optionAlign?: 'left' | 'center' | 'right';
    /**
     * Color code prefix for the closed-box current-value text (e.g. `'§0'`). Prepended to
     * the decoded option text RP-side, so styling matches the rest of the system's `§`-code
     * convention. Default `''` (renders the label's own white).
     */
    currentColor?: string;
    /** Current-value label font family. Defaults to `'mojangles'`. */
    currentFont?: LabelFont;
    /** Current-value label scale multiplier relative to the standard glyph size. Default `1.0`. */
    currentScale?: number;
    /** Current-value X offset (px) from the closed box's left-middle frame. Default `8`. */
    currentInsetX?: number;
    /** Current-value Y offset (px). Default: vertically centered (−lineHeight/2). */
    currentInsetY?: number;
    /**
     * The selectable options, authored as `Form.Option` children (same authoring shape as
     * `Form.Radio` / `Form.ToggleButton`). Popup rows flow at the fixed row height, so an
     * option's layout props are ignored here — only its `value`/`label`/style are read.
     */
    children?: JSX.Node;
}
/**
 * Option dropdown field → `ModalFormData.dropdown`. Result (`Form.onSubmit`): the
 * selected option's `index` (number, native behavior). Modal-only; render inside a
 * `<Form>`. Accepts the same control/layout props as any component; geometry is
 * computed by the layout phase and encoded into the label payload for the RP to
 * position/style the native widget.
 *
 * Options are `Form.Option` CHILDREN. Each carries its OWN encoded payload (label group +
 * background states) as the native option string — the RP option rows self-decode it per
 * row, so option styling is genuinely per-option (not read uniformly from the cell).
 */
export declare const FormDropdown: FunctionComponent<FormDropdownProps>;
/** Serializes a `modal-dropdown` into the native modal dropdown control. */
export declare const formDropdownWriter: Writer;
