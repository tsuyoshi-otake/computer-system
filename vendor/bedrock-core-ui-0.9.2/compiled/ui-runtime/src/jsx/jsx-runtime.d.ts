import { ControlProps } from '../components';
export interface NativeNode<P extends JSX.Props = JSX.Props> {
    type: string | FunctionComponent<P>;
    props: P;
    nativeArgs?: Record<string, unknown>;
}
export declare namespace JSX {
    type Element = NativeNode;
    type Node = Element | string | null | undefined | (Element | null | undefined)[];
    type Props = ControlProps & {
        [key: string]: unknown;
    } & {
        children?: Node;
    };
}
export type FunctionComponent<P = JSX.Props> = (props: P) => JSX.Element;
/**
 * Lazy JSX runtime - stores function references instead of calling them immediately.
 * Functions are called later during tree building when context is properly set up.
 */
export declare function renderJSX(tag: string | FunctionComponent, props: JSX.Props): JSX.Element;
export declare const jsx: typeof renderJSX;
export declare const jsxs: typeof renderJSX;
export declare const jsxDEV: typeof renderJSX;
export declare const Fragment: FunctionComponent<import("..").FragmentProps>;
