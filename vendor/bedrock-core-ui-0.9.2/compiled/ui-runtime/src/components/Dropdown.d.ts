import { FunctionComponent, JSX } from '../jsx';
import { ModalFieldProps } from './modalField';
/** @deprecated Prefer `Form.Dropdown` inside a `<Form>`. See {@link ModalFieldProps}. */
export interface DropdownProps extends ModalFieldProps {
    /** Selectable options shown inside the modal dropdown. */
    options: string[];
    /** Controlled selection. When provided, the field reflects this on every render. */
    value?: string;
    /** Initial selection for the uncontrolled case. Defaults to the first option. */
    defaultValue?: string;
    /** Called with the chosen option (and its index) when the player confirms the modal. */
    onChange?: (value: string, index: number) => void;
    /** Called when the player cancels (X / Esc) the modal. */
    onCancel?: () => void;
    /**
     * Overrides the default text face. When provided, this node is rendered inside
     * the button instead of the value `Text`, letting styled wrappers draw a custom
     * face (e.g. value text plus a chevron) while reusing the modal/state logic.
     */
    face?: JSX.Node;
}
/**
 * A dropdown rendered as a `Button` that *looks like* a field. Pressing it opens
 * a single-dropdown `ModalFormData`; on confirm the chosen option is committed
 * (internal state + `onChange`), on cancel nothing changes (`onCancel`). Either
 * way the root form re-presents with the current selection.
 *
 * The native modal works on item *indices*; this maps the selected index back to
 * the matching `options` entry, so the public API stays value-based like `Input`.
 *
 * This is the unstyled runtime primitive (a peer of the base `Button`); supply a
 * `background` or compose a styled wrapper for a field-like appearance.
 *
 * @deprecated One-modal-per-field legacy. Use `Form.Dropdown` inside a `<Form>` — all
 * controls share a single modal. Kept for existing screens; slated for removal.
 */
export declare const Dropdown: FunctionComponent<DropdownProps>;
