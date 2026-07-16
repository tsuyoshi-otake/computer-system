export { withControl, type ControlProps } from './control';
export { type ModalFieldProps } from './modalField';
export { type AlignContent, type AlignItems, type AlignSelf, type Display, type FlexDirection, type FlexSize, type FlexWrap, type JustifyContent, type LayoutProps, type Position, type Spacing, } from './layout';
export { Background, BACKGROUND_SLOT_TYPE, type BackgroundProps } from './Background';
export { Button, buttonWriter, type ButtonProps } from './Button';
export { Dropdown, type DropdownProps } from './Dropdown';
export { Form, ModalContext, MODAL_FORM_SLOT_TYPE, type FormConfig, type FormProps, type FormValues, type FormButtonKind, type FormButtonProps, type FormDropdownProps, type FormInlineSelectProps, type FormOptionProps, type FormInputProps, type FormSliderProps, type FormToggleProps, } from './Form';
export { Fragment, type FragmentProps } from './Fragment';
export { Image, imageWriter, type ImageProps } from './Image';
export { Input, type InputProps } from './Input';
export { Slider, type SliderProps } from './Slider';
export { ItemRenderer, itemRendererWriter, type ItemRendererProps } from './ItemRenderer';
export { Panel, panelWriter, type PanelProps } from './Panel';
export { Scroll, SCROLL_SLOT_TYPE, MAX_SCROLLS, MAX_POOLED_SCROLLS, type ScrollAxis, type ScrollProps } from './Scroll';
export { Text, textWriter, isTextElementType, TEXT_SHADOW_TYPE, TEXT_WRAP_TYPE, TEXT_SHADOW_WRAP_TYPE, type TextFont, type TextOverflow, type TextProps, type TextStyle, type TextWordBreak, } from './Text';
/**
 * Registers the built-in native component types into the component registry.
 *
 * Idempotent and called from `render()` — the built-ins are guaranteed present
 * before the first serialize/layout pass.
 */
export declare function registerNativeComponents(): void;
