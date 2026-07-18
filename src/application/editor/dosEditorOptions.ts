import type {
  ViCompleteCase,
  ViCompletionSource,
  ViDefinitionSource,
  ViOptions,
} from "./viOptions.js";
import type { ViFiletypeOption } from "./viLanguage.js";

export type DosEditorProfile = "csasm" | "edit" | "pwb" | "qbasic";
export type DosEditorOptions = ViOptions;

export interface DosEditorConfiguration {
  readonly common: Partial<DosEditorOptions>;
  readonly profiles: Readonly<
    Record<DosEditorProfile, Partial<DosEditorOptions>>
  >;
}

export const maximumDosEditorConfigurationCharacters = 4_096;
export const maximumDosEditorConfigurationLines = 64;

const completionSources: readonly ViCompletionSource[] = [
  "current",
  "buffers",
  "symbols",
  "keywords",
  "includes",
];
const definitionSources: readonly ViDefinitionSource[] = [
  "current",
  "buffers",
  "includes",
];
const filetypes: readonly ViFiletypeOption[] = [
  "auto",
  "text",
  "basic",
  "c",
  "cpp",
  "asm",
  "python",
  "json",
  "shell",
];
const completeCases: readonly ViCompleteCase[] = [
  "smart",
  "sensitive",
  "insensitive",
];

export const defaultDosEditorOptions: DosEditorOptions = Object.freeze({
  autoindent: false,
  complete: true,
  completecase: "smart",
  completeprefix: 2,
  completesources: Object.freeze<ViCompletionSource[]>([
    "current",
    "buffers",
    "symbols",
    "keywords",
  ]),
  definitionsources: Object.freeze<ViDefinitionSource[]>([
    "current",
    "buffers",
  ]),
  expandtab: true,
  filetype: "auto",
  list: false,
  number: false,
  rainbow: false,
  shiftwidth: 4,
  syntax: true,
  tabstop: 4,
  wrap: false,
});

export function emptyDosEditorConfiguration(): DosEditorConfiguration {
  return Object.freeze({
    common: Object.freeze({}),
    profiles: Object.freeze({
      csasm: Object.freeze({}),
      edit: Object.freeze({}),
      pwb: Object.freeze({}),
      qbasic: Object.freeze({}),
    }),
  });
}

export function defaultDosEditorProfileOptions(
  profile: DosEditorProfile,
): DosEditorOptions {
  if (profile === "qbasic") {
    return Object.freeze({
      ...defaultDosEditorOptions,
      autoindent: true,
      filetype: "basic",
    });
  }
  if (profile === "csasm") {
    return Object.freeze({
      ...defaultDosEditorOptions,
      autoindent: true,
      filetype: "asm",
    });
  }
  if (profile === "pwb") {
    return Object.freeze({ ...defaultDosEditorOptions, autoindent: true });
  }
  return Object.freeze({ ...defaultDosEditorOptions, tabstop: 8 });
}

export function parseDosEditorConfiguration(
  source: string,
): DosEditorConfiguration {
  if ([...source].length > maximumDosEditorConfigurationCharacters) {
    throw new Error(
      `EDITOR.INI exceeds ${String(maximumDosEditorConfigurationCharacters)} characters`,
    );
  }
  const lines = source
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines.length > maximumDosEditorConfigurationLines) {
    throw new Error(
      `EDITOR.INI exceeds ${String(maximumDosEditorConfigurationLines)} lines`,
    );
  }
  let section: "common" | DosEditorProfile = "common";
  const common: Partial<DosEditorOptions> = {};
  const profiles: Record<DosEditorProfile, Partial<DosEditorOptions>> = {
    csasm: {},
    edit: {},
    pwb: {},
    qbasic: {},
  };
  for (const [index, authored] of lines.entries()) {
    const line = authored.trim();
    if (line.length === 0 || line.startsWith(";") || line.startsWith("#")) {
      continue;
    }
    const sectionMatch = /^\[([A-Za-z]+)\]$/u.exec(line);
    if (sectionMatch !== null) {
      const name = sectionMatch[1]!.toLowerCase();
      if (
        name !== "common" &&
        name !== "edit" &&
        name !== "qbasic" &&
        name !== "pwb" &&
        name !== "csasm"
      ) {
        throw configurationError(index, `unknown section: ${name}`);
      }
      section = name;
      continue;
    }
    const assignment = /^([A-Za-z]+)\s*=\s*(.*?)$/u.exec(line);
    if (assignment === null) {
      throw configurationError(index, "expected key=value or [section]");
    }
    const target = section === "common" ? common : profiles[section];
    applyAssignment(
      target,
      assignment[1]!.toLowerCase(),
      assignment[2]!,
      index,
    );
  }
  return Object.freeze({
    common: Object.freeze(common),
    profiles: Object.freeze({
      csasm: Object.freeze(profiles.csasm),
      edit: Object.freeze(profiles.edit),
      pwb: Object.freeze(profiles.pwb),
      qbasic: Object.freeze(profiles.qbasic),
    }),
  });
}

export function resolveDosEditorOptions(
  configuration: DosEditorConfiguration,
  profile: DosEditorProfile,
): DosEditorOptions {
  return freezeOptions({
    ...defaultDosEditorProfileOptions(profile),
    ...configuration.common,
    ...configuration.profiles[profile],
  });
}

