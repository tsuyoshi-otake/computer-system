import { createContext } from '../../core/fabric/context';
import { FormButton } from './FormButton';
import { FormDropdown } from './FormDropdown';
import { FormInlineSelect } from './FormInlineSelect';
import { FormInput } from './FormInput';
import { FormOption } from './FormOption';
import { FormSlider } from './FormSlider';
import { FormToggle } from './FormToggle';
/**
 * The host `type` string emitted by {@link Form}. The serializer treats it as
 * transparent (no payload, children only); the presenter detects it on the built
 * tree to switch from the ActionForm backend to the native `ModalFormData` one.
 */
export const MODAL_FORM_SLOT_TYPE = 'modal-form';
/**
 * Marks that the calling subtree is inside a `<Form>`. The restriction pass reads it
 * to enforce that modal controls only appear under a `Form` and that no `Button` /
 * nested `Form` appears within one. `null` (the default) means "not in a modal".
 */
export const ModalContext = createContext(null);
/**
 * Root that switches the renderer into native modal-form mode. Its presence on the
 * rendered tree makes the presenter build one atomic `ModalFormData` (toggle / slider
 * / dropdown / text-field fields with hardcoded submit + esc) instead of the
 * all-buttons ActionForm. Values arrive once, on submit, via {@link FormConfig.onSubmit}.
 *
 * Field declarations are the `Form.*` members; a heading is authored as a `<Text>`
 * (the modal has no `title`/`body` prop). Exactly one `Form.Button type="submit"` is
 * required (and at most one `type="exit"`), positioned anywhere in the flow:
 *
 * ```tsx
 * <Form onSubmit={v => { v.sound; v.volume; }}>
 *   <Text>Settings</Text>
 *   <Form.Toggle   name="sound"  defaultValue={true} />
 *   <Form.Slider   name="volume" min={0} max={10} />
 *   <Form.Dropdown name="mode"   options={['A', 'B']} />
 *   <Form.Input    name="nick" />
 *   <Form.Button   type="submit" label="Save" />
 * </Form>
 * ```
 *
 * Restrictions (a runtime pass during build): a modal tree may contain only `Form.*`
 * controls and decorative nodes — no regular `Button`, no nested `<Form>`, and not
 * mixed with ActionForm-only roots. Mix the two form kinds across separate `render()`
 * calls (e.g. via navigation), never nested.
 */
const FormRoot = ({ onSubmit, onCancel, children, }) => {
    const config = { onSubmit, onCancel };
    // Provide the config to descendants (so the restriction pass sees the modal scope)
    // and emit the transparent `modal-form` marker the presenter detects. The marker
    // carries the config so the presenter reads chrome + lifecycle without re-walking
    // providers.
    return ModalContext({
        value: config,
        children: {
            type: MODAL_FORM_SLOT_TYPE,
            props: {
                __formConfig: config,
                children,
            },
        },
    });
};
/**
 * The `Form` root plus its field-control members. Assembled with `Object.assign` so
 * the namespace shape is built structurally (no narrowing cast).
 */
export const Form = Object.assign(FormRoot, {
    Toggle: FormToggle,
    Slider: FormSlider,
    Dropdown: FormDropdown,
    InlineSelect: FormInlineSelect,
    Option: FormOption,
    Input: FormInput,
    Button: FormButton,
});
