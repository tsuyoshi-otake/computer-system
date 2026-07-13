import { isModalForm } from '../../core/guards';
import { ModalFormError } from '../../core/types';
import { emitInput } from '../../core/writers';
import { measureText } from '../../util/textMetrics';
import { resolveStateBackgrounds, withControl } from '../control';
import { labelPayloadFields } from './controlPayload';
/** Host type for the native modal text-field slot (modal-only). */
export const MODAL_INPUT_SLOT_TYPE = 'modal-input';
/** Default left inset (px) of the field text from the box edge (the old text_area inset). */
const FIELD_TEXT_INSET_X = 8;
/**
 * Text field → `ModalFormData.textField`. Result (`Form.onSubmit`): `string`.
 * Modal-only; render inside a `<Form>`. Accepts the same control/layout props as any
 * component; geometry is computed by the layout phase and encoded into the label
 * payload for the RP to position/style the native widget.
 */
export const FormInput = ({ name, placeholder, defaultValue, font, scale, textOffsetX, textOffsetY, placeholderOffsetX, placeholderOffsetY, backgroundHover, backgroundPressed, backgroundLocked, ...layout }) => {
    const box = resolveStateBackgrounds({ background: layout.background, backgroundHover, backgroundPressed, backgroundLocked });
    // Vertical-centering default: the labels hang from a [1,1] frame at the box's
    // left-middle, so y = -lineHeight/2 centers a single line on the box.
    const lineHeight = measureText({ text: 'Ag', font, fontSize: scale ?? 1.0 }).height;
    const centeredY = -Math.round(lineHeight / 2);
    return {
        type: MODAL_INPUT_SLOT_TYPE,
        props: {
            // Control block first so the state textures land at BUTTON-IDENTICAL byte
            // offsets ([1024-1272] right after the reserved block). The writer calls
            // `form.textField()` directly from `nativeArgs` (no `build` closure).
            ...withControl({ ...layout, background: box.background }),
            backgroundHover: box.backgroundHover, // [1024-1106] like Button
            backgroundPressed: box.backgroundPressed, // [1107-1189] focused/pressed box
            backgroundLocked: box.backgroundLocked, // [1190-1272]
            // Two label GROUPS (see labelPayloadFields): value at [1273-1687], placeholder at
            // [1688-2102]. Text slots stay '' — both labels read their text from the native
            // edit-box channel; the groups carry font + position only.
            ...labelPayloadFields('value', {
                font, scale,
                x: textOffsetX ?? FIELD_TEXT_INSET_X,
                y: textOffsetY ?? centeredY,
            }),
            ...labelPayloadFields('placeholder', {
                font, scale,
                x: placeholderOffsetX ?? FIELD_TEXT_INSET_X,
                y: placeholderOffsetY ?? centeredY,
            }),
        },
        // Native args ride the writer-only side channel: never serialized, so they cost no
        // payload bytes and can't shift RP-read offsets. placeholder/defaultValue stay raw —
        // they render inside the native edit box, where decode styling does not apply.
        nativeArgs: {
            name,
            placeholder: placeholder ?? '',
            defaultValue: defaultValue ?? '',
        },
    };
};
/** Serializes a `modal-input` into the native modal text field control. */
export const formInputWriter = (payload, form, ctx, _callbacks, _props, nativeArgs) => {
    if (!isModalForm(form)) {
        throw new ModalFormError('Form.Input must be rendered inside a `<Form>`.');
    }
    const name = typeof nativeArgs?.name === 'string' ? nativeArgs.name : '';
    const placeholder = typeof nativeArgs?.placeholder === 'string' ? nativeArgs.placeholder : '';
    const defaultValue = typeof nativeArgs?.defaultValue === 'string' ? nativeArgs.defaultValue : '';
    emitInput(payload, form, ctx, name, placeholder, defaultValue);
};
