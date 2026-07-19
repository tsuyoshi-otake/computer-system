import { utf8ByteLength } from "../../domain/text/utf8.js";
import type { Cs486CompileError } from "./cs486AsmDiagnostics.js";

export const maximumGuestTranscriptEntries = 256;
export const maximumGuestTranscriptDiagnostics = 256;
export const maximumGuestDiagnosticNotes = 8;
export const maximumGuestTranscriptRows = 4_096;
export const maximumGuestTranscriptBytes = 256_000;

export type GuestTranscriptChannel = "stderr" | "stdout";
export type GuestDiagnosticSeverity = "error" | "note" | "warning";

export interface GuestDiagnosticNote {
  readonly column?: number;
  readonly line?: number;
  readonly message: string;
  readonly source?: string;
}

export interface GuestDiagnostic {
  readonly code: string;
  readonly column?: number;
  readonly line?: number;
  readonly message: string;
  readonly notes: readonly GuestDiagnosticNote[];
  readonly severity: GuestDiagnosticSeverity;
  readonly source?: string;
}

export type GuestTranscriptEntry =
  | {
      readonly channel: GuestTranscriptChannel;
      readonly kind: "text";
      readonly text: string;
    }
  | {
      readonly diagnostic: GuestDiagnostic;
      readonly kind: "diagnostic";
    };

export interface GuestToolchainTranscript {
  readonly entries: readonly GuestTranscriptEntry[];
}

export interface GuestToolchainResult {
  readonly cpuCycles?: number;
  readonly exitCode: number;
  readonly transcript: GuestToolchainTranscript;
}

export interface GuestTranscriptMergeResult {
  readonly limitExceeded: boolean;
  readonly transcript: GuestToolchainTranscript;
}

export interface NavigableGuestDiagnostic {
  readonly column: number;
  readonly diagnostic: GuestDiagnostic;
  readonly fileName: string;
  readonly line: number;
  readonly outputLine: number;
}

export interface RenderedGuestTranscript {
  readonly navigableDiagnostics: readonly NavigableGuestDiagnostic[];
  readonly orderedRows: readonly string[];
  readonly stderr: string;
  readonly stdout: string;
}

export interface GuestTranscriptRenderOptions {
  readonly displaySource?: (source: string) => string;
  readonly profile: "dos" | "linux";
}

export function createGuestToolchainTranscript(
  entries: readonly GuestTranscriptEntry[],
): GuestToolchainTranscript {
  if (entries.length > maximumGuestTranscriptEntries) {
    throw new RangeError(
      `guest transcript entries exceed ${String(maximumGuestTranscriptEntries)}`,
    );
  }
  let bytes = 0;
  let diagnostics = 0;
  let rows = 0;
  const frozenEntries = entries.map((entry): GuestTranscriptEntry => {
    if (entry.kind === "text") {
      const text = normalizeGuestTranscriptText(entry.text);
      bytes += utf8ByteLength(text) + 16;
      rows += transcriptTextRows(text);
      return Object.freeze({ channel: entry.channel, kind: "text", text });
    }
    diagnostics += 1;
    if (diagnostics > maximumGuestTranscriptDiagnostics) {
      throw new RangeError(
        `guest transcript diagnostics exceed ${String(maximumGuestTranscriptDiagnostics)}`,
      );
    }
    const diagnostic = freezeDiagnostic(entry.diagnostic);
    bytes += diagnosticBytes(diagnostic);
    rows += 1 + diagnostic.notes.length;
    return Object.freeze({ diagnostic, kind: "diagnostic" });
  });
  if (rows > maximumGuestTranscriptRows) {
    throw new RangeError(
      `guest transcript rows exceed ${String(maximumGuestTranscriptRows)}`,
    );
  }
  if (bytes > maximumGuestTranscriptBytes) {
    throw new RangeError(
      `guest transcript bytes exceed ${String(maximumGuestTranscriptBytes)}`,
    );
  }
  return Object.freeze({ entries: Object.freeze(frozenEntries) });
}

const emptyTranscript = createGuestToolchainTranscript([]);

export function emptyGuestToolchainTranscript(): GuestToolchainTranscript {
  return emptyTranscript;
}

