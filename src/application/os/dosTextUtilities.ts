import { utf8ByteLength } from "../../domain/text/utf8.js";
import type { ShellCommandResult } from "./shellTypes.js";

/**
 * Bounded CS-DOS 6.x-style text and comparison utilities. These utilities
 * receive only guest-file callbacks; they never access a host command or file.
 */
export const dosTextUtilityLimits = Object.freeze({
  maximumComparisonBytes: 256_000,
  maximumFindInputBytes: 256_000,
  maximumLines: 4_096,
  maximumOutputCharacters: 256_000,
  maximumSortInputBytes: 65_536,
});

export type DosChoicePrompt = Readonly<{
  readonly caseSensitive: boolean;
  readonly choices: readonly string[];
  readonly display: string;
  readonly kind: "choice";
}>;

export type DosPausePrompt = Readonly<{
  readonly display: string;
  readonly kind: "pause";
}>;

export type DosPrompt = DosChoicePrompt | DosPausePrompt;

export function parseDosChoice(
  arguments_: readonly string[],
): DosChoicePrompt | ShellCommandResult {
  let choices = "YN";
  let caseSensitive = false;
  let showChoices = true;
  const message: string[] = [];
  let options = true;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    if (options && argument === "--") {
      options = false;
      continue;
    }
    if (options && /^\/C(?::|[A-Za-z0-9]|$)/iu.test(argument)) {
      let value = argument.slice(2);
      if (value.startsWith(":")) value = value.slice(1);
      if (value.length === 0) value = arguments_[++index] ?? "";
      choices = value;
      continue;
    }
    if (options && /^\/N$/iu.test(argument)) {
      showChoices = false;
      continue;
    }
    if (options && /^\/S$/iu.test(argument)) {
      caseSensitive = true;
      continue;
    }
    if (options && argument.startsWith("/")) {
      return dosFailure("CHOICE", "Invalid switch - " + argument);
    }
    message.push(argument);
  }
  if (
    choices.length === 0 ||
    choices.length > 16 ||
    !/^[A-Za-z0-9]+$/u.test(choices) ||
    new Set([...choices].map((choice) => choice.toUpperCase())).size !==
      choices.length
  ) {
    return dosFailure(
      "CHOICE",
      "choices must be 1 through 16 distinct letters or digits",
    );
  }
  const renderedChoices = [...choices]
    .map((choice) => (caseSensitive ? choice : choice.toUpperCase()))
    .join(",");
  const text = message.join(" ");
  return Object.freeze({
    caseSensitive,
    choices: Object.freeze([...choices]),
    display:
      (text.length === 0 ? "" : text + " ") +
      (showChoices ? "[" + renderedChoices + "]" : "") +
      "?",
    kind: "choice",
  });
}

export function parseDosPause(
  arguments_: readonly string[],
): DosPausePrompt | ShellCommandResult {
  if (arguments_.length !== 0)
    return dosFailure("PAUSE", "Invalid number of parameters.");
  return Object.freeze({
    display: "Press any key to continue . . .",
    kind: "pause",
  });
}

