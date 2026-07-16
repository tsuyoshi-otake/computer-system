import { usePlayer } from '../hooks/usePlayer';
import { useState } from '../hooks/useState';
import { showModalForm } from '../util/showForm';
import { Button } from './Button';
import { Text } from './Text';
/**
 * A text input rendered as a `Button` that *looks like* a field. Pressing it
 * opens a single-field `ModalFormData`; on confirm the typed value is committed
 * (internal state + `onChange`), on cancel nothing changes (`onCancel`). Either
 * way the root form re-presents with the current value.
 *
 * Supports both controlled (`value` + `onChange`) and uncontrolled
 * (`defaultValue`) usage, like the ore-styled `Toggle`.
 *
 * This is the unstyled runtime primitive (a peer of the base `Button`); supply a
 * `background` or compose a styled wrapper for a field-like appearance.
 *
 * @deprecated One-modal-per-field legacy. Use `Form.Input` inside a `<Form>` — all
 * controls share a single modal. Kept for existing screens; slated for removal.
 */
export const Input = ({ value, defaultValue, onChange, onCancel, label, placeholder, title, body, submitLabel, tooltip, enabled, face, ...rest }) => {
    const [internal, setInternal] = useState(defaultValue ?? '');
    const current = value ?? internal;
    const player = usePlayer();
    const faceText = current !== '' ? current : (placeholder ?? '');
    const handlePress = async () => {
        if (enabled === false) {
            return;
        }
        const response = await showModalForm(player, (form) => {
            form.textField(label ?? '', placeholder ?? '', { defaultValue: current, tooltip });
        }, { title: title ?? label, body, submitLabel });
        if (response.canceled) {
            onCancel?.();
            return;
        }
        const next = String(response.formValues?.[0] ?? '');
        setInternal(next);
        onChange?.(next);
    };
    return Button({
        ...rest,
        enabled,
        onPress: handlePress,
        children: face ?? Text({ children: faceText }),
    });
};
