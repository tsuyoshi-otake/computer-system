import { UNSTYLED_TEXTURE } from './control';
/**
 * ONE resolution rule for every stateful surface: `state ?? base ?? unstyled`.
 * The serialized fields therefore always carry a concrete texture path (fixed-width
 * payload fields — an empty string costs the same bytes), so the RP's empty-field
 * fallback gates never fire and a custom base can never be paired with a mismatched
 * default state. Elements that don't support a state simply skip that field.
 */
export function resolveStateBackgrounds(props) {
    const background = props.background ?? UNSTYLED_TEXTURE;
    return {
        background,
        backgroundHover: props.backgroundHover ?? background,
        backgroundPressed: props.backgroundPressed ?? background,
        backgroundLocked: props.backgroundLocked ?? background,
    };
}
