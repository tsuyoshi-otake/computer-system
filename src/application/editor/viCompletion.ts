import {
  indexViDocument,
  maximumViIdentifierCharacters,
  resolveViFiletype,
  viKeywords,
  type ViDocumentIndex,
  type ViIncludeReference,
  type ViSymbol,
} from "./viLanguage.js";
import type {
  ViCompleteCase,
  ViCompletionSource,
  ViOptions,
} from "./viOptions.js";

export const maximumViBufferSummaries = 8;
export const maximumViCompletionCandidates = 64;
export const maximumViIncludeBytes = 32 * 1_024;
export const maximumViIncludeCandidates = 256;
export const maximumViJumpHistory = 16;

export interface ViBufferSummary {
  readonly index: ViDocumentIndex;
  readonly path: string;
}
export interface ViExternalDocument {
  readonly contents: string;
  readonly path: string;
}
export interface ViExternalContextRequest {
  readonly fileName: string | undefined;
  readonly includes: readonly ViIncludeReference[];
}
export type ViExternalContextProvider = (
  request: ViExternalContextRequest,
) => readonly ViExternalDocument[];
export interface ViCompletionCandidate {
  readonly source: ViCompletionSource;
  readonly text: string;
}
export interface ViWordPrefix {
  readonly start: number;
  readonly text: string;
}

const canonicalSources: readonly ViCompletionSource[] = [
  "current",
  "buffers",
  "symbols",
  "keywords",
  "includes",
];

export function viWordPrefix(line: string, column: number): ViWordPrefix {
  const before = [...line].slice(0, column).join("");
  const text = /[A-Za-z_.$?][A-Za-z0-9_.$?]*$/u.exec(before)?.[0] ?? "";
  return { start: column - [...text].length, text };
}

export function viWordAt(line: string, column: number): string {
  const characters = [...line];
  let start = Math.min(column, characters.length);
  if (!wordPart(characters[start] ?? "") && start > 0) start -= 1;
  while (start > 0 && wordPart(characters[start - 1] ?? "")) start -= 1;
  let end = start;
  while (end < characters.length && wordPart(characters[end] ?? "")) end += 1;
  const word = characters.slice(start, end).join("");
  return word.length <= maximumViIdentifierCharacters ? word : "";
}

export function collectViCompletions(
  options: ViOptions,
  prefix: string,
  cursorLine: number,
  current: ViDocumentIndex,
  buffers: readonly ViBufferSummary[],
  includes: readonly ViExternalDocument[],
): readonly ViCompletionCandidate[] {
  const enabled = new Set(options.completesources);
  const result: ViCompletionCandidate[] = [];
  const seen = new Set<string>();
  const add = (text: string, source: ViCompletionSource): void => {
    if (
      result.length >= maximumViCompletionCandidates ||
      text === prefix ||
      text.length > maximumViIdentifierCharacters ||
      !matchesPrefix(text, prefix, options.completecase)
    )
      return;
    const key = comparisonKey(text, options.completecase, prefix);
    if (seen.has(key)) return;
    seen.add(key);
    result.push({ source, text });
  };

  for (const source of canonicalSources) {
    if (!enabled.has(source) || result.length >= maximumViCompletionCandidates)
      continue;
    if (source === "current") {
      for (const word of [...current.words].sort(
        (left, right) =>
          Math.abs(left.line - cursorLine) - Math.abs(right.line - cursorLine),
      ))
        add(word.text, source);
    } else if (source === "buffers") {
      for (const buffer of buffers)
        for (const word of buffer.index.words) add(word.text, source);
    } else if (source === "symbols") {
      for (const symbol of current.symbols) add(symbol.name, source);
      for (const buffer of buffers)
        for (const symbol of buffer.index.symbols) add(symbol.name, source);
    } else if (source === "keywords") {
      for (const keyword of viKeywords(current.filetype)) add(keyword, source);
    } else {
      let indexed = 0;
      for (const document of includes) {
        const filetype = resolveViFiletype("auto", document.path);
        const index = indexViDocument(
          filetype,
          document.path,
          document.contents.slice(0, maximumViIncludeBytes),
        );
        for (const symbol of index.symbols) {
          add(symbol.name, source);
          indexed += 1;
          if (indexed >= maximumViIncludeCandidates) break;
        }
        if (indexed < maximumViIncludeCandidates)
          for (const word of index.words) {
            add(word.text, source);
            indexed += 1;
            if (indexed >= maximumViIncludeCandidates) break;
          }
        if (indexed >= maximumViIncludeCandidates) break;
      }
    }
  }
  return result;
}

export function findViDefinition(
  name: string,
  current: ViDocumentIndex,
  buffers: readonly ViBufferSummary[],
  includes: readonly ViExternalDocument[],
  options: ViOptions,
): ViSymbol | undefined {
  const findSymbol = (index: ViDocumentIndex): ViSymbol | undefined => {
    const insensitive = index.filetype === "basic";
    const needle = insensitive ? name.toLowerCase() : name;
    return index.symbols.find(
      (entry) =>
        (insensitive ? entry.name.toLowerCase() : entry.name) === needle,
    );
  };
  for (const source of ["current", "buffers", "includes"] as const) {
    if (!options.definitionsources.includes(source)) continue;
    if (source === "current") {
      const symbol = findSymbol(current);
      if (symbol !== undefined) return symbol;
    } else if (source === "buffers") {
      for (const buffer of buffers) {
        const symbol = findSymbol(buffer.index);
        if (symbol !== undefined) return symbol;
      }
    } else {
      for (const document of includes) {
        const index = indexViDocument(
          resolveViFiletype("auto", document.path),
          document.path,
          document.contents.slice(0, maximumViIncludeBytes),
        );
        const symbol = findSymbol(index);
        if (symbol !== undefined) return symbol;
      }
    }
  }
  return undefined;
}

function matchesPrefix(
  candidate: string,
  prefix: string,
  mode: ViCompleteCase,
): boolean {
  if (mode === "sensitive") return candidate.startsWith(prefix);
  if (mode === "insensitive")
    return candidate.toLowerCase().startsWith(prefix.toLowerCase());
  return /[A-Z]/u.test(prefix)
    ? candidate.startsWith(prefix)
    : candidate.toLowerCase().startsWith(prefix.toLowerCase());
}
function comparisonKey(
  candidate: string,
  mode: ViCompleteCase,
  prefix: string,
): string {
  return mode === "sensitive" || (mode === "smart" && /[A-Z]/u.test(prefix))
    ? candidate
    : candidate.toLowerCase();
}
function wordPart(character: string): boolean {
  return /^[A-Za-z0-9_.$?]$/u.test(character);
}
