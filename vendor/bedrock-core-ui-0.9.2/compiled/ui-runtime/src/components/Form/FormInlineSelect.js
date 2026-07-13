import { isModalForm } from '../../core/guards';
import { ModalFormError } from '../../core/types';
import { emitDropdown } from '../../core/writers';
import { UNSTYLED_TEXTURE, withControl } from '../control';
import { labelFontFields } from './controlPayload';
import { fallbackGroupDefaults, isGroupDefaults, optionElements, optionLabelPosition, readOption, serializeSelectOption, } from './optionPayload';
/**
 * Host type for the inline single-select slot (radio group / toggle-button group) →
 * native `ModalFormData.dropdown`, but the RP renders its option collection INLINE in
 * the form flow (all options always visible) instead of behind the dropdown popup.
 * Modal-only.
 */
export const MODAL_INLINE_SELECT_SLOT_TYPE = 'modal-inline-select';
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
export const FormInlineSelect = ({ name, defaultValue, optionBackground, optionHover, optionSelected, bullet, bulletSelected, bulletHover, bulletSelectedHover, bulletWidth, bulletHeight, optionFont, optionScale, optionAlign, children, ...layout }) => {
    const optionBase = optionBackground ?? UNSTYLED_TEXTURE;
    const groupFont = labelFontFields({ font: optionFont, scale: optionScale });
    // Group-level defaults an option inherits when it doesn't set its own field.
    const groupDefaults = {
        background: optionBase,
        backgroundHover: optionHover ?? optionBase,
        backgroundSelected: optionSelected ?? optionBase,
        bulletTexture: bullet ?? '',
        bulletSelectedTexture: bulletSelected ?? '',
        bulletHoverTexture: bulletHover ?? bullet ?? '',
        bulletSelectedHoverTexture: bulletSelectedHover ?? bulletSelected ?? '',
        bulletWidth: bulletWidth ?? 12,
        bulletHeight: bulletHeight ?? 12,
        fontType: groupFont.fontType,
        fontScaleFactor: groupFont.fontScaleFactor,
        align: optionAlign ?? 'left',
    };
    return {
        type: MODAL_INLINE_SELECT_SLOT_TYPE,
        // The Form.Option children ride here so the layout phase lays them out (each gets its own
        // jsonUIx/y/w/h). They are NOT serialized as controls — the writer reads their geometry and
        // the serialize walk skips MODAL_OPTION_SLOT_TYPE nodes.
        props: {
            // Full-size top-left container: the cell reserves the group's flow box (from the caller's
            // layout); options position absolutely inside it from their own blob geometry.
            ...withControl(layout),
            children,
        },
        // Group defaults ride the writer-only side channel (never serialized). The writer combines
        // them with each option child's own overrides + post-layout geometry to build the blobs.
        nativeArgs: {
            name,
            defaultValue: defaultValue ?? '',
            groupDefaults,
        },
    };
};
// ── Writer ──────────────────────────────────────────────────────────────────────
/**
 * Serialize a `modal-inline-select` into the native modal dropdown, reading each laid-out
 * `Form.Option` child's geometry + data (all option handling lives in optionPayload). Same
 * native `dropdown()` call as the popup dropdown — only the per-option blobs (carrying flex
 * geometry) and the RP inline decode differ.
 */
export const formInlineSelectWriter = (payload, form, ctx, _callbacks, props, nativeArgs, children) => {
    if (!isModalForm(form)) {
        throw new ModalFormError('Form.Radio / Form.ToggleButton must be rendered inside a `<Form>`.');
    }
    const name = typeof nativeArgs?.name === 'string' ? nativeArgs.name : '';
    const defaultValue = typeof nativeArgs?.defaultValue === 'string' ? nativeArgs.defaultValue : '';
    const defaults = isGroupDefaults(nativeArgs?.groupDefaults)
        ? nativeArgs.groupDefaults
        : { ...fallbackGroupDefaults(), background: UNSTYLED_TEXTURE, backgroundHover: UNSTYLED_TEXTURE, backgroundSelected: UNSTYLED_TEXTURE };
    // The group cell's own layout box — option geometry is encoded relative to it.
    const groupX = typeof props?.jsonUIx === 'number' ? props.jsonUIx : 0;
    const groupY = typeof props?.jsonUIy === 'number' ? props.jsonUIy : 0;
    const opts = optionElements(children).map(el => readOption(el, defaults, groupX, groupY));
    const defaultIndex = Math.max(0, opts.findIndex(o => o.value === defaultValue));
    // One blob per option: style + flex geometry + the TS-COMPUTED label position (alignment
    // left the RP). Left-aligned labels start past a radio bullet (bulletWidth + 4px gap) —
    // the bullet-dependent label offset.
    const encodedOptions = opts.map(o => serializeSelectOption(o.text, o.style, o.geometry, optionLabelPosition(o.text, o.style, o.geometry.width, o.geometry.height, o.style.bulletTexture !== '' ? o.style.bulletWidth + 4 : 4)));
    emitDropdown(payload, form, ctx, name, encodedOptions, defaultIndex);
};
