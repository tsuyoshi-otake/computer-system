import { withControl } from '../control';
import { labelFontFields } from './controlPayload';
/**
 * Host type for `Form.Option` — LAYOUT-ONLY: the flex engine lays it out (so it gets
 * computed x/y/w/h like any element), but the serializer does NOT emit it as a native
 * control — its data + geometry are read by the parent select's writer and packed into
 * the native option blob. Skipped by the serialize walk (see serializer.ts).
 */
export const MODAL_OPTION_SLOT_TYPE = 'modal-option';
/**
 * One option of a `Form.Radio` / `Form.ToggleButton`. LAYOUT-ONLY: the flex engine lays it out
 * (so it gets a computed `x/y/width/height` like any element — position it with the usual
 * `ControlProps`/`LayoutProps`: `flex`, `gap`, `width`, `paddingTop`, …), but it is NOT emitted
 * as a native control. The parent inline-select's writer reads each option element's post-layout
 * geometry + its `label`/`value`/style off `props` and packs them into that option's native blob,
 * which the RP option row decodes to SELF-POSITION via `use_anchored_offset`.
 *
 * So authoring `<Form.Radio><Form.Option value="a" label="A" /> …</Form.Radio>` gives every option
 * real, fully-customizable flex layout — the same layout system every other component uses — while
 * selection + the single submitted index still ride the one native `dropdown()` the group emits.
 */
export const FormOption = ({ value, label, background, backgroundHover, backgroundSelected, bullet, bulletSelected, bulletHover, bulletSelectedHover, bulletWidth, bulletHeight, font, scale, align, ...layout }) => {
    // Pre-resolve the font fields here (the writer wants fontType/fontScaleFactor, not the raw
    // LabelFont), only when the caller set them — otherwise the group's resolved values are used.
    const fontFields = font !== undefined || scale !== undefined
        ? labelFontFields({ font, scale })
        : undefined;
    // A layout-only host node. `withControl(layout)` extracts the caller's layout props into
    // `__layout` (so the flex engine lays the option out) and seeds the jsonUIx/y/width/height the
    // layout phase fills. The option-DATA fields ride alongside for the writer to read post-layout;
    // the node is never serialized as a control (skipped in serialize), so nothing else is emitted.
    return {
        type: MODAL_OPTION_SLOT_TYPE,
        props: {
            ...withControl(layout),
            value,
            label,
            background,
            backgroundHover,
            backgroundSelected,
            bullet,
            bulletSelected,
            bulletHover,
            bulletSelectedHover,
            bulletWidth,
            bulletHeight,
            align,
            // Resolved font fields (or undefined → inherit the group's), so the writer needn't re-map.
            __optionFontType: fontFields?.fontType,
            __optionFontScale: fontFields?.fontScaleFactor,
        },
    };
};
