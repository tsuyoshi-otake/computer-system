import { serializeProps } from '../../core/serializer';
import { measureText } from '../../util/textMetrics';
import { labelFontFields } from './controlPayload';
import { FormOption, MODAL_OPTION_SLOT_TYPE } from './FormOption';
/** Host `type` tag for a per-option payload blob (decoded per-row by the RP option controls). */
export const DROPDOWN_OPTION_TYPE = 'dropdown-option';
/** Zero geometry — the dropdown popup rows flow (engine-positioned), so they encode no offsets. */
export const NO_OPTION_GEOMETRY = { x: 0, y: 0, width: 0, height: 0 };
/**
 * Runtime type guard for the `optionStyle` carried on a control's `nativeArgs`.
 * Uses `in`-operator narrowing so no unsafe assertion is needed to index `value`.
 */
export function isOptionStyle(value) {
    return (typeof value === 'object'
        && value !== null
        && 'fontType' in value && typeof value.fontType === 'string'
        && 'fontScaleFactor' in value && typeof value.fontScaleFactor === 'number'
        && 'align' in value && (value.align === 'left' || value.align === 'center' || value.align === 'right')
        && 'height' in value && typeof value.height === 'number'
        && 'background' in value && typeof value.background === 'string'
        && 'backgroundHover' in value && typeof value.backgroundHover === 'string'
        && 'backgroundSelected' in value && typeof value.backgroundSelected === 'string'
        && 'bulletTexture' in value && typeof value.bulletTexture === 'string'
        && 'bulletSelectedTexture' in value && typeof value.bulletSelectedTexture === 'string'
        && 'bulletWidth' in value && typeof value.bulletWidth === 'number'
        && 'bulletHeight' in value && typeof value.bulletHeight === 'number'
        && 'bulletHoverTexture' in value && typeof value.bulletHoverTexture === 'string'
        && 'bulletSelectedHoverTexture' in value && typeof value.bulletSelectedHoverTexture === 'string');
}
/** Runtime type guard for a `string[]` (a raw option list on `nativeArgs`). */
export function isStringArray(value) {
    return Array.isArray(value) && value.every(v => typeof v === 'string');
}
export function isGroupDefaults(v) {
    return typeof v === 'object' && v !== null && 'background' in v && 'fontType' in v;
}
function readNumber(v, fallback = 0) {
    return typeof v === 'number' ? v : fallback;
}
function readString(v, fallback) {
    return typeof v === 'string' ? v : fallback;
}
function readAlign(v, fallback) {
    return v === 'left' || v === 'center' || v === 'right' ? v : fallback;
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
export function isOptionElement(node) {
    return (typeof node === 'object' && node !== null && 'type' in node
        && ((node).type === MODAL_OPTION_SLOT_TYPE || (node).type === FormOption));
}
/** The `Form.Option` elements among a `children` value (nested arrays flattened). */
export function optionElements(children) {
    const arr = Array.isArray(children) ? children.flat(Infinity) : children === undefined ? [] : [children];
    return arr.filter(isOptionElement);
}
/**
 * Extract one option's value/text/style/geometry from its (post-layout) `Form.Option` element.
 * Geometry is RELATIVE to the group cell's own box (`groupX`/`groupY`): the layout phase
 * computes ABSOLUTE screen coords, but the RP option row anchors inside the group box.
 */
export function readOption(el, defaults, groupX = 0, groupY = 0) {
    const p = el.props;
    return {
        value: readString(p.value, ''),
        text: readString(p.label, ''),
        style: {
            fontType: readString(p.__optionFontType, defaults.fontType),
            fontScaleFactor: readNumber(p.__optionFontScale, defaults.fontScaleFactor),
            align: readAlign(p.align, defaults.align),
            // Legacy flow-height slot is unused (rows size from geometry / the fixed popup row).
            height: 0,
            background: readString(p.background, defaults.background),
            backgroundHover: readString(p.backgroundHover, defaults.backgroundHover),
            backgroundSelected: readString(p.backgroundSelected, defaults.backgroundSelected),
            bulletTexture: readString(p.bullet, defaults.bulletTexture),
            bulletSelectedTexture: readString(p.bulletSelected, defaults.bulletSelectedTexture),
            bulletWidth: readNumber(p.bulletWidth, defaults.bulletWidth),
            bulletHeight: readNumber(p.bulletHeight, defaults.bulletHeight),
            bulletHoverTexture: readString(p.bulletHover, defaults.bulletHoverTexture),
            bulletSelectedHoverTexture: readString(p.bulletSelectedHover, defaults.bulletSelectedHoverTexture),
        },
        geometry: {
            x: readNumber(p.jsonUIx) - groupX,
            y: readNumber(p.jsonUIy) - groupY,
            width: readNumber(p.jsonUIWidth),
            height: readNumber(p.jsonUIHeight),
        },
    };
}
/** The fallback group defaults a writer uses when `nativeArgs` arrive malformed. */
export function fallbackGroupDefaults() {
    return {
        background: '', backgroundHover: '', backgroundSelected: '',
        bulletTexture: '', bulletSelectedTexture: '', bulletWidth: 12, bulletHeight: 12,
        bulletHoverTexture: '', bulletSelectedHoverTexture: '',
        ...labelFontFields(), align: 'left',
    };
}
/**
 * Compute where an option's label sits inside its row — ALIGNMENT IS TS-SIDE: the RP has one
 * position-driven `option_label`; this measures the text with the real font metrics and turns
 * the requested `align` into a concrete x, plus vertical centering into y. `leftInset` is the
 * left-aligned start (pass bulletWidth + gap when a radio bullet occupies the row's left edge).
 */
export function optionLabelPosition(text, style, rowWidth, rowHeight, leftInset) {
    // Invert the serialized fields back to measurement inputs (fontScaleFactor = scale / 0.5).
    const font = style.fontType === 'MinecraftTen' ? 'minecraftTen' : 'mojangles';
    const m = measureText({ text, font, fontSize: style.fontScaleFactor * 0.5 });
    const x = style.align === 'center'
        ? Math.round((rowWidth - m.width) / 2)
        : style.align === 'right'
            ? Math.round(rowWidth - 4 - m.width)
            : leftInset;
    return { x, y: Math.round((rowHeight - m.height) / 2) };
}
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
export function serializeSelectOption(text, style, geometry = NO_OPTION_GEOMETRY, label = { x: 4, y: 0 }) {
    const [payload] = serializeProps({
        type: DROPDOWN_OPTION_TYPE,
        // --- the label GROUP (label contract): text, fontType, fontScale, x, y ---
        text, // [92] → #custom_radio_text (visible label)
        fontType: style.fontType, // [175]
        fontScaleFactor: style.fontScaleFactor, // [258]
        labelX: label.x, // [341] → option_label anchored X (TS-computed alignment)
        labelY: label.y, // [424] → option_label anchored Y (vertical centering)
        // --- row fields ---
        height: style.height, // [507] (legacy flow row height, unused)
        background: style.background, // [590] idle option face
        backgroundHover: style.backgroundHover, // [673]
        backgroundSelected: style.backgroundSelected, // [756]
        bulletTexture: style.bulletTexture, // [839] unselected bullet glyph
        bulletSelectedTexture: style.bulletSelectedTexture, // [922] selected bullet glyph
        // Per-option flex geometry (px) — the inline row self-positions from these via
        // use_anchored_offset (x/y) at this size (w/h). Dropdown popup rows pass zeros.
        optionX: geometry.x, // [1005] → row #anchored_offset_value_x
        optionY: geometry.y, // [1088] → row #anchored_offset_value_y
        optionWidth: geometry.width, // [1171] → row #size_binding_x
        optionHeight: geometry.height, // [1254] → row #size_binding_y
        bulletWidth: style.bulletWidth, // [1337] bullet glyph width px
        bulletHeight: style.bulletHeight, // [1420] bullet glyph height px
        bulletHoverTexture: style.bulletHoverTexture, // [1503] unselected bullet on hover
        bulletSelectedHoverTexture: style.bulletSelectedHoverTexture, // [1586] selected bullet on hover
    });
    return payload;
}
