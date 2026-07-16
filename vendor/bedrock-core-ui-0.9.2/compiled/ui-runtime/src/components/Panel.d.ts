import type { Writer } from '../core/types';
import { ControlProps } from './control';
import { FunctionComponent, JSX } from '../jsx';
export interface PanelProps extends ControlProps {
    children?: JSX.Node;
}
export declare const Panel: FunctionComponent<PanelProps>;
/** Serializes a `panel` into the static (label) slot. */
export declare const panelWriter: Writer;
