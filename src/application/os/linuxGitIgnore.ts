import { utf8ByteLength } from "../../domain/text/utf8.js";

export const linuxGitIgnoreLimits = Object.freeze({
  maximumFileBytes: 16_384,
  maximumFiles: 64,
  maximumMatchSteps: 32_768,
  maximumOperationMatchSteps: 1_048_576,
  maximumPatternBytes: 256,
  maximumRules: 512,
});

export interface LinuxGitIgnoreRule {
  readonly anchored: boolean;
  readonly basePath: string;
  readonly directoryOnly: boolean;
  readonly negated: boolean;
  readonly pattern: string;
  readonly source: string;
}

export interface LinuxGitIgnoreBudget {
  files: number;
  rules: number;
}

export interface LinuxGitIgnoreMatchBudget {
  steps: number;
}

export class LinuxGitIgnoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LinuxGitIgnoreError";
  }
}

export function parseLinuxGitIgnore(
  contents: string,
  basePath: string,
  source: string,
  budget: LinuxGitIgnoreBudget,
): readonly LinuxGitIgnoreRule[] {
  const bytes = utf8ByteLength(contents);
  if (bytes > linuxGitIgnoreLimits.maximumFileBytes) {
    throw new LinuxGitIgnoreError(
      `${source}: ignore file exceeds ${String(linuxGitIgnoreLimits.maximumFileBytes)} bytes`,
    );
  }
  budget.files += 1;
  if (budget.files > linuxGitIgnoreLimits.maximumFiles) {
    throw new LinuxGitIgnoreError("ignore file count limit exceeded");
  }

  const rules: LinuxGitIgnoreRule[] = [];
  for (const rawLine of contents.split(/\r?\n/u)) {
    let line = stripUnescapedTrailingSpaces(rawLine);
    if (line.length === 0) continue;
    if (line.startsWith("#")) continue;
    let negated = false;
    if (line.startsWith("!")) {
      negated = true;
      line = line.slice(1);
    } else if (line.startsWith("\\#") || line.startsWith("\\!")) {
      line = line.slice(1);
    }
    if (line.length === 0) continue;
    const directoryOnly = endsWithUnescapedSlash(line);
    if (directoryOnly) line = line.slice(0, -1);
    const anchored = line.startsWith("/");
    if (anchored) line = line.slice(1);
    if (line.length === 0) continue;
    if (utf8ByteLength(line) > linuxGitIgnoreLimits.maximumPatternBytes) {
      throw new LinuxGitIgnoreError(
        `${source}: ignore pattern exceeds ${String(linuxGitIgnoreLimits.maximumPatternBytes)} bytes`,
      );
    }
    budget.rules += 1;
    if (budget.rules > linuxGitIgnoreLimits.maximumRules) {
      throw new LinuxGitIgnoreError("ignore rule count limit exceeded");
    }
    rules.push(
      Object.freeze({
        anchored,
        basePath: normalizeRelative(basePath),
        directoryOnly,
        negated,
        pattern: line,
        source,
      }),
    );
  }
  return Object.freeze(rules);
}

/**
 * Applies rules in source order. Callers traverse parents before children and
 * do not descend into ignored directories, preserving Git's parent exclusion
 * rule without an unbounded descendant search.
 */
export function linuxGitPathIgnored(
  rules: readonly LinuxGitIgnoreRule[],
  path: string,
  directory: boolean,
  matchBudget?: LinuxGitIgnoreMatchBudget,
): boolean {
  const normalized = normalizeRelative(path);
  if (normalized === ".git" || normalized.startsWith(".git/")) return true;
  let ignored = false;
  for (const rule of rules) {
    if (rule.directoryOnly && !directory) continue;
    const relative = relativeToBase(normalized, rule.basePath);
    if (relative === undefined || relative.length === 0) continue;
    if (
      matchesIgnorePattern(rule.pattern, relative, rule.anchored, matchBudget)
    ) {
      ignored = !rule.negated;
    }
  }
  return ignored;
}

export function matchesIgnorePattern(
  pattern: string,
  relativePath: string,
  anchored = false,
  matchBudget?: LinuxGitIgnoreMatchBudget,
): boolean {
  const normalizedPattern = pattern.replaceAll("\\/", "/");
  const normalizedPath = normalizeRelative(relativePath);
  if (!anchored && !normalizedPattern.includes("/")) {
    return normalizedPath
      .split("/")
      .some((segment) =>
        boundedWildMatch(normalizedPattern, segment, matchBudget),
      );
  }
  return boundedWildMatch(normalizedPattern, normalizedPath, matchBudget);
}

