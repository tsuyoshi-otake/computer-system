import { JSX } from '../jsx/jsx-runtime';
import type { LayoutProps } from './layout';
/**
 * Blank-canvas placeholder texture (3×3 nineslice, 1px borders) — the default look
 * of every primitive surface the user hasn't styled.
 */
export declare const UNSTYLED_TEXTURE = "textures/ui/unstyled";
export interface ControlProps extends LayoutProps {
    visible?: boolean;
    enabled?: boolean;
    background?: string;
}
export { resolveStateBackgrounds, type StateBackgroundProps } from './stateBackground';
/**
 * Combines both layout and control props, applying defaults to any missing values.
 * All JSON UI components need at least these values as they define the base control properties.
 *
 * SERIALIZATION ORDER (must match control.json deserialization):
 * Protocol v0004 - Layout computed values: x, y, width, height calculated by flex engine
 * After protocol header (9 bytes: "bcuiv****") and type (string, 83 bytes), fields are serialized in this exact order:
 *
 * Byte Allocation Map (1024-byte control block):
 * [0-8]:     Protocol header (9 bytes)
 * [9-91]:    Type field (string, 83 bytes)
 * [92-174]:  Field 1: width (number, 83 bytes) - computed width from layout
 * [175-257]: Field 2: height (number, 83 bytes) - computed height from layout
 * [258-340]: Field 3: x (number, 83 bytes) - computed x position from layout
 * [341-423]: Field 4: y (number, 83 bytes) - computed y position from layout
 * [424-431]: Field 5: visible (bool, 8 bytes) - visibility state
 * [432-439]: Field 6: enabled (bool, 8 bytes) - interaction enabled state
 * [440-522]: Field 7: background (string, 83 bytes) - optional background texture path
 * [523-605]: Field 8: region (number, 83 bytes) - region/scroll index this element belongs to
 * [606-1023]: Reserved (418 bytes)
 *
 * The `region` field was carved from the reserved block (v0005: 501 → v0006: 418) so the
 * absolute offset of every component-specific field after the reserved block (e.g.
 * backgroundHover at [1024]) is unchanged.
 *
 * Reserved calculation: 1024 - 9 - 83 - (6 × 83) - (2 × 8) - 83 (background) - 83 (region) = 418 bytes
 * (up to 1024 bytes total reserved block for future expansion)
 *
 * Component-specific properties are appended after the reserved block.
 *
 * NOTE: x, y, width, height are computed by the layout phase and should not be manually set.
 * Use flex layout properties (flexGrow, width, etc.) to control sizing instead.
 *
 * @param props Component properties extending ControlProps
 * @returns Object with all control properties filled with defaults and canonical ordering
 */
export declare function withControl(props: JSX.Props): JSX.Props;
interface JSONUILayoutProps extends JSX.Props {
    jsonUIx: number;
    jsonUIy: number;
    jsonUIWidth: number;
    jsonUIHeight: number;
}
export declare function isControlled(props: JSX.Props): props is JSONUILayoutProps;
