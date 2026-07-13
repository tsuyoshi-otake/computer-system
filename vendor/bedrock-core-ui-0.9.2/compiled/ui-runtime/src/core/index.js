// Serialization
export { serialize, PROTOCOL_HEADER, VERSION, PAD_CHAR, TYPE_WIDTH, PREFIX_WIDTH, MARKER_WIDTH, FULL_WIDTH, TYPE_PREFIX, FIELD_MARKERS, PROTOCOL_HEADER_LENGTH, } from './serializer';
// Rendering
export { render } from './render';
// Component registry (custom native component registration)
export { registerComponent, getComponentDescriptor, getRegisteredTypes, isTransparentType, } from './componentRegistry';
// Writer slot helpers (for custom component writers)
export { emitButton, emitDropdown, emitHeader, emitInput, emitLabel, emitSlider, emitToggle } from './writers';
export { isFunction, isElement, isNode, isActionForm, isModalForm, isActionContext, isModalContext, } from './guards';
export { getCurrentFiber, invariant, createContext, } from './fabric';
