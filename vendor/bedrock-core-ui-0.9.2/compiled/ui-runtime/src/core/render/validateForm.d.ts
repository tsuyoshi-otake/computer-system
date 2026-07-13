import type { JSX } from '../../jsx';
/**
 * Enforce the modal-form restrictions on a built tree. This is the runtime backstop
 * behind the type-level guards on `<Form>`; it catches dynamically-built or
 * type-escaped trees before the presenter picks a backend.
 *
 * Rules:
 *  - A modal-only control (`Form.Toggle`/`Slider`/`Dropdown`/`Input`) must live inside
 *    a `<Form>`.
 *  - Inside a `<Form>`: no ActionForm-only interactive control (`Button`,
 *    `ItemRenderer`) and no nested `<Form>`.
 *  - A tree may not mix a `<Form>` with ActionForm-only interactive roots, which the
 *    "no Button inside Form" rule already covers — anything interactive in a modal
 *    tree is under the Form scope by construction (the Form marker is at the root).
 *
 * @throws ModalFormError on any violation.
 */
export declare function validateForm(tree: JSX.Element): void;
