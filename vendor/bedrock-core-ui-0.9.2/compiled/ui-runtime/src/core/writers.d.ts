import type { ModalFormData } from '@minecraft/server-ui';
import { type FormTarget, type SerializationContext } from './types';
/**
 * Slot helpers for native component writers.
 *
 * The RP renders everything through just two ActionForm primitives:
 *   - `form.button()` → routed by `button_router` (interactive controls)
 *   - `form.label()`  → routed by `label_router` (static controls)
 *
 * A writer picks one slot in a single call. `emitButton` also owns the
 * button-index / `onPress` callback bookkeeping so every interactive writer
 * (built-in or custom) stays consistent with the presenter's selection mapping.
 *
 * Modal forms reuse the same serialize walk but emit through `ModalFormData`'s
 * typed controls. Each native control has its OWN emitter here — `emitToggle`,
 * `emitSlider`, `emitDropdown`, `emitInput` — exactly like `emitButton`/`emitLabel`
 * own the ActionForm slots. Each emitter owns the ordinal → `name` bookkeeping (so the
 * presenter can fan `response.formValues` back out) AND makes the typed native call,
 * taking its native args (min/max/options/…) as direct function arguments — so a
 * non-primitive like the dropdown's `options` array never has to pass through the
 * serializer's primitive-only payload channel. Decorative nodes (image/panel) keep using
 * `emitLabel`, which works on both form types — only the logic controls differ between
 * the two backends.
 */
type Callbacks = Record<string, (...args: unknown[]) => void>;
/**
 * Emit an interactive (button-slot) control. Registers `callbacks.onPress`
 * against the current button index, advances the index, then writes the button.
 *
 * @param payload - Serialized component payload.
 * @param form - Target form.
 * @param ctx - Serialization context tracking the button index → callback map.
 * @param callbacks - Function props collected for this element (e.g. `onPress`).
 * @param icon - Optional icon path passed to `form.button` (e.g. item aux id).
 */
export declare function emitButton(payload: string, form: FormTarget, ctx: SerializationContext | undefined, callbacks: Callbacks, icon?: string): void;
/**
 * Emit a static (label-slot) control. `label()` exists on both `ActionFormData`
 * and `ModalFormData`, so decorative nodes share this writer across both backends.
 *
 * On the native modal, `form.label()` ALSO consumes a `response.formValues` slot
 * (the engine returns `null` there) — confirmed empirically: a form with decorative
 * `<Panel>` wrappers among its fields returned a `formValues` array 1 entry longer
 * per label, with every later control's value shifted by that many slots. So a modal
 * label must advance `modalControlIndex` WITHOUT registering a `ModalControlEntry`
 * (an empty name skips it in `collectValues`'s re-keying) to keep every later
 * control's recorded ordinal aligned with its real position in `formValues`.
 *
 * @param payload - Serialized component payload.
 * @param form - Target form.
 * @param ctx - Serialization context; advances the modal ordinal when present.
 */
export declare function emitLabel(payload: string, form: FormTarget, ctx?: SerializationContext): void;
/**
 * Emit a static control through the ActionForm HEADER slot. The native factory routes
 * header entries to their own control_id, so a header-slot cell instantiates ONLY the
 * slim `header_router` (one component variant) instead of the full label_router variant
 * fan-out — engine-level type routing, no `#type` gating cost at all. Used for `image`.
 *
 * On the modal backend this falls back to the label slot: modal headers' payload
 * channel + formValues behavior are unproven, while modal labels are (see emitLabel).
 */
export declare function emitHeader(payload: string, form: FormTarget, ctx?: SerializationContext): void;
/**
 * Emit a native modal toggle → `ModalFormData.toggle`. Records the ordinal, then makes
 * the typed call.
 *
 * Parameter order mirrors {@link emitButton} (`payload, form, ctx, …`), then this
 * control's own args.
 *
 * @param payload - The control's serialized control-block payload (native label channel).
 * @param form - Target modal form.
 * @param ctx - Serialization context tracking the modal ordinal → name registry.
 * @param name - Result key for this control (its `name` prop).
 * @param defaultValue - Initial on/off state.
 */
export declare function emitToggle(payload: string, form: ModalFormData, ctx: SerializationContext | undefined, name: string, defaultValue: boolean): void;
/**
 * Emit a native modal slider → `ModalFormData.slider`. Records the ordinal, then makes
 * the typed call.
 *
 * Parameter order mirrors {@link emitButton} (`payload, form, ctx, …`), then this
 * control's own args.
 *
 * @param payload - The control's serialized control-block payload (native label channel).
 * @param form - Target modal form.
 * @param ctx - Serialization context tracking the modal ordinal → name registry.
 * @param name - Result key for this control (its `name` prop).
 * @param min - Minimum selectable value.
 * @param max - Maximum selectable value.
 * @param defaultValue - Initial value.
 * @param valueStep - Increment between values, or `undefined` for the native default.
 */
export declare function emitSlider(payload: string, form: ModalFormData, ctx: SerializationContext | undefined, name: string, min: number, max: number, defaultValue: number, valueStep: number | undefined): void;
/**
 * Emit a native modal dropdown → `ModalFormData.dropdown`. Records the ordinal, then makes
 * the typed call. `options` (a non-primitive array) arrives as a direct argument, so it
 * never passes through the serializer's primitive-only payload channel.
 *
 * Parameter order mirrors {@link emitButton} (`payload, form, ctx, …`), then this
 * control's own args.
 *
 * @param payload - The control's serialized control-block payload (native label channel).
 * @param form - Target modal form.
 * @param ctx - Serialization context tracking the modal ordinal → name registry.
 * @param name - Result key for this control (its `name` prop).
 * @param options - Selectable option values.
 * @param defaultValueIndex - Initial selection as an index into `options`.
 */
export declare function emitDropdown(payload: string, form: ModalFormData, ctx: SerializationContext | undefined, name: string, options: string[], defaultValueIndex: number): void;
/**
 * Emit a native modal text field → `ModalFormData.textField`. Records the ordinal, then
 * makes the typed call.
 *
 * Parameter order mirrors {@link emitButton} (`payload, form, ctx, …`), then this
 * control's own args.
 *
 * @param payload - The control's serialized control-block payload (native label channel).
 * @param form - Target modal form.
 * @param ctx - Serialization context tracking the modal ordinal → name registry.
 * @param name - Result key for this control (its `name` prop).
 * @param placeholder - Text shown when the field is empty.
 * @param defaultValue - Initial text.
 */
export declare function emitInput(payload: string, form: ModalFormData, ctx: SerializationContext | undefined, name: string, placeholder: string, defaultValue: string): void;
export {};
