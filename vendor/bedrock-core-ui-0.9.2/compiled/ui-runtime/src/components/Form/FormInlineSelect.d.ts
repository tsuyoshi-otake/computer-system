import { type Writer } from '../../core/types';
import { FunctionComponent, JSX } from '../../jsx';
import { type LabelFont } from './controlPayload';
import { FormControlBase } from './shared';
/**
 * Host type for the inline single-select slot (radio group / toggle-button group) →
 * native `ModalFormData.dropdown`, but the RP renders its option collection INLINE in
 * the form flow (all options always visible) instead of behind the dropdown popup.
 * Modal-only.
 */
export declare const MODAL_INLINE_SELECT_SLOT_TYPE = "modal-inline-select";
export interface FormInlineSelectProps extends FormControlBase {
    /**
     * Initial selection as an option VALUE (matched against each `Form.Option`'s `value`, mapped to
     * its index). Defaults to the first option. `Form.onSubmit` reports the selected option's INDEX.
     */
    defaultValue?: string;
    /** Default idle option background texture. */
    optionBackground?: string;
    /** Default option hover background. */
    optionHover?: string;
    /** Default option selected background. */
    optionSelected?: string;
    /** Default unselected bullet glyph (radio). Empty draws no bullet (segmented). */
    bullet?: string;
    /** Default selected bullet glyph (radio). */
    bulletSelected?: string;
    /** Default unselected bullet glyph shown on hover. Falls back to `bullet`. */
    bulletHover?: string;
    /** Default selected bullet glyph shown on hover. Falls back to `bulletSelected`. */
    bulletSelectedHover?: string;
    /** Default bullet glyph width (px). Default `12`. */
    bulletWidth?: number;
    /** Default bullet glyph height (px). Default `12`. */
    bulletHeight?: number;
    /** Default option label font. */
    optionFont?: LabelFont;
    /** Default option label scale. */
    optionScale?: number;
    /** Default option label alignment (TS-computed into the label position). */
    optionAlign?: 'left' | 'center' | 'right';
    /**
     * The `Form.Option` children — each is flex-laid-out by our layout system (position them with
     * the usual layout props), and its computed geometry is packed into its native option blob so
     * the RP option row self-positions. The single submitted value is the selected option's index.
     */
    children?: JSX.Node;
}
/**
 * Inline single-select group (radio group / toggle-button group) → `ModalFormData.dropdown`,
 * rendered INLINE (all options always visible, no popup). Result (`Form.onSubmit`): the selected
 * option's INDEX. Modal-only; render inside a `<Form>`.
 *
 * Options are authored as `Form.Option` CHILDREN. Each is laid out by our flex engine (arbitrary
 * position/size), and the writer packs every option's computed x/y/w/h into its native blob so the
 * RP option row self-positions via `use_anchored_offset` — layout is fully ours, not the engine's
 * flow. Selection + the single submitted index still ride the one native `dropdown()` emitted here.
 *
 * The group cell itself is a full-size, top-left-anchored invisible container; options place
 * themselves absolutely within it from their blob geometry.
 */
export declare const FormInlineSelect: FunctionComponent<FormInlineSelectProps>;
/**
 * Serialize a `modal-inline-select` into the native modal dropdown, reading each laid-out
 * `Form.Option` child's geometry + data (all option handling lives in optionPayload). Same
 * native `dropdown()` call as the popup dropdown — only the per-option blobs (carrying flex
 * geometry) and the RP inline decode differ.
 */
export declare const formInlineSelectWriter: Writer;
