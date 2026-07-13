export function isContextProvider(element) {
    return element.type === 'context-provider' && element.props && '__context' in element.props;
}
