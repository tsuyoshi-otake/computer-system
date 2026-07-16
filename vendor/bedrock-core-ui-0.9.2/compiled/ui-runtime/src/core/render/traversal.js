import { CANONICAL_SCREEN } from '@bedrock-core/flexbox';
/**
 * Generate unique hierarchical ID for component instance.
 *
 * IDs follow the format: "playerName:path/to/Component" or "playerName:path/to/Component:key"
 * This ensures each component node in the tree has a unique, stable instance.
 *
 * @param player - Player rendering the component
 * @param component - Component function
 * @param key - Optional key prop from JSX (for list items)
 * @param parentPath - Path from root to parent component
 * @returns Unique component ID
 *
 * @example
 * generateComponentId(player, Example, undefined, [])
 *   → "Steve:Example"
 *
 * generateComponentId(player, Counter, undefined, ['Example'])
 *   → "Steve:Example/Counter"
 *
 * generateComponentId(player, TodoItem, 'todo-1', ['Example', 'TodoList'])
 *   → "Steve:Example/TodoList/TodoItem:todo-1"
 */
export function generateComponentId(player, component, key, parentPath) {
    const componentName = component.name || 'anonymous';
    const pathSegment = key ? `${componentName}:${key}` : componentName;
    const fullPath = [...parentPath, pathSegment].join('/');
    return `${player.id}:${fullPath}`;
}
/**
 * Create initial traversal context for tree building.
 * Used as the entry point for Phase 1.
 */
export function createInitialContext() {
    return {
        parentPath: [],
        idCounters: new Map(),
        currentContext: new Map(),
        parentFiber: undefined,
    };
}
/**
 * Create root context with initial parent state.
 * Used as the entry point for Phase 4 (inheritance).
 */
export function createRootContext(initialContext) {
    return {
        ...initialContext,
        parentState: {
            visible: true,
            enabled: true,
            x: 0,
            y: 0,
            width: CANONICAL_SCREEN.width,
            height: CANONICAL_SCREEN.height,
            position: 'relative',
        },
    };
}
