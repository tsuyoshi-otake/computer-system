import { Context } from './types';
/**
 * Creates a Context object that components can use to share values down the component tree
 * without passing props through every level.
 *
 * @param defaultValue - The value used when a component consumes the context
 *                       but there is no matching Provider above it in the tree
 * @returns Context object with a Provider component
 *
 * @example
 * const ThemeContext = createContext<'light' | 'dark'>('light');
 *
 * function App() {
 *   return (
 *     <ThemeContext value="dark">
 *       <ThemedComponent />
 *     </ThemeContext>
 *   );
 * }
 *
 * function ThemedComponent() {
 *   const theme = useContext(ThemeContext);
 *   return <Panel>{theme}</Panel>;
 * }
 */
export declare function createContext<T>(defaultValue: T): Context<T>;
