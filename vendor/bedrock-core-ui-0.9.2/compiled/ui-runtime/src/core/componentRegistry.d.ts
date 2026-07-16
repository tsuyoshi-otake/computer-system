import { type Writer } from './types';
/**
 * Describes how a native component type is serialized into the form.
 *
 * - `writer`  emits the component's payload via {@link emitButton} / {@link emitLabel}.
 * - `transparent` components emit nothing themselves; the serializer (and the
 *   layout / inherit phases) walk straight through to their children. Used by
 *   `fragment` and `context-provider`, and available to custom components.
 *
 * A descriptor is either renderable (has a `writer`) or `transparent: true`.
 */
export interface ComponentDescriptor {
    writer?: Writer;
    transparent?: boolean;
}
/**
 * Register a native component type. Throws if the type is already registered so
 * accidental clashes between addons surface immediately rather than silently
 * overriding each other.
 *
 * @param type - The component `type` string (must match the JSON UI control's `#type` gate).
 * @param descriptor - How to serialize the component (a `writer`, or `transparent: true`).
 */
export declare function registerComponent(type: string, descriptor: ComponentDescriptor): void;
/**
 * Resolve the descriptor for a component type, or `undefined` if not registered.
 */
export declare function getComponentDescriptor(type: string): ComponentDescriptor | undefined;
/**
 * Whether a type is registered as transparent (emits nothing; children only).
 */
export declare function isTransparentType(type: string): boolean;
/**
 * All currently registered component types, sorted — used for error messages.
 */
export declare function getRegisteredTypes(): string[];
