import { emitButton } from '../core/writers';
import { resolveStateBackgrounds, withControl } from './control';
export const Button = ({ onPress, backgroundHover, backgroundPressed, backgroundLocked, children, ...rest }) => {
    const states = resolveStateBackgrounds({ background: rest.background, backgroundHover, backgroundPressed, backgroundLocked });
    return {
        type: 'button',
        props: {
            ...withControl({ ...rest, background: states.background }),
            backgroundHover: states.backgroundHover,
            backgroundPressed: states.backgroundPressed,
            backgroundLocked: states.backgroundLocked,
            onPress: onPress ?? (() => { }),
            children,
        },
    };
};
/** Serializes a `button` into the interactive (button) slot. */
export const buttonWriter = (payload, form, ctx, callbacks) => {
    emitButton(payload, form, ctx, callbacks);
};
