import { emitHeader } from '../core/writers';
import { UNSTYLED_TEXTURE, withControl } from './control';
export const Image = ({ texture, ...rest }) => ({
    type: 'image',
    props: {
        ...withControl(rest),
        texture: texture ?? UNSTYLED_TEXTURE,
    },
});
/**
 * Serializes an `image` into the ActionForm HEADER slot (engine-level type routing:
 * the factory instantiates only the slim header_router for it, not the 6-variant
 * label_router). Falls back to the label slot on the modal backend.
 */
export const imageWriter = (payload, form, ctx) => {
    emitHeader(payload, form, ctx);
};
