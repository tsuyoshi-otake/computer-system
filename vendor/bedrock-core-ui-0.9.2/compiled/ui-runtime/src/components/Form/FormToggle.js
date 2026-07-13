import { isModalForm } from '../../core/guards';
import { ModalFormError } from '../../core/types';
import { emitToggle } from '../../core/writers';
import { resolveStateBackgrounds, withControl } from '../control';
/** Host type for the native modal toggle slot (modal-only; the restriction pass rejects it elsewhere). */
export const MODAL_TOGGLE_SLOT_TYPE = 'modal-toggle';
/**
 * Boolean toggle field → `ModalFormData.toggle`. Result (`Form.onSubmit`): `boolean`.
 * Modal-only; render inside a `<Form>`. Accepts the same control/layout props as any
 * component; geometry is computed by the layout phase and encoded into the label
 * payload for the RP to position/style the native widget.
 */
export const FormToggle = ({ name, defaultValue, backgroundHover, backgroundPressed, backgroundLocked, checkedBackground, checkedHover, checkedLocked, ...layout }) => {
    // Unchecked side mirrors Button; checked side follows the same rule against its
    // own base (single `background` styles both sides when nothing else is given).
    const unchecked = resolveStateBackgrounds({ background: layout.background, backgroundHover, backgroundPressed, backgroundLocked });
    const checkedBase = checkedBackground ?? unchecked.background;
    return {
        type: MODAL_TOGGLE_SLOT_TYPE,
        props: {
            // Control block first so the state textures land at BUTTON-IDENTICAL byte
            // offsets ([1024-1272] right after the reserved block), toggle-specific
            // fields after. The writer calls `form.toggle()` directly from `nativeArgs`
            // (no `build` closure).
            ...withControl({ ...layout, background: unchecked.background }),
            backgroundHover: unchecked.backgroundHover, // [1024-1106] like Button
            backgroundPressed: unchecked.backgroundPressed, // [1107-1189] reserved (no pressed state)
            backgroundLocked: unchecked.backgroundLocked, // [1190-1272]
            checkedBackground: checkedBase, // [1273-1355] toggle-specific
            checkedHover: checkedHover ?? checkedBase, // [1356-1438]
            checkedLocked: checkedLocked ?? checkedBase, // [1439-1521]
        },
        // Native args ride the writer-only side channel: never serialized, so they cost no
        // payload bytes and can't shift RP-read offsets.
        nativeArgs: {
            name,
            defaultValue: defaultValue ?? false,
        },
    };
};
/** Serializes a `modal-toggle` into the native modal toggle control. */
export const formToggleWriter = (payload, form, ctx, _callbacks, _props, nativeArgs) => {
    if (!isModalForm(form)) {
        throw new ModalFormError('Form.Toggle must be rendered inside a `<Form>`.');
    }
    const name = typeof nativeArgs?.name === 'string' ? nativeArgs.name : '';
    const defaultValue = nativeArgs?.defaultValue === true;
    emitToggle(payload, form, ctx, name, defaultValue);
};