export function executeDosFind(
  arguments_: readonly string[],
  stdin: string,
  readFile: (path: string) => string,
): ShellCommandResult {
  let countOnly = false;
  let ignoreCase = false;
  let invert = false;
  let lineNumbers = false;
  const operands: string[] = [];
  let options = true;
  for (const argument of arguments_) {
    if (options && argument === "--") {
      options = false;
      continue;
    }
    if (options && argument.startsWith("/")) {
      for (const option of argument.slice(1).toUpperCase()) {
        if (option === "C") countOnly = true;
        else if (option === "I") ignoreCase = true;
        else if (option === "N") lineNumbers = true;
        else if (option === "V") invert = true;
        else return dosFailure("FIND", "Invalid switch - /" + option);
      }
      continue;
    }
    operands.push(argument);
  }
  if (operands.length === 0)
    return dosFailure("FIND", "Search string missing.");
  const needle = operands[0]!;
  const paths = operands.slice(1);
  if (paths.length > 16) return dosFailure("FIND", "Too many file names.");
  if (paths.some(hasWildcard))
    return dosFailure("FIND", "Wildcards are unavailable.");
  const comparisonNeedle = normalizeFindValue(needle, ignoreCase);
  const sources: { name: string; text: string }[] =
    paths.length === 0 ? [{ name: "", text: stdin }] : [];
  for (const path of paths) {
    let text: string;
    try {
      text = readFile(path);
    } catch {
      return dosFailure("FIND", "File not found - " + path.toUpperCase());
    }
    sources.push({ name: path, text });
  }
  if (
    sources.reduce((bytes, source) => bytes + utf8ByteLength(source.text), 0) >
    dosTextUtilityLimits.maximumFindInputBytes
  ) {
    return dosFailure("FIND", "Input limit exceeded.");
  }
  let found = 0;
  let output = "";
  for (const source of sources) {
    const lines = splitDosLines(source.text);
    if (lines.length > dosTextUtilityLimits.maximumLines)
      return dosFailure("FIND", "Input line limit exceeded.");
    const selected = lines.map((line) => {
      const matched = normalizeFindValue(line, ignoreCase).includes(
        comparisonNeedle,
      );
      return invert ? !matched : matched;
    });
    const count = selected.filter(Boolean).length;
    found += count;
    if (countOnly) {
      if (source.name.length > 0 && sources.length > 1)
        output += "---------- " + source.name.toUpperCase() + "\r\n";
      output += String(count) + "\r\n";
      continue;
    }
    if (source.name.length > 0 && sources.length > 1)
      output += "---------- " + source.name.toUpperCase() + "\r\n";
    for (const [index, line] of lines.entries()) {
      if (!selected[index]) continue;
      output += (lineNumbers ? String(index + 1) + ":" : "") + line + "\r\n";
    }
    if (output.length > dosTextUtilityLimits.maximumOutputCharacters)
      return dosFailure("FIND", "Output limit exceeded.");
  }
  return { exitCode: found === 0 ? 1 : 0, stderr: "", stdout: output };
}

export function executeDosSort(
  arguments_: readonly string[],
  stdin: string,
  readFile: (path: string) => string,
): ShellCommandResult {
  let reverse = false;
  let start = 0;
  let path: string | undefined;
  for (const argument of arguments_) {
    if (/^\/R$/iu.test(argument)) {
      reverse = true;
      continue;
    }
    const offset = /^\/\+([1-9][0-9]{0,3})$/u.exec(argument);
    if (offset !== null) {
      start = Number(offset[1]) - 1;
      continue;
    }
    if (argument.startsWith("/"))
      return dosFailure("SORT", "Invalid switch - " + argument);
    if (path !== undefined)
      return dosFailure("SORT", "Only one input file is supported.");
    if (hasWildcard(argument))
      return dosFailure("SORT", "Wildcards are unavailable.");
    path = argument;
  }
  let input = stdin;
  if (path !== undefined) {
    try {
      input = readFile(path);
    } catch {
      return dosFailure("SORT", "File not found - " + path.toUpperCase());
    }
  }
  if (utf8ByteLength(input) > dosTextUtilityLimits.maximumSortInputBytes) {
    return dosFailure(
      "SORT",
      "Input exceeds " +
        String(dosTextUtilityLimits.maximumSortInputBytes / 1024) +
        " KiB.",
    );
  }
  const lines = splitDosLines(input);
  if (lines.length > dosTextUtilityLimits.maximumLines)
    return dosFailure("SORT", "Input line limit exceeded.");
  const ordered = lines
    .map((line, index) => ({
      index,
      key: asciiUppercase(line.slice(start)),
      line,
    }))
    .sort((left, right) => {
      const comparison = compareAscii(left.key, right.key);
      if (comparison === 0) return left.index - right.index;
      return reverse ? -comparison : comparison;
    })
    .map(({ line }) => line);
  const stdout = ordered.length === 0 ? "" : ordered.join("\r\n") + "\r\n";
  return outputWithinLimit("SORT", stdout, 0);
}

