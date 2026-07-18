import type { ViFiletypeOption } from "./viLanguage.js";

export type ViCompleteCase = "insensitive" | "sensitive" | "smart";
export type ViCompletionSource =
  "buffers" | "current" | "includes" | "keywords" | "symbols";
export type ViDefinitionSource = "buffers" | "current" | "includes";

export interface ViOptions {
  readonly autoindent: boolean;
  readonly complete: boolean;
  readonly completecase: ViCompleteCase;
  readonly completeprefix: number;
  readonly completesources: readonly ViCompletionSource[];
  readonly definitionsources: readonly ViDefinitionSource[];
  readonly expandtab: boolean;
  readonly filetype: ViFiletypeOption;
  readonly list: boolean;
  readonly number: boolean;
  readonly rainbow: boolean;
  readonly shiftwidth: number;
  readonly syntax: boolean;
  readonly tabstop: number;
  readonly wrap: boolean;
}

export interface ViSetResult {
  readonly messages: readonly string[];
  readonly options: ViOptions;
}

export const maximumViConfigurationCharacters = 4_096;
export const maximumViConfigurationLines = 32;
export const maximumViOptionValue = 16;
export const maximumViCompletePrefix = 8;

export const defaultViOptions: ViOptions = Object.freeze({
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
  shiftwidth: 2,
  syntax: false,
  tabstop: 2,
  wrap: false,
});

type ViBooleanOption =
  | "autoindent"
  | "complete"
  | "expandtab"
  | "list"
  | "number"
  | "rainbow"
  | "wrap";

const booleanAliases = new Map<string, ViBooleanOption>([
  ["ai", "autoindent"],
  ["autoindent", "autoindent"],
  ["complete", "complete"],
  ["et", "expandtab"],
  ["expandtab", "expandtab"],
  ["list", "list"],
  ["nu", "number"],
  ["number", "number"],
  ["rainbow", "rainbow"],
  ["wrap", "wrap"],
]);

const numericAliases = new Map<
  string,
  "completeprefix" | "shiftwidth" | "tabstop"
>([
  ["completeprefix", "completeprefix"],
  ["shiftwidth", "shiftwidth"],
  ["sw", "shiftwidth"],
  ["tabstop", "tabstop"],
  ["ts", "tabstop"],
]);

export function applyViSet(
  current: ViOptions,
  tokens: readonly string[],
): ViSetResult {
  let options = { ...current };
  const messages: string[] = [];
  for (const token of tokens) {
    if (token === "all") {
      messages.push(...formatViOptions(options));
      continue;
    }
    if (token.endsWith("?")) {
      messages.push(formatViOption(options, token.slice(0, -1)));
      continue;
    }
    const assignment = /^([^=]+)=(.+)$/u.exec(token);
    if (assignment !== null) {
      const authoredName = assignment[1]!;
      const name = numericAliases.get(authoredName);
      if (name === undefined) {
        options = applyStringAssignment(options, authoredName, assignment[2]!);
        continue;
      }
      const value = Number(assignment[2]);
      const maximum =
        name === "completeprefix"
          ? maximumViCompletePrefix
          : maximumViOptionValue;
      if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
        throw new Error(
          `${name} must be an integer from 1 to ${String(maximum)}`,
        );
      }
      options = { ...options, [name]: value };
      continue;
    }
    const inverted = token.endsWith("!");
    const authored = inverted ? token.slice(0, -1) : token;
    const disabled = authored.startsWith("no");
    const name = booleanAliases.get(disabled ? authored.slice(2) : authored);
    if (name === undefined) throw new Error(`Unknown option: ${authored}`);
    const value = inverted ? !options[name] : !disabled;
    options = { ...options, [name]: value };
  }
  return { messages, options: Object.freeze(options) };
}

export function formatViOptions(options: ViOptions): readonly string[] {
  return [
    enabled("autoindent", options.autoindent),
    enabled("complete", options.complete),
    `completecase=${options.completecase}`,
    `completeprefix=${String(options.completeprefix)}`,
    `completesources=${options.completesources.join(",")}`,
    `definitionsources=${options.definitionsources.join(",")}`,
    enabled("expandtab", options.expandtab),
    `filetype=${options.filetype}`,
    enabled("list", options.list),
    enabled("number", options.number),
    enabled("rainbow", options.rainbow),
    enabled("syntax", options.syntax),
    enabled("wrap", options.wrap),
    `shiftwidth=${String(options.shiftwidth)}`,
    `tabstop=${String(options.tabstop)}`,
  ];
}

