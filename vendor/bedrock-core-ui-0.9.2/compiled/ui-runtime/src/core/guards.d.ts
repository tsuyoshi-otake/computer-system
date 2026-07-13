import { ActionFormData, ModalFormData } from '@minecraft/server-ui';
import { JSX } from '../jsx';
import { ActionSerializationContext, FormTarget, ModalSerializationContext, SerializablePrimitive, SerializationContext } from './types';
export declare const isFunction: <T>(value: unknown) => value is (...args: unknown[]) => T;
export declare function isElement(value: unknown): value is JSX.Element;
export declare function isNode(value: unknown): value is JSX.Node;
/**
 * Narrows a {@link FormTarget} to an `ActionFormData`. The button slot
 * (`form.button()`) only exists on the ActionForm backend, so writers/presenters
 * guard on this before emitting interactive buttons.
 */
export declare function isActionForm(form: FormTarget): form is ActionFormData;
/**
 * Narrows a {@link FormTarget} to a `ModalFormData`. The typed modal controls
 * (`toggle`/`slider`/`dropdown`/`textField`) live on the modal backend.
 */
export declare function isModalForm(form: FormTarget): form is ModalFormData;
/**
 * Narrows a {@link SerializationContext} to the ActionForm walk (button index +
 * onPress map). Pairs with {@link isActionForm}.
 */
export declare function isActionContext(ctx: SerializationContext): ctx is ActionSerializationContext;
/**
 * Narrows a {@link SerializationContext} to the modal walk (control ordinal +
 * onChange map). Pairs with {@link isModalForm}.
 */
export declare function isModalContext(ctx: SerializationContext): ctx is ModalSerializationContext;
export declare function isSerializablePrimitive(value: unknown): value is SerializablePrimitive;
