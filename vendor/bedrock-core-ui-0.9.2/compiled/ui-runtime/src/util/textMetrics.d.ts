import { TextFont } from '../components/Text';
export interface MeasureTextOptions {
    text: string;
    font?: TextFont;
    fontSize?: number;
}
/**
 * Truncates text to fit within maxWidth pixels, appending '...' when cut.
 * Operates on a single line (no \n handling).
 */
export declare function ellipsizeText(text: string, maxWidth: number, font?: TextFont, fontSize?: number): string;
/**
 * Pre-breaks text so it fits within maxWidth pixels, inserting `\n` at word
 * boundaries and `-\n` mid-word when a single word exceeds the line width.
 * Works in unscaled units (scaledMax = maxWidth / fontSize).
 */
export declare function wrapText(text: string, maxWidth: number, font?: TextFont, fontSize?: number): string;
/**
 * Approximate intrinsic text dimensions for Bedrock UI labels.
 * Formatting sequences (e.g. §a, §l) are treated as zero-width control codes.
 */
export declare function measureText({ text, font, fontSize, }: MeasureTextOptions): {
    width: number;
    height: number;
};
