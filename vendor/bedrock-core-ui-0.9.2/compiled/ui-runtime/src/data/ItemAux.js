import { createContext } from '../core/fabric/context';
/**
 * Context that provides the item aux map (typeId → packed aux value) to the
 * component tree.
 *
 * **You must wrap your component tree with `<ItemAuxContext value={myMap}>` and
 * supply your own map.** No automatic seeding occurs. If no context is present,
 * `ItemRenderer` will throw an `ItemAuxError` at render time.
 *
 * ```tsx
 * import { ItemAuxContext, type ItemAuxMap } from '@bedrock-core/ui';
 *
 * const myMap: ItemAuxMap = { 'minecraft:stone': 65536, ... };
 *
 * render(player, (
 *   <ItemAuxContext value={myMap}>
 *     <MyScreen />
 *   </ItemAuxContext>
 * ));
 * ```
 *
 * @experimental
 */
export const ItemAuxContext = createContext(null);
