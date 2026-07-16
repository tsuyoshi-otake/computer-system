import { SerializationError } from './types';
/**
 * Registry mapping native component `type` strings to their serialization
 * behavior. Built-ins are registered once via `registerNativeComponents`;
 * consumers add their own native JSON UI elements with {@link registerComponent}.
 *
 * Keyed by the string `type` because function components are resolved to host
 * elements (string types) before serialization, so the writer can only be
 * looked up by that string at emit time.
 */
const registry = new Map();
/**
 * Register a native component type. Throws if the type is already registered so
 * accidental clashes between addons surface immediately rather than silently
 * overriding each other.
 *
 * @param type - The component `type` string (must match the JSON UI control's `#type` gate).
 * @param descriptor - How to serialize the component (a `writer`, or `transparent: true`).
 */
export function registerComponent(type, descriptor) {
    if (registry.has(type)) {
        throw new SerializationError(`registerComponent(): type "${type}" is already registered. `
            + `Pick a unique, namespaced type for your custom component.`);
    }
    if (!descriptor.transparent && !descriptor.writer) {
        throw new SerializationError(`registerComponent(): descriptor for "${type}" must provide a writer or be transparent.`);
    }
    registry.set(type, descriptor);
}
/**
 * Resolve the descriptor for a component type, or `undefined` if not registered.
 */
export function getComponentDescriptor(type) {
    return registry.get(type);
}
/**
 * Whether a type is registered as transparent (emits nothing; children only).
 */
export function isTransparentType(type) {
    return registry.get(type)?.transparent ?? false;
}
/**
 * All currently registered component types, sorted — used for error messages.
 */
export function getRegisteredTypes() {
    return [...registry.keys()].sort();
}
