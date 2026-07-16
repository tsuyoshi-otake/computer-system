import type { HighlightedCell } from "./syntaxHighlight.js";

export interface EditorScreen {
  readonly cursor: { readonly x: number; readonly y: number };
  readonly rows: readonly (readonly HighlightedCell[])[];
}

export type EditorResult =
  | { readonly kind: "continue"; readonly screen: EditorScreen }
  | {
      readonly closeAfter: boolean;
      readonly contents: string;
      readonly fileName?: string;
      readonly kind: "save";
      readonly screen: EditorScreen;
    }
  | {
      readonly discardedChanges: boolean;
      readonly kind: "closed";
      readonly screen: EditorScreen;
    };
