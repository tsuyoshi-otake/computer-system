/**
 * Hook that returns a function to request the current UI to close.
 * Useful for programmatically dismissing the active form from within a component.
 *
 * @returns A function that, when invoked, signals the runtime to exit the current form.
 */
export declare function useExit(): () => void;