export function parseViConfiguration(configuration: string): ViOptions {
  if ([...configuration].length > maximumViConfigurationCharacters) {
    throw new Error(
      `.vimrc exceeds ${String(maximumViConfigurationCharacters)} characters`,
    );
  }
  const normalized = configuration.replaceAll("\r\n", "\n");
  const lines = normalized.split("\n");
  if (normalized.endsWith("\n")) lines.pop();
  if (lines.length > maximumViConfigurationLines) {
    throw new Error(
      `.vimrc exceeds ${String(maximumViConfigurationLines)} lines`,
    );
  }
  let options = defaultViOptions;
  for (const [index, source] of lines.entries()) {
    const trimmed = source.trim();
    if (trimmed.length === 0 || trimmed.startsWith('"')) continue;
    const command = (
      trimmed.startsWith(":") ? trimmed.slice(1) : trimmed
    ).trim();
    try {
      const syntax = /^syntax\s+(on|off)$/u.exec(command);
      if (syntax !== null) {
        options = Object.freeze({ ...options, syntax: syntax[1] === "on" });
        continue;
      }
      const set = /^set(?:\s+(.*))?$/u.exec(command);
      if (set !== null) {
        const tokens = set[1]?.trim().split(/\s+/u).filter(Boolean) ?? [];
        options = applyViSet(options, tokens).options;
        continue;
      }
      throw new Error(`Not an editor command: ${command}`);
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`.vimrc line ${String(index + 1)}: ${detail}`);
    }
  }
  return options;
}

function formatViOption(options: ViOptions, authored: string): string {
  if (authored === "syntax") return enabled("syntax", options.syntax);
  const booleanName = booleanAliases.get(authored);
  if (booleanName !== undefined) {
    return enabled(booleanName, options[booleanName]);
  }
  const numericName = numericAliases.get(authored);
  if (numericName !== undefined) {
    return `${numericName}=${String(options[numericName])}`;
  }
  const canonical = authored === "ft" ? "filetype" : authored;
  if (canonical === "completecase")
    return `completecase=${options.completecase}`;
  if (canonical === "completesources")
    return `completesources=${options.completesources.join(",")}`;
  if (canonical === "definitionsources")
    return `definitionsources=${options.definitionsources.join(",")}`;
  if (canonical === "filetype") return `filetype=${options.filetype}`;
  throw new Error(`Unknown option: ${authored}`);
}

function applyStringAssignment(
  options: ViOptions,
  authored: string,
  value: string,
): ViOptions {
  const name = authored === "ft" ? "filetype" : authored;
  if (name === "completecase") {
    if (value !== "smart" && value !== "sensitive" && value !== "insensitive") {
      throw new Error("completecase must be smart, sensitive, or insensitive");
    }
    return { ...options, completecase: value };
  }
  if (name === "filetype") {
    if (
      ![
        "auto",
        "asm",
        "basic",
        "c",
        "cpp",
        "json",
        "python",
        "shell",
        "text",
      ].includes(value)
    ) {
      throw new Error(
        "filetype must be auto, python, basic, c, cpp, asm, shell, json, or text",
      );
    }
    return { ...options, filetype: value as ViFiletypeOption };
  }
  if (name === "completesources") {
    return {
      ...options,
      completesources: parseSources(
        value,
        ["current", "buffers", "symbols", "keywords", "includes"],
        name,
      ) as readonly ViCompletionSource[],
    };
  }
  if (name === "definitionsources") {
    return {
      ...options,
      definitionsources: parseSources(
        value,
        ["current", "buffers", "includes"],
        name,
      ) as readonly ViDefinitionSource[],
    };
  }
  throw new Error(`Unknown option: ${authored}`);
}

function parseSources(
  value: string,
  allowed: readonly string[],
  name: string,
): readonly string[] {
  const sources = value.split(",");
  if (
    sources.length === 0 ||
    sources.some((source) => source.length === 0 || !allowed.includes(source))
  ) {
    throw new Error(`${name} contains an unknown or empty source`);
  }
  if (new Set(sources).size !== sources.length)
    throw new Error(`${name} contains a duplicate source`);
  return Object.freeze([...sources]);
}

function enabled(name: string, value: boolean): string {
  return `${value ? "" : "no"}${name}`;
}