export function executeDosFc(
  arguments_: readonly string[],
  readFile: (path: string) => string,
  readFileBytes: (path: string) => Uint8Array,
): ShellCommandResult {
  let binary = false;
  let forceText = false;
  let ignoreCase = false;
  let lineNumbers = false;
  let collapseWhitespace = false;
  let expandTabs = false;
  let abbreviated = false;
  const paths: string[] = [];
  for (const argument of arguments_) {
    if (/^\/A$/iu.test(argument)) abbreviated = true;
    else if (/^\/B$/iu.test(argument)) {
      binary = true;
      forceText = false;
    } else if (/^\/C$/iu.test(argument)) ignoreCase = true;
    else if (/^\/L$/iu.test(argument)) {
      binary = false;
      forceText = true;
    } else if (/^\/N$/iu.test(argument)) lineNumbers = true;
    else if (/^\/T$/iu.test(argument)) expandTabs = true;
    else if (/^\/W$/iu.test(argument)) collapseWhitespace = true;
    else if (argument.startsWith("/"))
      return dosFailure("FC", "Invalid switch - " + argument);
    else paths.push(argument);
  }
  if (paths.length !== 2)
    return dosFailure("FC", "Two file names are required.");
  if (paths.some(hasWildcard))
    return dosFailure("FC", "Wildcards are unavailable.");
  const leftPath = paths[0]!;
  const rightPath = paths[1]!;
  const inferredBinary =
    binary ||
    (!forceText &&
      [leftPath, rightPath].some((path) =>
        /\.(?:BIN|COM|EXE|LIB|OBJ|SYS)$/iu.test(path),
      ));
  if (inferredBinary) {
    let left: Uint8Array;
    let right: Uint8Array;
    try {
      left = readFileBytes(leftPath);
      right = readFileBytes(rightPath);
    } catch {
      return dosFailure("FC", "File not found.");
    }
    if (
      left.byteLength > dosTextUtilityLimits.maximumComparisonBytes ||
      right.byteLength > dosTextUtilityLimits.maximumComparisonBytes
    ) {
      return dosFailure("FC", "Comparison input limit exceeded.");
    }
    return compareDosBytes(leftPath, rightPath, left, right);
  }
  let leftText: string;
  let rightText: string;
  try {
    leftText = readFile(leftPath);
    rightText = readFile(rightPath);
  } catch {
    return dosFailure("FC", "File not found.");
  }
  if (
    utf8ByteLength(leftText) > dosTextUtilityLimits.maximumComparisonBytes ||
    utf8ByteLength(rightText) > dosTextUtilityLimits.maximumComparisonBytes
  ) {
    return dosFailure("FC", "Comparison input limit exceeded.");
  }
  const leftLines = splitDosLines(leftText);
  const rightLines = splitDosLines(rightText);
  if (
    leftLines.length > dosTextUtilityLimits.maximumLines ||
    rightLines.length > dosTextUtilityLimits.maximumLines
  ) {
    return dosFailure("FC", "Input line limit exceeded.");
  }
  const normalize = (line: string): string => {
    let value = expandTabs ? line.replaceAll("\t", "        ") : line;
    if (collapseWhitespace) value = value.replace(/\s+/gu, " ").trim();
    return ignoreCase ? asciiUppercase(value) : value;
  };
  const difference = firstLineDifference(leftLines, rightLines, normalize);
  if (difference === undefined) {
    return {
      exitCode: 0,
      stderr: "",
      stdout: "FC: no differences encountered\r\n",
    };
  }
  const prefix = lineNumbers ? String(difference + 1) + ": " : "";
  const leftLine = leftLines[difference] ?? "<EOF>";
  const rightLine = rightLines[difference] ?? "<EOF>";
  const stdout = [
    "Comparing files " +
      leftPath.toUpperCase() +
      " and " +
      rightPath.toUpperCase(),
    "***** " + leftPath.toUpperCase(),
    prefix + leftLine,
    "***** " + rightPath.toUpperCase(),
    prefix + rightLine,
    abbreviated ? "Resync omitted by /A." : "Files are different.",
    "",
  ].join("\r\n");
  return outputWithinLimit("FC", stdout, 1);
}

