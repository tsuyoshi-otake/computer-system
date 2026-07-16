/**
 * Reducer hook for managing state transitions via actions.
 *
 * @typeParam S - State type.
 * @typeParam A - Action type.
 * @param reducer - Pure function that maps (state, action) to next state.
 * @param initial - Initial state value used on first mount.
 * @returns A tuple with the current state and a dispatch function for actions.
 */
export declare function useReducer<S, A>(reducer: (s: S, a: A) => S, initial: S): [S, (a: A) => void];
