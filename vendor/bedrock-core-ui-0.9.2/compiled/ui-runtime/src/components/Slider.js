import { usePlayer } from '../hooks/usePlayer';
import { useState } from '../hooks/useState';
import { showModalForm } from '../util/showForm';
import { Button } from './Button';
import { Text } from './Text';
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
export const Slider = ({ min, max, step, value, defaultValue, onChange, onCancel, label, title, body, submitLabel, tooltip, enabled, face, ...rest }) => {
    const [internal, setInternal] = useState(defaultValue ?? min);
    const current = value ?? internal;
    const player = usePlayer();
    const faceText = `${current}`;
    const handlePress = async () => {
        if (enabled === false) {
            return;
        }
        const response = await showModalForm(player, (form) => {
            form.slider(label ?? '', min, max, { defaultValue: current, valueStep: step, tooltip });
        }, { title: title ?? label, body, submitLabel });
        if (response.canceled) {
            onCancel?.();
            return;
        }
        const next = Number(response.formValues?.[0] ?? current);
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