export function executeDosComp(
  arguments_: readonly string[],
  readFileBytes: (path: string) => Uint8Array,
): ShellCommandResult {
  let decimal = false;
  let ascii = false;
  let maximumDifferences = 10;
  let start = 0;
  const paths: string[] = [];
  for (const argument of arguments_) {
    if (/^\/D$/iu.test(argument)) decimal = true;
    else if (/^\/A$/iu.test(argument)) ascii = true;
    else if (/^\/L$/iu.test(argument)) maximumDifferences = 1;
    else {
      const offset = /^\/N(?:=|:)([0-9]{1,6})$/iu.exec(argument);
      if (offset !== null) start = Number(offset[1]);
      else if (argument.startsWith("/"))
        return dosFailure("COMP", "Invalid switch - " + argument);
      else paths.push(argument);
    }
  }
  if (paths.length !== 2)
    return dosFailure("COMP", "Two file names are required.");
  if (paths.some(hasWildcard))
    return dosFailure("COMP", "Wildcards are unavailable.");
  let left: Uint8Array;
  let right: Uint8Array;
  try {
    left = readFileBytes(paths[0]!);
    right = readFileBytes(paths[1]!);
  } catch {
    return dosFailure("COMP", "File not found.");
  }
  if (
    left.byteLength > dosTextUtilityLimits.maximumComparisonBytes ||
    right.byteLength > dosTextUtilityLimits.maximumComparisonBytes ||
    start > Math.max(left.byteLength, right.byteLength)
  ) {
    return dosFailure("COMP", "Comparison input limit exceeded.");
  }
  const differences: string[] = [];
  const length = Math.max(left.byteLength, right.byteLength);
  for (let index = start; index < length; index += 1) {
    const leftByte = left[index];
    const rightByte = right[index];
    if (leftByte === rightByte) continue;
    const address = decimal
      ? String(index)
      : index.toString(16).toUpperCase().padStart(8, "0");
    differences.push(
      address +
        ": " +
        formatCompByte(leftByte, ascii) +
        " " +
        formatCompByte(rightByte, ascii),
    );
    if (differences.length >= maximumDifferences) break;
  }
  if (differences.length === 0)
    return { exitCode: 0, stderr: "", stdout: "Files compare OK\r\n" };
  return outputWithinLimit("COMP", differences.join("\r\n") + "\r\n", 1);
}

function compareDosBytes(
  leftPath: string,
  rightPath: string,
  left: Uint8Array,
  right: Uint8Array,
): ShellCommandResult {
  const differences: string[] = [];
  const maximum = Math.max(left.byteLength, right.byteLength);
  for (let index = 0; index < maximum; index += 1) {
    const first = left[index];
    const second = right[index];
    if (first === second) continue;
    differences.push(
      index.toString(16).toUpperCase().padStart(8, "0") +
        ": " +
        formatHexByte(first) +
        " " +
        formatHexByte(second),
    );
    if (differences.length >= 32) break;
  }
  if (differences.length === 0) {
    return {
      exitCode: 0,
      stderr: "",
      stdout: "FC: no differences encountered\r\n",
    };
  }
  const stdout = [
    "Comparing files " +
      leftPath.toUpperCase() +
      " and " +
      rightPath.toUpperCase(),
    ...differences,
    "",
  ].join("\r\n");
  return outputWithinLimit("FC", stdout, 1);
}

function firstLineDifference(
  left: readonly string[],
  right: readonly string[],
  normalize: (line: string) => string,
): number | undefined {
  const maximum = Math.max(left.length, right.length);
  for (let index = 0; index < maximum; index += 1) {
    if (normalize(left[index] ?? "") !== normalize(right[index] ?? ""))
      return index;
  }
  return undefined;
}

function splitDosLines(value: string): string[] {
  if (value.length === 0) return [];
  const lines = value
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function normalizeFindValue(value: string, ignoreCase: boolean): string {
  return ignoreCase ? asciiUppercase(value) : value;
}

function asciiUppercase(value: string): string {
  return value.replace(/[a-z]/gu, (letter) =>
    String.fromCharCode(letter.charCodeAt(0) - 32),
  );
}

function compareAscii(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

function formatHexByte(value: number | undefined): string {
  return value === undefined
    ? "--"
    : value.toString(16).toUpperCase().padStart(2, "0");
}

function formatCompByte(value: number | undefined, ascii: boolean): string {
  if (!ascii) return formatHexByte(value);
  if (value === undefined) return "--";
  return value >= 32 && value <= 126 ? String.fromCharCode(value) : ".";
}

function hasWildcard(value: string): boolean {
  return value.includes("*") || value.includes("?");
}

function outputWithinLimit(
  command: string,
  stdout: string,
  exitCode: number,
): ShellCommandResult {
  return stdout.length > dosTextUtilityLimits.maximumOutputCharacters
    ? dosFailure(command, "Output limit exceeded.")
    : { exitCode, stderr: "", stdout };
}

function dosFailure(
  command: string,
  detail: string,
  exitCode = 2,
): ShellCommandResult {
  return { exitCode, stderr: command + ": " + detail + "\r\n", stdout: "" };
}