export function guestToolchainTranscriptFromStreams(
  stdout: string,
  stderr: string,
): GuestToolchainTranscript {
  return createGuestToolchainTranscript([
    ...(stdout.length === 0
      ? []
      : [{ channel: "stdout" as const, kind: "text" as const, text: stdout }]),
    ...(stderr.length === 0
      ? []
      : [{ channel: "stderr" as const, kind: "text" as const, text: stderr }]),
  ]);
}

export function guestToolchainTranscriptFromFailure(
  text: string,
): GuestToolchainTranscript {
  return createGuestToolchainTranscript([
    { channel: "stderr", kind: "text", text },
  ]);
}

export function guestToolchainTranscriptFromCompileError(
  error: Cs486CompileError,
  fallbackSource: string,
): GuestToolchainTranscript {
  return createGuestToolchainTranscript([
    {
      diagnostic: {
        code: error.code,
        column: error.column ?? 1,
        line: error.line ?? 1,
        message: error.detail,
        notes: error.notes.map((note) => ({
          ...(note.span === undefined
            ? {}
            : {
                column: note.span.start.column,
                line: note.span.start.line,
                source: note.span.start.source,
              }),
          message: note.message,
        })),
        severity: "error",
        source: error.source ?? fallbackSource,
      },
      kind: "diagnostic",
    },
  ]);
}

export function concatGuestToolchainTranscripts(
  transcripts: readonly GuestToolchainTranscript[],
): GuestToolchainTranscript {
  return createGuestToolchainTranscript(
    transcripts.flatMap((transcript) => transcript.entries),
  );
}

export function concatGuestToolchainTranscriptsOrFailure(
  transcripts: readonly GuestToolchainTranscript[],
  failureText: string,
): GuestTranscriptMergeResult {
  try {
    return Object.freeze({
      limitExceeded: false,
      transcript: concatGuestToolchainTranscripts(transcripts),
    });
  } catch (error: unknown) {
    if (!(error instanceof RangeError)) throw error;
    return Object.freeze({
      limitExceeded: true,
      transcript: guestToolchainTranscriptFromFailure(failureText),
    });
  }
}

export function renderGuestToolchainTranscript(
  transcript: GuestToolchainTranscript,
  options: GuestTranscriptRenderOptions,
): RenderedGuestTranscript {
  const newline = options.profile === "dos" ? "\r\n" : "\n";
  const displaySource =
    options.displaySource ?? ((source: string): string => source);
  const orderedRows: string[] = [];
  const navigableDiagnostics: NavigableGuestDiagnostic[] = [];
  let pendingRow: string | undefined;
  let stderr = "";
  let stdout = "";

  const appendOrderedText = (text: string): void => {
    if (text.length === 0) return;
    const parts = text.split("\n");
    pendingRow = (pendingRow ?? "") + (parts.shift() ?? "");
    for (const part of parts) {
      orderedRows.push(pendingRow);
      pendingRow = part;
    }
  };
  const flushPendingRow = (): void => {
    if (pendingRow !== undefined && pendingRow.length > 0) {
      orderedRows.push(pendingRow);
    }
    pendingRow = undefined;
  };

  for (const entry of transcript.entries) {
    if (entry.kind === "text") {
      const renderedText = entry.text.replaceAll("\n", newline);
      if (entry.channel === "stdout") stdout += renderedText;
      else stderr += renderedText;
      appendOrderedText(entry.text);
      continue;
    }
    flushPendingRow();
    const diagnostic = entry.diagnostic;
    const row = renderDiagnostic(diagnostic, options.profile, displaySource);
    const outputLine = orderedRows.length;
    orderedRows.push(row);
    stderr += `${row}${newline}`;
    if (
      diagnostic.source !== undefined &&
      diagnostic.line !== undefined &&
      diagnostic.column !== undefined
    ) {
      navigableDiagnostics.push(
        Object.freeze({
          column: diagnostic.column,
          diagnostic,
          fileName: diagnostic.source,
          line: diagnostic.line,
          outputLine,
        }),
      );
    }
    for (const note of diagnostic.notes) {
      const noteRow = renderDiagnosticNote(
        note,
        options.profile,
        displaySource,
      );
      orderedRows.push(noteRow);
      stderr += `${noteRow}${newline}`;
    }
  }
  flushPendingRow();
  if (orderedRows.length > maximumGuestTranscriptRows) {
    throw new RangeError("rendered guest transcript row limit exceeded");
  }
  return Object.freeze({
    navigableDiagnostics: Object.freeze(navigableDiagnostics),
    orderedRows: Object.freeze(orderedRows),
    stderr,
    stdout,
  });
}