function boundedWildMatch(
  pattern: string,
  value: string,
  matchBudget?: LinuxGitIgnoreMatchBudget,
): boolean {
  const valueWidth = value.length + 1;
  const memo = new Uint8Array((pattern.length + 1) * valueWidth);
  const characterClasses = new Map<
    number,
    { readonly contents: string; readonly nextIndex: number } | null
  >();
  let steps = 0;
  const visit = (patternIndex: number, valueIndex: number): boolean => {
    steps += 1;
    if (matchBudget !== undefined) {
      matchBudget.steps += 1;
      if (matchBudget.steps > linuxGitIgnoreLimits.maximumOperationMatchSteps) {
        throw new LinuxGitIgnoreError(
          "ignore operation match step limit exceeded",
        );
      }
    }
    if (steps > linuxGitIgnoreLimits.maximumMatchSteps) {
      throw new LinuxGitIgnoreError("ignore pattern match step limit exceeded");
    }
    const memoIndex = patternIndex * valueWidth + valueIndex;
    const cached = memo[memoIndex];
    if (cached !== 0) return cached === 2;
    let result: boolean;
    if (patternIndex >= pattern.length) {
      result = valueIndex >= value.length;
    } else {
      const character = pattern[patternIndex]!;
      if (character === "\\") {
        const literal = pattern[patternIndex + 1];
        result =
          literal !== undefined &&
          value[valueIndex] === literal &&
          visit(patternIndex + 2, valueIndex + 1);
      } else if (character === "*") {
        const double = pattern[patternIndex + 1] === "*";
        let nextPattern = patternIndex + (double ? 2 : 1);
        while (pattern[nextPattern] === "*") nextPattern += 1;
        result =
          double && pattern[nextPattern] === "/"
            ? visit(nextPattern + 1, valueIndex)
            : visit(nextPattern, valueIndex);
        if (!result && valueIndex < value.length) {
          result =
            (double || value[valueIndex] !== "/") &&
            visit(patternIndex, valueIndex + 1);
        }
      } else if (character === "?") {
        result =
          valueIndex < value.length &&
          value[valueIndex] !== "/" &&
          visit(patternIndex + 1, valueIndex + 1);
      } else if (character === "[") {
        let parsed = characterClasses.get(patternIndex);
        if (parsed === undefined) {
          parsed = parseCharacterClass(pattern, patternIndex) ?? null;
          characterClasses.set(patternIndex, parsed);
        }
        result =
          parsed === null
            ? value[valueIndex] === "[" &&
              visit(patternIndex + 1, valueIndex + 1)
            : valueIndex < value.length &&
              value[valueIndex] !== "/" &&
              characterClassMatches(parsed.contents, value[valueIndex]!) &&
              visit(parsed.nextIndex, valueIndex + 1);
      } else {
        result =
          value[valueIndex] === character &&
          visit(patternIndex + 1, valueIndex + 1);
      }
    }
    memo[memoIndex] = result ? 2 : 1;
    return result;
  };
  return visit(0, 0);
}

function parseCharacterClass(
  pattern: string,
  start: number,
): { readonly contents: string; readonly nextIndex: number } | undefined {
  let index = start + 1;
  if (pattern[index] === "]") index += 1;
  while (index < pattern.length && pattern[index] !== "]") index += 1;
  if (index >= pattern.length) return undefined;
  return { contents: pattern.slice(start + 1, index), nextIndex: index + 1 };
}

function characterClassMatches(contents: string, value: string): boolean {
  let index = 0;
  let negated = false;
  if (contents.startsWith("!") || contents.startsWith("^")) {
    negated = true;
    index += 1;
  }
  let matched = false;
  while (index < contents.length) {
    const first = classCharacter(contents, index);
    index = first.nextIndex;
    if (contents[index] === "-" && index + 1 < contents.length) {
      const last = classCharacter(contents, index + 1);
      index = last.nextIndex;
      matched ||= value >= first.value && value <= last.value;
    } else {
      matched ||= value === first.value;
    }
  }
  return negated ? !matched : matched;
}

function classCharacter(
  contents: string,
  index: number,
): { readonly nextIndex: number; readonly value: string } {
  if (contents[index] === "\\" && index + 1 < contents.length) {
    return { nextIndex: index + 2, value: contents[index + 1]! };
  }
  return { nextIndex: index + 1, value: contents[index]! };
}

function stripUnescapedTrailingSpaces(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === " ") {
    let slashes = 0;
    for (let index = end - 2; index >= 0 && value[index] === "\\"; index -= 1) {
      slashes += 1;
    }
    if (slashes % 2 === 1) {
      break;
    }
    end -= 1;
  }
  return value.slice(0, end);
}

function endsWithUnescapedSlash(value: string): boolean {
  if (!value.endsWith("/")) return false;
  let slashes = 0;
  for (
    let index = value.length - 2;
    index >= 0 && value[index] === "\\";
    index -= 1
  ) {
    slashes += 1;
  }
  return slashes % 2 === 0;
}

function relativeToBase(path: string, base: string): string | undefined {
  if (base.length === 0) return path;
  if (path === base) return "";
  return path.startsWith(`${base}/`) ? path.slice(base.length + 1) : undefined;
}

function normalizeRelative(value: string): string {
  return value
    .replaceAll("\\", "/")
    .replace(/^\/+|\/+$/gu, "")
    .replace(/\/{2,}/gu, "/");
}
