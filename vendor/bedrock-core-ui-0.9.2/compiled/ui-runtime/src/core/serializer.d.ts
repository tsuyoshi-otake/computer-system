import { JSX } from '../jsx';
import { FormTarget, SerializableProps, SerializationContext } from './types';
/**
 * This makes each full field substring unique even when two field values & padding are identical.
 * JSON UI subtraction removes ALL occurrences, so uniqueness is required to avoid unintentionally
 * stripping later identical fields. With a unique trailing marker per field, removing the first
 * field substring cannot match a later one (different marker) even if the padded content matches.
 */
export declare const FIELD_MARKERS: string[];
export declare const PAD_CHAR = ";";
export declare const VERSION = "v0007";
export declare const PROTOCOL_HEADER = "bcuiv0007";
export declare const PROTOCOL_HEADER_LENGTH = 9;
export declare const TYPE_WIDTH: {
    s: number;
    n: number;
    b: number;
    r: number;
};
export declare const PREFIX_WIDTH: {
    s: number;
    n: number;
    b: number;
    r: number;
};
export declare const MARKER_WIDTH = 1;
export declare const FULL_WIDTH: {
    s: number;
    n: number;
    b: number;
    r: number;
};
export declare const TYPE_PREFIX: {
    s: string;
    n: string;
    b: string;
    r: string;
};
/**
 * Serialize a JSX element and its children into the provided form.
 * @param element - JSX element to serialize
 * @param form - Form data to populate
 * @param context - Serialization context for collecting button callbacks
 */
export declare function serialize({ type, props: { children, ...rest }, nativeArgs }: JSX.Element, form: FormTarget, context: SerializationContext): void;
/**
 * Serialize component type and props to a string payload.
 *
 * @param component - Component type and props
 * @returns [serialized component string, total byte length]
 */
export declare function serializeProps({ type, ...props }: SerializableProps & {
    type: string;
}): [string, number];
/**
 * Per-scroll geometry surfaced by the layout pass for title encoding.
 *
 * A scroll is a viewport rectangle on screen plus a scrollable content `extent` along its
 * `axis`. The RP pool of generic scroll controls reads one of these per index and
 * positions/sizes itself from it.
 */
export interface ScrollMetrics {
    /** Scroll axis: 'y' (vertical) or 'x' (horizontal). */
    axis: 'x' | 'y';
    /** Viewport top-left x (px, screen space). */
    x: number;
    /** Viewport top-left y (px, screen space). */
    y: number;
    /** Viewport width (px). */
    width: number;
    /** Viewport height (px). */
    height: number;
    /** Content extent (px) along the scroll axis — the scrollable length. */
    extent: number;
}
/** Per-scroll title field count: axis + x + y + width + height + extent. */
export declare const SCROLL_FIELD_COUNT = 6;
/**
 * Fixed byte offset (after the header) of the optional `<Background>` texture field —
 * the RP decode contract of `core_ui_common.form_background`. The field always sits
 * after a FULL complement of scroll blocks (root + {@link MAX_SCROLLS}): when a
 * background is set, both title serializers pad the gap with reserved `;` bytes so
 * this offset never moves, regardless of scroll count or backend. Unused scroll slots
 * decode to `''`, exactly like absent blocks, so all existing decoders are unaffected.
 * 83 + 5·498 = 2573.
 */
export declare const BACKGROUND_TITLE_SKIP: number;
/**
 * Serialize the form title metadata: a flat list of scroll viewports.
 *
 * Layout: PROTOCOL_HEADER (9) + s:'scrolls' (83) + per scroll
 *   [ s:axis (83), n:x (83), n:y (83), n:width (83), n:height (83), n:extent (83) ].
 *
 * The leading `'scrolls'` field is a fixed marker (field 0) so every scroll block sits at a
 * predictable offset: scroll `i`'s block starts at FULL_WIDTH.s + i·(SCROLL_FIELD_COUNT·83)
 * bytes after the header. A pooled scroll whose index is beyond the emitted list decodes an
 * empty axis and hides itself — so no explicit count field is needed.
 *
 * Geometry is consumed RP-side via `use_anchored_offset` (viewport position) and
 * `#size_binding_*` (viewport size); the content panel uses the `[1,1]` size_anchor trick to
 * overflow only the scroll axis by `extent`.
 *
 * A non-empty `background` pads the scroll list out to the full root+{@link MAX_SCROLLS}
 * complement with reserved `;` bytes (unused slots decode `''`, same as absent blocks)
 * and appends ONE string field at the fixed {@link BACKGROUND_TITLE_SKIP}, where the
 * single static `core_ui_common.form_background` decodes it. When empty, nothing is
 * emitted — a background-less title stays byte-identical to the plain v0007 layout.
 *
 * @param scrolls - Scroll viewports in index order (index 0 is the root scroll)
 * @param background - Optional full-screen backdrop texture path ('' = none)
 * @returns Full title string for form.title()
 */
export declare function serializeScrollMetadata(scrolls: readonly ScrollMetrics[], background?: string): string;
/**
 * Serialize the modal form's title: the scroll metadata (identical layout to
 * {@link serializeScrollMetadata} — a modal always has EXACTLY the root scroll, so
 * its block ends at a fixed offset [590]) followed by any extra fields, appended in
 * insertion order. The serializer is a pure encoder: the extra fields arrive fully
 * resolved from their owning component modules (e.g. `formButtonTitleFields` — see
 * FormButton.ts for the Form.Button byte-offset contract).
 *
 * A non-empty `background` pads past the fixed modal layout (scroll block + submit
 * block [590 abs] + exit block [1353 abs], 763 bytes each, ending 2107 after the
 * header) with reserved `;` bytes and appends ONE string field at the same fixed
 * {@link BACKGROUND_TITLE_SKIP} the ActionForm title uses, so the single static
 * `core_ui_common.form_background` serves both backends. Omitted entirely when empty.
 *
 * @param scrolls - Scroll viewports; a modal must pass exactly one (the root).
 * @param extraFields - Resolved fields appended after the scroll block.
 * @param background - Optional full-screen backdrop texture path ('' = none).
 * @returns Full title string for `form.title()`.
 */
export declare function serializeModalTitle(scrolls: readonly ScrollMetrics[], extraFields: SerializableProps, background?: string): string;
