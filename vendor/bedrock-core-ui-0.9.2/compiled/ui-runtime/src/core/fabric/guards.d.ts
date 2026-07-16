import { JSX } from '../../jsx';
import { Context } from './types';
export declare function isContextProvider(element: JSX.Element): element is JSX.Element & {
    type: 'context-provider';
    props: JSX.Props & {
        __context: Context<unknown>;
        value: unknown;
    };
};
