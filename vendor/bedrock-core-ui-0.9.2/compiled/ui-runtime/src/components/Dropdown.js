import { usePlayer } from '../hooks/usePlayer';
import { useState } from '../hooks/useState';
import { showModalForm } from '../util/showForm';
import { Button } from './Button';
import { Text } from './Text';
/**
 * A dropdown rendered as a `Button` that *looks like* a field. Pressing it opens
 * a single-dropdown `ModalFormData`; on confirm the chosen option is committed
 * (internal state + `onChange`), on cancel nothing changes (`onCancel`). Either
 * way the root form re-presents with the current selection.
 *
 * The native modal works on item *indices*; this maps the selected index back to
 * the matching `options` entry, so the public API stays value-based like `Input`.
 *
 * This is the unstyled runtime primitive (a peer of the base `Button`); supply a
 * `background` or compose a styled wrapper for a field-like appearance.
 *
 * @deprecated One-modal-per-field legacy. Use `Form.Dropdown` inside a `<Form>` — all
 * controls share a single modal. Kept for existing screens; slated for removal.
 */
export const Dropdown = ({ options, value, defaultValue, onChange, onCancel, label, title, body, submitLabel, tooltip, enabled, face, ...rest }) => {
    const [internal, setInternal] = useState(defaultValue ?? options[0] ?? '');
    const current = value ?? internal;
    const player = usePlayer();
    const currentIndex = Math.max(0, options.indexOf(current));
    const faceText = options[currentIndex] ?? '';
    const handlePress = async () => {
        if (enabled === false) {
            return;
        }
        const response = await showModalForm(player, (form) => {
            form.dropdown(label ?? '', options, { defaultValueIndex: currentIndex, tooltip });
        }, { title: title ?? label, body, submitLabel });
        if (response.canceled) {
            onCancel?.();
            return;
        }
        const index = Number(response.formValues?.[0] ?? currentIndex);
        const next = options[index] ?? current;
        setInternal(next);
        onChange?.(next, index);
    };
    return Button({
        ...rest,
        enabled,
        onPress: handlePress,
        children: face ?? Text({ children: faceText }),
    });
};
