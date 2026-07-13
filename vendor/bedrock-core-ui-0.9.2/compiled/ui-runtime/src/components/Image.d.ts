import type { Writer } from '../core/types';
import { ControlProps } from './control';
import { FunctionComponent } from '../jsx';
export interface ImageProps extends ControlProps {
    /**
     * Path to the texture image from resource pack root
     * e.g., "textures/ui/my_image"
     * Max 80 characters
     * Defaults to the unstyled placeholder texture.
     */
    texture?: string;
}
export declare const Image: FunctionComponent<ImageProps>;
/**
 * Serializes an `image` into the ActionForm HEADER slot (engine-level type routing:
 * the factory instantiates only the slim header_router for it, not the 6-variant
 * label_router). Falls back to the label slot on the modal backend.
 */
export declare const imageWriter: Writer;
