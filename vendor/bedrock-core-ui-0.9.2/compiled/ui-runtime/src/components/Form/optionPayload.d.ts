import { JSX } from '../../jsx';
/** Host `type` tag for a per-option payload blob (decoded per-row by the RP option controls). */
export declare const DROPDOWN_OPTION_TYPE = "dropdown-option";
/**
 * The per-option styling an option is encoded with — shared by the dropdown popup rows AND
 * the inline radio / toggle-button rows (both ride the native `options[]` collection strings,
 * decoded per-row by the RP). Field order mirrors the serialized blob: the LABEL pair first
 * (the blob's label group), then the row/face fields, then the bullet pair.
 */
export interface OptionStyle {
    /** Label font (serialized `font_type` value — the label group's second slot). */
    fontType: string;
    /** Label scale factor (the group's third slot). */
    fontScaleFactor: number;
    /** Requested alignment — consumed TS-SIDE by {@link optionLabelPosition}, never serialized. */
    align: 'left' | 'center' | 'right';
    /** Legacy flow row height (unused by the RP; kept for the blob layout). */
    height: number;
    background: string;
    backgroundHover: string;
    backgroundSelected: string;
    /** Unselected radio bullet glyph texture. Empty = no bullet (dropdown / segmented). */
    bulletTexture: string;
    /** Selected radio bullet glyph texture. Empty = no bullet. */
    bulletSelectedTexture: string;
    /** Bullet glyph width (px). */
    bulletWidth: number;
    /** Bullet glyph height (px). */
    bulletHeight: number;
    /** Unselected bullet glyph shown on hover. Empty falls back to `bulletTexture`. */
    bulletHoverTexture: string;
    /** Selected bullet glyph shown on hover. Empty falls back to `bulletSelectedTexture`. */
    bulletSelectedHoverTexture: string;
}
/**
 * Per-option flex geometry (px) computed by the layout phase for a `Form.Option`. Packed into the
 * option blob AFTER the style fields so the RP option row SELF-POSITIONS via `use_anchored_offset`
 * (x/y) at its flex-computed size (width/height). The dropdown popup passes all zeros (its rows
 * still flow at the fixed row height).
 */
export interface OptionGeometry {
    x: number;
    y: number;
    width: number;
    height: number;
}
/** Zero geometry — the dropdown popup rows flow (engine-positioned), so they encode no offsets. */
export declare const NO_OPTION_GEOMETRY: OptionGeometry;
/** The computed position of an option's label inside its row (px, from row top-left). */
export interface OptionLabelPosition {
    x: number;
    y: number;
}
/**
 * Runtime type guard for the `optionStyle` carried on a control's `nativeArgs`.
 * Uses `in`-operator narrowing so no unsafe assertion is needed to index `value`.
 */
export declare function isOptionStyle(value: unknown): value is OptionStyle;
/** Runtime type guard for a `string[]` (a raw option list on `nativeArgs`). */
export declare function isStringArray(value: unknown): value is string[];
/**
 * Group-level option style defaults a `Form.Dropdown` / `Form.Radio` / `Form.ToggleButton`
 * resolves; every `Form.Option` child inherits any field it doesn't override.
 */
export interface GroupOptionDefaults {
    background: string;
    backgroundHover: string;
    backgroundSelected: string;
    bulletTexture: string;
    bulletSelectedTexture: string;
    bulletWidth: number;
    bulletHeight: number;
    bulletHoverTexture: string;
    bulletSelectedHoverTexture: string;
    fontType: string;
    fontScaleFactor: number;
    align: 'left' | 'center' | 'right';
}
export declare function isGroupDefaults(v: unknown): v is GroupOptionDefaults;
/** One option's resolved data, read off its (post-layout) `Form.Option` element. */
export interface OptionData {
    value: string;
    text: string;
    style: OptionStyle;
    geometry: OptionGeometry;
}
/**
 * Narrow a child node to a `Form.Option` element. Matches BOTH forms the lazy JSX
 * runtime produces: the un-invoked element (`type` === the `FormOption` function —
 * what a COMPONENT sees in its `children` prop, since buildTree invokes function
 * components later) and the invoked slot element (`type` === 'modal-option' — what a
 * WRITER sees post-walk). FormDropdown counts options at component time for
 * popupHeight; matching only the invoked form counted 0 there (popup rendered at the
 * 9px chrome height).
 */
export declare function isOptionElement(node: unknown): node is JSX.Element;
/** The `Form.Option` elements among a `children` value (nested arrays flattened). */
export declare function optionElements(children: unknown): JSX.Element[];
/**
 * Extract one option's value/text/style/geometry from its (post-layout) `Form.Option` element.
 * Geometry is RELATIVE to the group cell's own box (`groupX`/`groupY`): the layout phase
 * computes ABSOLUTE screen coords, but the RP option row anchors inside the group box.
 */
export declare function readOption(el: JSX.Element, defaults: GroupOptionDefaults, groupX?: number, groupY?: number): OptionData;
/** The fallback group defaults a writer uses when `nativeArgs` arrive malformed. */
export declare function fallbackGroupDefaults(): GroupOptionDefaults;
/**
 * Compute where an option's label sits inside its row — ALIGNMENT IS TS-SIDE: the RP has one
 * position-driven `option_label`; this measures the text with the real font metrics and turns
 * the requested `align` into a concrete x, plus vertical centering into y. `leftInset` is the
 * left-aligned start (pass bulletWidth + gap when a radio bullet occupies the row's left edge).
 */
export declare function optionLabelPosition(text: string, style: OptionStyle, rowWidth: number, rowHeight: number, leftInset: number): OptionLabelPosition;
/**
 * Encode one option into its own `bcuiv0007` payload blob — the string handed to the native
 * `ModalFormData.dropdown` as this option's entry. The engine surfaces it per-row as
 * `#custom_radio_text`, and the RP option controls decode it via the shared `'%.Ns'` slicing
 * grammar. Because each option gets its OWN payload, the 64-field marker budget resets per
 * option, and — since `options[]` bypasses the serializer's primitive prop channel — option
 * text is not subject to the 80-byte field cap here.
 *
 * Field ORDER is the RP decode contract. The LABEL GROUP leads (text [92], fontType [175],
 * fontScale [258], labelX [341], labelY [424]) so the RP `option_label` reuses label's
 * sequential group decode with just `$label_skip` = [92] — no bespoke bindings. Then:
 * height [507] (legacy), background [590], backgroundHover [673], backgroundSelected [756],
 * bulletTexture [839], bulletSelectedTexture [922], optionX [1005], optionY [1088],
 * optionWidth [1171], optionHeight [1254], bulletWidth [1337], bulletHeight [1420],
 * bulletHoverTexture [1503], bulletSelectedHoverTexture [1586].
 */
export declare function serializeSelectOption(text: string, style: OptionStyle, geometry?: OptionGeometry, label?: OptionLabelPosition): string;