export function updateDosEditorProfile(
  configuration: DosEditorConfiguration,
  profile: DosEditorProfile,
  options: DosEditorOptions,
): DosEditorConfiguration {
  const inherited = {
    ...defaultDosEditorProfileOptions(profile),
    ...configuration.common,
  };
  const overrides: Partial<DosEditorOptions> = {};
  for (const key of Object.keys(options) as (keyof DosEditorOptions)[]) {
    const current = options[key];
    const baseline = inherited[key];
    const equal =
      Array.isArray(current) && Array.isArray(baseline)
        ? current.length === baseline.length &&
          current.every((entry, index) => entry === baseline[index])
        : current === baseline;
    if (!equal) Object.assign(overrides, { [key]: current });
  }
  return Object.freeze({
    common: configuration.common,
    profiles: Object.freeze({
      ...configuration.profiles,
      [profile]: Object.freeze(overrides),
    }),
  });
}

export function serializeDosEditorConfiguration(
  configuration: DosEditorConfiguration,
): string {
  const lines: string[] = [];
  appendSection(lines, "common", configuration.common);
  for (const profile of ["edit", "qbasic", "pwb", "csasm"] as const) {
    appendSection(lines, profile, configuration.profiles[profile]);
  }
  if (lines.length > maximumDosEditorConfigurationLines) {
    throw new Error("EDITOR.INI serialization exceeds its line limit");
  }
  const result = lines.length === 0 ? "" : `${lines.join("\r\n")}\r\n`;
  if ([...result].length > maximumDosEditorConfigurationCharacters) {
    throw new Error("EDITOR.INI serialization exceeds its character limit");
  }
  return result;
}

function applyAssignment(
  target: Partial<DosEditorOptions>,
  key: string,
  value: string,
  line: number,
): void {
  if (
    key === "syntax" ||
    key === "number" ||
    key === "rainbow" ||
    key === "autoindent" ||
    key === "list" ||
    key === "wrap" ||
    key === "expandtab" ||
    key === "complete"
  ) {
    Object.assign(target, { [key]: parseBoolean(value, line) });
    return;
  }
  if (key === "tabstop" || key === "shiftwidth" || key === "completeprefix") {
    const parsed = Number(value);
    const maximum = key === "completeprefix" ? 8 : 16;
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
      throw configurationError(line, `${key} must be 1-${String(maximum)}`);
    }
    Object.assign(target, { [key]: parsed });
    return;
  }
  if (key === "filetype") {
    const parsed = value.toLowerCase() as ViFiletypeOption;
    if (!filetypes.includes(parsed)) {
      throw configurationError(line, `invalid filetype: ${value}`);
    }
    Object.assign(target, { filetype: parsed });
    return;
  }
  if (key === "completecase") {
    const parsed = value.toLowerCase() as ViCompleteCase;
    if (!completeCases.includes(parsed)) {
      throw configurationError(line, `invalid completecase: ${value}`);
    }
    Object.assign(target, { completecase: parsed });
    return;
  }
  if (key === "completesources") {
    Object.assign(target, {
      completesources: parseSources(value, completionSources, line, key),
    });
    return;
  }
  if (key === "definitionsources") {
    Object.assign(target, {
      definitionsources: parseSources(value, definitionSources, line, key),
    });
    return;
  }
  throw configurationError(line, `unknown option: ${key}`);
}

function parseBoolean(value: string, line: number): boolean {
  const normalized = value.toLowerCase();
  if (normalized === "on" || normalized === "true" || normalized === "yes") {
    return true;
  }
  if (normalized === "off" || normalized === "false" || normalized === "no") {
    return false;
  }
  throw configurationError(line, `expected on or off, received: ${value}`);
}

function parseSources<T extends string>(
  value: string,
  allowed: readonly T[],
  line: number,
  key: string,
): readonly T[] {
  const result = value
    .split(",")
    .map((entry) => entry.trim().toLowerCase() as T)
    .filter(Boolean);
  if (result.length === 0 || result.some((entry) => !allowed.includes(entry))) {
    throw configurationError(line, `invalid ${key}`);
  }
  return Object.freeze([...new Set(result)]);
}

function appendSection(
  lines: string[],
  name: string,
  options: Partial<DosEditorOptions>,
): void {
  const entries = optionEntries(options);
  if (entries.length === 0) return;
  if (lines.length > 0) lines.push("");
  lines.push(`[${name}]`, ...entries);
}

function optionEntries(options: Partial<DosEditorOptions>): readonly string[] {
  const lines: string[] = [];
  for (const key of [
    "syntax",
    "number",
    "rainbow",
    "autoindent",
    "list",
    "wrap",
    "expandtab",
    "tabstop",
    "shiftwidth",
    "complete",
    "completecase",
    "completeprefix",
    "completesources",
    "definitionsources",
    "filetype",
  ] as const) {
    const value = options[key];
    if (value === undefined) continue;
    lines.push(
      `${key}=${Array.isArray(value) ? value.join(",") : typeof value === "boolean" ? (value ? "on" : "off") : String(value)}`,
    );
  }
  return lines;
}

function freezeOptions(options: DosEditorOptions): DosEditorOptions {
  return Object.freeze({
    ...options,
    completesources: Object.freeze([...options.completesources]),
    definitionsources: Object.freeze([...options.definitionsources]),
  });
}

function configurationError(line: number, detail: string): Error {
  return new Error(`EDITOR.INI line ${String(line + 1)}: ${detail}`);
}