function freezeDiagnostic(diagnostic: GuestDiagnostic): GuestDiagnostic {
  if (
    !boundedDiagnosticText(diagnostic.code, 64) ||
    !boundedDiagnosticText(diagnostic.message, 4_096) ||
    (diagnostic.source !== undefined &&
      !boundedDiagnosticText(diagnostic.source, 512)) ||
    !validLocation(diagnostic.line, diagnostic.column)
  ) {
    throw new RangeError("guest diagnostic is invalid");
  }
  if (diagnostic.notes.length > maximumGuestDiagnosticNotes) {
    throw new RangeError(
      `guest diagnostic notes exceed ${String(maximumGuestDiagnosticNotes)}`,
    );
  }
  const notes = Object.freeze(
    diagnostic.notes.map((note) => {
      if (
        !boundedDiagnosticText(note.message, 2_048) ||
        (note.source !== undefined &&
          !boundedDiagnosticText(note.source, 512)) ||
        !validLocation(note.line, note.column)
      ) {
        throw new RangeError("guest diagnostic note is invalid");
      }
      return Object.freeze({ ...note });
    }),
  );
  return Object.freeze({ ...diagnostic, notes });
}

function normalizeGuestTranscriptText(text: string): string {
  if (text.includes("\0"))
    throw new RangeError("guest transcript contains NUL");
  return text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

function transcriptTextRows(text: string): number {
  if (text.length === 0) return 0;
  return Math.max(1, text.split("\n").length - (text.endsWith("\n") ? 1 : 0));
}

function diagnosticBytes(diagnostic: GuestDiagnostic): number {
  let bytes =
    64 +
    utf8ByteLength(diagnostic.code) +
    utf8ByteLength(diagnostic.message) +
    utf8ByteLength(diagnostic.source ?? "");
  for (const note of diagnostic.notes) {
    bytes +=
      32 + utf8ByteLength(note.message) + utf8ByteLength(note.source ?? "");
  }
  return bytes;
}

function boundedDiagnosticText(value: string, maximum: number): boolean {
  return (
    value.length > 0 && value.length <= maximum && !/[\0\r\n]/u.test(value)
  );
}

function validLocation(
  line: number | undefined,
  column: number | undefined,
): boolean {
  return (
    (line === undefined ||
      (Number.isSafeInteger(line) && line >= 1 && line <= 65_535)) &&
    (column === undefined ||
      (Number.isSafeInteger(column) && column >= 1 && column <= 4_096)) &&
    ((line === undefined && column === undefined) ||
      (line !== undefined && column !== undefined))
  );
}

function renderDiagnostic(
  diagnostic: GuestDiagnostic,
  profile: "dos" | "linux",
  displaySource: (source: string) => string,
): string {
  const source =
    diagnostic.source === undefined
      ? undefined
      : displaySource(diagnostic.source);
  const location =
    source === undefined
      ? ""
      : diagnostic.line === undefined
        ? `${source}: `
        : profile === "dos"
          ? `${source}(${String(diagnostic.line)},${String(diagnostic.column)}): `
          : `${source}:${String(diagnostic.line)}:${String(diagnostic.column)}: `;
  return `${location}${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`;
}

function renderDiagnosticNote(
  note: GuestDiagnosticNote,
  profile: "dos" | "linux",
  displaySource: (source: string) => string,
): string {
  const source =
    note.source === undefined ? undefined : displaySource(note.source);
  const location =
    source === undefined
      ? ""
      : note.line === undefined
        ? `${source}: `
        : profile === "dos"
          ? `${source}(${String(note.line)},${String(note.column)}): `
          : `${source}:${String(note.line)}:${String(note.column)}: `;
  return `${location}note: ${note.message}`;
}
