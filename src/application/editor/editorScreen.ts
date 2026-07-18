import type { HighlightedCell } from "./syntaxHighlight.js";

export interface EditorScreen {
  readonly cursor: { readonly x: number; readonly y: number };
  readonly rows: readonly (readonly HighlightedCell[])[];
}

export interface DosFileDialogEntry {
  readonly displayName: string;
  readonly fileName: string;
  readonly kind: "directory" | "file";
  readonly size: number;
}

export interface DosFileDialogSnapshot {
  readonly directory: string;
  readonly displayDirectory: string;
  readonly drives: readonly ("A:" | "C:")[];
  readonly entries: readonly DosFileDialogEntry[];
  readonly error?: string;
  readonly mediaGeneration: number;
}

export interface DosFileDialogRequest {
  readonly directory: string;
}

export type DosFileDialogProvider = (
  request: DosFileDialogRequest,
) => DosFileDialogSnapshot;

export type EditorResult =
  | { readonly kind: "continue"; readonly screen: EditorScreen }
  | {
      readonly closeAfter: boolean;
      readonly contents: string;
      readonly expectedContents?: string;
      readonly expectedTargetExists?: boolean;
      readonly fileName?: string;
      readonly kind: "save";
      readonly overwrite?: true;
      readonly screen: EditorScreen;
    }
  | {
      readonly fileName: string;
      readonly kind: "open";
      readonly screen: EditorScreen;
    }
  | {
      readonly discardedChanges: boolean;
      readonly kind: "closed";
      readonly screen: EditorScreen;
    }
  | {
      readonly command: string;
      readonly insertOutput: boolean;
      readonly kind: "shell";
      readonly screen: EditorScreen;
    }
  | {
      readonly column: number;
      readonly kind: "navigate";
      readonly line: number;
      readonly path: string;
      readonly screen: EditorScreen;
    }
  | {
      readonly contents: string;
      readonly kind: "settings-save";
      readonly screen: EditorScreen;
    }
  | {
      readonly kind: "settings-reload";
      readonly screen: EditorScreen;
    };
