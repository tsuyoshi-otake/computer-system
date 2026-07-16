import type { Writer } from '../core/types';
import { FunctionComponent, JSX } from '../jsx';
import { ControlProps, StateBackgroundProps } from './control';
export interface ButtonProps extends ControlProps, StateBackgroundProps {
    children?: JSX.Node;
    onPress?: () => unknown | Promise<unknown>;
}
export declare const Button: FunctionComponent<ButtonProps>;
/** Serializes a `button` into the interactive (button) slot. */
export declare const buttonWriter: Writer;
