import { ItemStack } from '@minecraft/server';
import { type Writer } from '../core/types';
import { FunctionComponent } from '../jsx';
import { ControlProps } from './control';
/** @experimental */
export interface ItemRendererProps extends ControlProps {
    item: ItemStack;
}
/**
 * Renders an item icon using the aux ID map supplied via `ItemAuxContext`.
 *
 * **Requires a manual `ItemAuxContext` wrapping the component tree.**
 * Throws `ItemAuxError` at render time if no provider is present.
 *
 * @experimental
 */
export declare const ItemRenderer: FunctionComponent<ItemRendererProps>;
/** Serializes an `item_renderer` into the interactive (button) slot, passing the aux id as icon. */
export declare const itemRendererWriter: Writer;
