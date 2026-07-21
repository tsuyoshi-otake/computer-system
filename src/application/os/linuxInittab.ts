import { utf8ByteLength } from "../../domain/text/utf8.js";

export const linuxInittabLimits = Object.freeze({
  maximumIdBytes: 4,
  maximumProcessBytes: 512,
  maximumSubstantiveLines: 64,
});

const knownLinuxInittabActions = Object.freeze([
  "sysinit",
  "wait",
  "respawn",
  "initdefault",
  "ctrlaltdel",
] as const);

const validLinuxInittabRunlevelCharacters = "0123456S";

export type LinuxInittabAction = (typeof knownLinuxInittabActions)[number];

export interface LinuxInittabEntry {
  readonly id: string;
  /** Runlevel characters this entry applies to; empty means "all runlevels" (sysinit/ctrlaltdel convention). */
  readonly runlevels: readonly string[];
  readonly action: LinuxInittabAction;
  readonly process: string;
}

export interface ParsedLinuxInittab {
  readonly entries: readonly LinuxInittabEntry[];
  readonly initDefault: string;
  readonly warnings: readonly string[];
}

export type LinuxInittabErrorCode =
  | "too_many_lines"
  | "malformed_line"
  | "empty_id"
  | "id_too_long"
  | "duplicate_id"
  | "invalid_runlevel"
  | "process_too_long"
  | "missing_initdefault"
  | "duplicate_initdefault";

export class LinuxInittabParseError extends Error {
  constructor(
    readonly code: LinuxInittabErrorCode,
    readonly line: number | undefined,
    message: string,
  ) {
    super(message);
    this.name = "LinuxInittabParseError";
  }
}

interface InternalLinuxInittabEntry extends LinuxInittabEntry {
  readonly lineNumber: number;
}

export function parseLinuxInittab(text: string): ParsedLinuxInittab {
  const lines = text.split("\n");
  const seenIds = new Set<string>();
  const entries: InternalLinuxInittabEntry[] = [];
  const warnings: string[] = [];
  let substantiveCount = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const lineNumber = index + 1;
    const trimmed = line.trimStart();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;

    substantiveCount += 1;
    if (substantiveCount > linuxInittabLimits.maximumSubstantiveLines) {
      throw new LinuxInittabParseError(
        "too_many_lines",
        undefined,
        `/etc/inittab has more than ${String(linuxInittabLimits.maximumSubstantiveLines)} entries (entry ${String(substantiveCount)})`,
      );
    }

    const fields = splitLinuxInittabLine(line);
    if (fields === undefined)
      fault(
        "malformed_line",
        lineNumber,
        `line ${String(lineNumber)}: malformed inittab line`,
      );
    const id = fields[0]!;
    const runlevelsField = fields[1]!;
    const actionField = fields[2]!;
    const process = fields[3]!;

    if (id.length === 0)
      fault(
        "empty_id",
        lineNumber,
        `line ${String(lineNumber)}: id field is empty`,
      );
    if (utf8ByteLength(id) > linuxInittabLimits.maximumIdBytes)
      fault(
        "id_too_long",
        lineNumber,
        `line ${String(lineNumber)}: id exceeds ${String(linuxInittabLimits.maximumIdBytes)} bytes`,
      );
    if (seenIds.has(id))
      fault(
        "duplicate_id",
        lineNumber,
        `line ${String(lineNumber)}: duplicate id "${id}"`,
      );
    seenIds.add(id);

    const runlevels =
      runlevelsField.length === 0 ? [] : runlevelsField.split("");
    for (const character of runlevels) {
      if (!validLinuxInittabRunlevelCharacters.includes(character))
        fault(
          "invalid_runlevel",
          lineNumber,
          `line ${String(lineNumber)}: invalid runlevel character "${character}"`,
        );
    }

    if (utf8ByteLength(process) > linuxInittabLimits.maximumProcessBytes)
      fault(
        "process_too_long",
        lineNumber,
        `line ${String(lineNumber)}: process exceeds ${String(linuxInittabLimits.maximumProcessBytes)} bytes`,
      );

    if (!isKnownLinuxInittabAction(actionField)) {
      warnings.push(
        `line ${lineNumber}: unknown inittab action "${actionField}", entry ignored`,
      );
      continue;
    }

    entries.push({
      action: actionField,
      id,
      lineNumber,
      process,
      runlevels,
    });
  }

  const initDefaultEntries = entries.filter(
    (entry) => entry.action === "initdefault",
  );
  if (initDefaultEntries.length === 0)
    throw new LinuxInittabParseError(
      "missing_initdefault",
      undefined,
      "no initdefault entry",
    );
  if (initDefaultEntries.length > 1) {
    const second = initDefaultEntries[1]!;
    fault(
      "duplicate_initdefault",
      second.lineNumber,
      `line ${String(second.lineNumber)}: duplicate initdefault entry`,
    );
  }
  const initDefaultEntry = initDefaultEntries[0]!;
  if (initDefaultEntry.runlevels.length !== 1)
    fault(
      "invalid_runlevel",
      initDefaultEntry.lineNumber,
      `line ${String(initDefaultEntry.lineNumber)}: initdefault entry must name exactly one runlevel`,
    );

  return {
    entries: entries.map(publicLinuxInittabEntry),
    initDefault: initDefaultEntry.runlevels[0]!,
    warnings,
  };
}

export function entriesForRunlevel(
  entries: readonly LinuxInittabEntry[],
  runlevel: string,
  action?: LinuxInittabAction,
): readonly LinuxInittabEntry[] {
  return entries.filter(
    (entry) =>
      (entry.runlevels.length === 0 || entry.runlevels.includes(runlevel)) &&
      (action === undefined || entry.action === action),
  );
}

/** Splits into exactly 4 fields on the first 3 colons; the 4th field keeps any remaining colons. */
function splitLinuxInittabLine(line: string): string[] | undefined {
  const fields: string[] = [];
  let start = 0;
  for (let field = 0; field < 3; field += 1) {
    const separator = line.indexOf(":", start);
    if (separator === -1) return undefined;
    fields.push(line.slice(start, separator));
    start = separator + 1;
  }
  fields.push(line.slice(start));
  return fields;
}

function isKnownLinuxInittabAction(value: string): value is LinuxInittabAction {
  return (knownLinuxInittabActions as readonly string[]).includes(value);
}

function publicLinuxInittabEntry(
  entry: InternalLinuxInittabEntry,
): LinuxInittabEntry {
  return {
    action: entry.action,
    id: entry.id,
    process: entry.process,
    runlevels: entry.runlevels,
  };
}

function fault(
  code: LinuxInittabErrorCode,
  line: number,
  message: string,
): never {
  throw new LinuxInittabParseError(code, line, message);
}
