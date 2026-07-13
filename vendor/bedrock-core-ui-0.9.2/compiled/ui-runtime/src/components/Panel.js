import { emitLabel } from '../core/writers';
import { withControl } from './control';
export const Panel = ({ children, ...rest }) => ({
    type: 'panel',
    props: {
        ...withControl(rest),
        children,
    },
});
/** Serializes a `panel` into the static (label) slot. */
export const panelWriter = (payload, form, ctx) => {
    emitLabel(payload, form, ctx);
};
