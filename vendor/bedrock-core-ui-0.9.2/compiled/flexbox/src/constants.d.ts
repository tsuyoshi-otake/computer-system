/** Reference screen dimensions in texels. */
export declare const SCREEN: {
    readonly POCKET: {
        readonly width: 320;
        readonly height: 210;
    };
    readonly DESKTOP: {
        readonly width: 376;
        readonly height: 250;
    };
};
/**
 * The canonical screen used as the default root reference for layout.
 * Percentage values on the root node resolve against these dimensions.
 * Pocket is chosen as the canonical screen because it is the smallest
 * supported target — layouts that fit here scale up on Desktop.
 */
export declare const CANONICAL_SCREEN: {
    readonly width: 320;
    readonly height: 210;
};
