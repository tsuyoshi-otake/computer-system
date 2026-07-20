import { sha256Hex } from "../../domain/crypto/sha256.js";

export const GUEST_MAKE_LIMITS = Object.freeze({
  sourceCharacters: 32_768,
  lines: 256,
  rules: 128,
  graphNodes: 256,
  graphEdges: 512,
  prerequisitesPerRule: 64,
  requestedTargets: 64,
  variables: 128,
  variableNameCharacters: 64,
  variableValueCharacters: 512,
  expandedRecipeCharacters: 4_096,
  expansionDepth: 8,
  graphDepth: 32,
  pathCharacters: 128,
  recipeLines: 256,
  fingerprintBytes: 1_048_576,
  stateCharacters: 32_768,
  stateRecords: 128,
});

export const GUEST_MAKE_TOOLCHAIN_ID =
  "CS Make 1.0|CS ASM 1.0|CS C/C++ 1.0|CS486OBJ3|CS486EXE3";
export const GUEST_MAKE_STATE_MARKER = "CSMAKE2\n";
const legacyGuestMakeStateMarker = "CSMAKE1\n";
const pendingGuestMakeStateMarker = "CSMAKE2-PENDING\n";

export class GuestMakeError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "GuestMakeError";
  }
}

export interface GuestMakeArguments {
  readonly makefile?: string;
  readonly directory?: string;
  readonly dryRun: boolean;
  readonly force: boolean;
  readonly silent: boolean;
  readonly help: boolean;
  readonly version: boolean;
  readonly variables: ReadonlyMap<string, string>;
  readonly targets: readonly string[];
}

export interface GuestMakeRecipe {
  readonly command: string;
  readonly silent: boolean;
}

export interface GuestMakeRule {
  readonly target: string;
  readonly prerequisites: readonly string[];
  readonly recipes: readonly GuestMakeRecipe[];
  readonly phony: boolean;
  readonly line: number;
}

export interface GuestMakefile {
  readonly rules: ReadonlyMap<string, GuestMakeRule>;
  readonly defaultTarget?: string;
}

export interface GuestMakePlannedTarget {
  readonly target: string;
  readonly prerequisites: readonly string[];
  readonly recipes: readonly GuestMakeRecipe[];
  readonly phony: boolean;
}

export interface GuestMakePlan {
  readonly requestedTargets: readonly string[];
  readonly targets: readonly GuestMakePlannedTarget[];
  readonly skippedTargets: readonly string[];
}

export interface GuestMakeStateRecord {
  readonly inputFingerprint: string;
  readonly outputFingerprint: string;
}

export interface GuestMakeFingerprintFile {
  readonly contents?: string;
  readonly kind: "directory" | "file" | "missing";
}

export interface GuestMakePlannerFilesystem {
  exists(path: string): boolean;
  fingerprintChanged?(
    target: string,
    prerequisites: readonly string[],
    recipes: readonly GuestMakeRecipe[],
  ): boolean;
  modifiedAt(path: string): number | undefined;
}

interface MutableRule {
  readonly target: string;
  readonly prerequisites: string[];
  readonly recipes: GuestMakeRecipe[];
  readonly line: number;
}

interface MakeVariable {
  readonly flavor: "recursive" | "simple";
  readonly value: string;
  readonly commandLine: boolean;
}

const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)\s*(\?=|:=|\+=|=)\s*(.*)$/u;
const BUILTIN_VARIABLES = Object.freeze({
  AS: "as",
  CC: "cc",
  CXX: "c++",
  LD: "ld",
  RM: "rm -f",
});

function fail(message: string): never {
  throw new GuestMakeError(message);
}

function assertVariableName(name: string): void {
  if (
    !VARIABLE_NAME.test(name) ||
    name.length > GUEST_MAKE_LIMITS.variableNameCharacters
  ) {
    fail(`invalid variable name '${name}'`);
  }
}

function parseVariableOverride(
  argument: string,
): readonly [string, string] | undefined {
  const separator = argument.indexOf("=");
  if (separator <= 0) return undefined;
  const name = argument.slice(0, separator);
  if (!VARIABLE_NAME.test(name)) return undefined;
  assertVariableName(name);
  const value = argument.slice(separator + 1);
  if (value.length > GUEST_MAKE_LIMITS.variableValueCharacters) {
    fail(
      `variable '${name}' exceeds ${GUEST_MAKE_LIMITS.variableValueCharacters} characters`,
    );
  }
  return [name, value];
}

export function parseGuestMakeArguments(
  args: readonly string[],
): GuestMakeArguments {
  let makefile: string | undefined;
  let directory: string | undefined;
  let dryRun = false;
  let force = false;
  let silent = false;
  let help = false;
  let version = false;
  const variables = new Map<string, string>();
  const targets: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] ?? "";
    if (argument === "--help") {
      help = true;
      continue;
    }
    if (argument === "--version") {
      version = true;
      continue;
    }
    if (argument === "-f" || argument === "-C") {
      const value = args[index + 1];
      if (value === undefined || value.length === 0)
        fail(`option ${argument} requires a value`);
      if (argument === "-f") makefile = value;
      else directory = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("-f") && argument.length > 2) {
      makefile = argument.slice(2);
      continue;
    }
    if (argument.startsWith("-C") && argument.length > 2) {
      directory = argument.slice(2);
      continue;
    }
    if (argument === "-j1" || argument === "--jobs=1") continue;
    if (argument.startsWith("-") && argument.length > 1) {
      for (const flag of argument.slice(1)) {
        if (flag === "n") dryRun = true;
        else if (flag === "B") force = true;
        else if (flag === "s") silent = true;
        else fail(`unsupported option '-${flag}'`);
      }
      continue;
    }
    const variable = parseVariableOverride(argument);
    if (variable !== undefined) {
      variables.set(variable[0], variable[1]);
      continue;
    }
    if (argument.length > GUEST_MAKE_LIMITS.pathCharacters) {
      fail(
        `requested target exceeds ${GUEST_MAKE_LIMITS.pathCharacters} characters`,
      );
    }
    targets.push(argument);
    if (targets.length > GUEST_MAKE_LIMITS.requestedTargets) {
      fail(
        `requested target count exceeds ${GUEST_MAKE_LIMITS.requestedTargets}`,
      );
    }
  }

  return {
    ...(makefile === undefined ? {} : { makefile }),
    ...(directory === undefined ? {} : { directory }),
    dryRun,
    force,
    silent,
    help,
    version,
    variables,
    targets,
  };
}

function stripComment(line: string): string {
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === "#" && !escaped) return line.slice(0, index);
    escaped = character === "\\" && !escaped;
    if (character !== "\\") escaped = false;
  }
  return line;
}

function appendVariableValue(left: string, right: string): string {
  if (left.length === 0) return right;
  if (right.length === 0) return left;
  return `${left} ${right}`;
}

function expandText(
  source: string,
  variables: ReadonlyMap<string, MakeVariable>,
  automatic: ReadonlyMap<string, string> = new Map(),
  stack: readonly string[] = [],
): string {
  if (stack.length > GUEST_MAKE_LIMITS.expansionDepth) {
    fail(
      `variable expansion exceeds depth ${GUEST_MAKE_LIMITS.expansionDepth}`,
    );
  }
  let output = "";
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character !== "$") {
      output += character;
      continue;
    }
    const next = source[index + 1];
    if (next === undefined) fail("unterminated '$' expansion");
    if (next === "$") {
      output += "$";
      index += 1;
      continue;
    }
    if (next === "@" || next === "<" || next === "^") {
      output += automatic.get(next) ?? "";
      index += 1;
      continue;
    }
    if (next !== "(" && next !== "{")
      fail(`unsupported variable expansion '$${next}'`);
    const closer = next === "(" ? ")" : "}";
    const closeIndex = source.indexOf(closer, index + 2);
    if (closeIndex < 0) fail("unterminated variable expansion");
    const name = source.slice(index + 2, closeIndex);
    assertVariableName(name);
    if (stack.includes(name))
      fail(`recursive variable expansion: ${[...stack, name].join(" -> ")}`);
    const variable = variables.get(name);
    if (variable !== undefined) {
      output +=
        variable.flavor === "simple"
          ? variable.value
          : expandText(variable.value, variables, automatic, [...stack, name]);
    }
    index = closeIndex;
  }
  return output;
}

function parseWords(value: string, context: string): string[] {
  const words = value.trim().length === 0 ? [] : value.trim().split(/\s+/u);
  if (words.some((word) => word.length === 0)) fail(`invalid ${context}`);
  return words;
}

export function parseGuestMakefile(
  source: string,
  commandLineVariables: ReadonlyMap<string, string> = new Map(),
): GuestMakefile {
  if (source.length > GUEST_MAKE_LIMITS.sourceCharacters) {
    fail(`Makefile exceeds ${GUEST_MAKE_LIMITS.sourceCharacters} characters`);
  }
  const lines = source
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("\n");
  if (lines.length > GUEST_MAKE_LIMITS.lines) {
    fail(`Makefile exceeds ${GUEST_MAKE_LIMITS.lines} lines`);
  }

  const variables = new Map<string, MakeVariable>();
  for (const [name, value] of Object.entries(BUILTIN_VARIABLES)) {
    variables.set(name, { flavor: "simple", value, commandLine: false });
  }
  for (const [name, value] of commandLineVariables) {
    assertVariableName(name);
    if (value.length > GUEST_MAKE_LIMITS.variableValueCharacters) {
      fail(
        `variable '${name}' exceeds ${GUEST_MAKE_LIMITS.variableValueCharacters} characters`,
      );
    }
    variables.set(name, { flavor: "simple", value, commandLine: true });
  }
  if (variables.size > GUEST_MAKE_LIMITS.variables) {
    fail(`variable count exceeds ${GUEST_MAKE_LIMITS.variables}`);
  }

  const rules = new Map<string, MutableRule>();
  const phonyTargets = new Set<string>();
  const graphNodes = new Set<string>();
  let activeRule: MutableRule | undefined;
  let defaultTarget: string | undefined;
  let recipeLines = 0;
  let edgeCount = 0;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const rawLine = lines[lineIndex] ?? "";
    const lineNumber = lineIndex + 1;
    if (rawLine.startsWith("\t")) {
      if (activeRule === undefined)
        fail(`line ${lineNumber}: recipe has no target`);
      let command = rawLine.slice(1);
      let silent = false;
      if (command.startsWith("@")) {
        silent = true;
        command = command.slice(1);
      }
      if (command.startsWith("-") || command.startsWith("+")) {
        fail(`line ${lineNumber}: recipe prefixes '-' and '+' are unsupported`);
      }
      if (command.trim().length === 0) continue;
      activeRule.recipes.push({ command, silent });
      recipeLines += 1;
      if (recipeLines > GUEST_MAKE_LIMITS.recipeLines) {
        fail(`recipe line count exceeds ${GUEST_MAKE_LIMITS.recipeLines}`);
      }
      continue;
    }

    activeRule = undefined;
    const line = stripComment(rawLine).trim();
    if (line.length === 0) continue;
    const assignment = ASSIGNMENT.exec(line);
    if (assignment !== null) {
      const [, name = "", operator = "", rawValue = ""] = assignment;
      assertVariableName(name);
      const existing = variables.get(name);
      if (existing?.commandLine === true) continue;
      if (operator === "?=" && existing !== undefined) continue;
      let flavor: MakeVariable["flavor"] =
        operator === ":=" ? "simple" : "recursive";
      let value =
        operator === ":=" ? expandText(rawValue, variables) : rawValue;
      if (operator === "+=" && existing !== undefined) {
        flavor = existing.flavor;
        value =
          existing.flavor === "simple"
            ? appendVariableValue(
                existing.value,
                expandText(rawValue, variables),
              )
            : appendVariableValue(existing.value, rawValue);
      }
      if (value.length > GUEST_MAKE_LIMITS.variableValueCharacters) {
        fail(
          `line ${lineNumber}: variable '${name}' exceeds ${GUEST_MAKE_LIMITS.variableValueCharacters} characters`,
        );
      }
      variables.set(name, { flavor, value, commandLine: false });
      if (variables.size > GUEST_MAKE_LIMITS.variables) {
        fail(`variable count exceeds ${GUEST_MAKE_LIMITS.variables}`);
      }
      continue;
    }

    const colon = line.indexOf(":");
    if (colon < 0) fail(`line ${lineNumber}: expected assignment or rule`);
    const targets = parseWords(
      expandText(line.slice(0, colon), variables),
      "rule target",
    );
    const prerequisites = parseWords(
      expandText(line.slice(colon + 1), variables),
      "rule prerequisites",
    );
    if (targets.length === 0) fail(`line ${lineNumber}: rule has no target`);
    if (targets[0] === ".PHONY") {
      if (targets.length !== 1)
        fail(`line ${lineNumber}: malformed .PHONY rule`);
      if (prerequisites.length > GUEST_MAKE_LIMITS.prerequisitesPerRule) {
        fail(
          `line ${lineNumber}: prerequisite count exceeds ${GUEST_MAKE_LIMITS.prerequisitesPerRule}`,
        );
      }
      for (const target of prerequisites) {
        if (target.length > GUEST_MAKE_LIMITS.pathCharacters) {
          fail(
            `line ${lineNumber}: target exceeds ${GUEST_MAKE_LIMITS.pathCharacters} characters`,
          );
        }
        phonyTargets.add(target);
        graphNodes.add(target);
      }
      if (graphNodes.size > GUEST_MAKE_LIMITS.graphNodes) {
        fail(`dependency node count exceeds ${GUEST_MAKE_LIMITS.graphNodes}`);
      }
      continue;
    }
    if (targets.length !== 1)
      fail(`line ${lineNumber}: multiple rule targets are unsupported`);
    if (prerequisites.length > GUEST_MAKE_LIMITS.prerequisitesPerRule) {
      fail(
        `line ${lineNumber}: prerequisite count exceeds ${GUEST_MAKE_LIMITS.prerequisitesPerRule}`,
      );
    }
    const target = targets[0] ?? "";
    if (
      target.length > GUEST_MAKE_LIMITS.pathCharacters ||
      prerequisites.some(
        (prerequisite) =>
          prerequisite.length > GUEST_MAKE_LIMITS.pathCharacters,
      )
    ) {
      fail(
        `line ${lineNumber}: target or prerequisite path exceeds ${GUEST_MAKE_LIMITS.pathCharacters} characters`,
      );
    }
    if (rules.has(target))
      fail(`line ${lineNumber}: duplicate rule for '${target}'`);
    const rule: MutableRule = {
      target,
      prerequisites,
      recipes: [],
      line: lineNumber,
    };
    rules.set(target, rule);
    graphNodes.add(target);
    for (const prerequisite of prerequisites) graphNodes.add(prerequisite);
    activeRule = rule;
    edgeCount += prerequisites.length;
    if (
      rules.size > GUEST_MAKE_LIMITS.rules ||
      rules.size > GUEST_MAKE_LIMITS.graphNodes
    ) {
      fail(`rule count exceeds ${GUEST_MAKE_LIMITS.rules}`);
    }
    if (edgeCount > GUEST_MAKE_LIMITS.graphEdges) {
      fail(`dependency edge count exceeds ${GUEST_MAKE_LIMITS.graphEdges}`);
    }
    if (graphNodes.size > GUEST_MAKE_LIMITS.graphNodes) {
      fail(`dependency node count exceeds ${GUEST_MAKE_LIMITS.graphNodes}`);
    }
    if (defaultTarget === undefined && !target.startsWith("."))
      defaultTarget = target;
  }

  const frozenRules = new Map<string, GuestMakeRule>();
  for (const [target, rule] of rules) {
    frozenRules.set(target, {
      target,
      prerequisites: [...rule.prerequisites],
      recipes: rule.recipes.map((recipe) => ({ ...recipe })),
      phony: phonyTargets.has(target),
      line: rule.line,
    });
  }
  return {
    rules: frozenRules,
    ...(defaultTarget === undefined ? {} : { defaultTarget }),
  };
}

function expandRecipe(
  recipe: GuestMakeRecipe,
  variables: ReadonlyMap<string, MakeVariable>,
  target: string,
  prerequisites: readonly string[],
): GuestMakeRecipe {
  const automatic = new Map<string, string>([
    ["@", target],
    ["<", prerequisites[0] ?? ""],
    ["^", [...new Set(prerequisites)].join(" ")],
  ]);
  const command = expandText(recipe.command, variables, automatic);
  if (command.length > GUEST_MAKE_LIMITS.expandedRecipeCharacters) {
    fail(
      `recipe for '${target}' exceeds ${GUEST_MAKE_LIMITS.expandedRecipeCharacters} characters`,
    );
  }
  return { command, silent: recipe.silent };
}

function variablesForPlanning(
  source: string,
  commandLineVariables: ReadonlyMap<string, string>,
): ReadonlyMap<string, MakeVariable> {
  const variables = new Map<string, MakeVariable>();
  for (const [name, value] of Object.entries(BUILTIN_VARIABLES)) {
    variables.set(name, { flavor: "simple", value, commandLine: false });
  }
  for (const [name, value] of commandLineVariables) {
    variables.set(name, { flavor: "simple", value, commandLine: true });
  }
  for (const rawLine of source
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("\n")) {
    if (rawLine.startsWith("\t")) continue;
    const assignment = ASSIGNMENT.exec(stripComment(rawLine).trim());
    if (assignment === null) continue;
    const [, name = "", operator = "", rawValue = ""] = assignment;
    const existing = variables.get(name);
    if (
      existing?.commandLine === true ||
      (operator === "?=" && existing !== undefined)
    )
      continue;
    let flavor: MakeVariable["flavor"] =
      operator === ":=" ? "simple" : "recursive";
    let value = operator === ":=" ? expandText(rawValue, variables) : rawValue;
    if (operator === "+=" && existing !== undefined) {
      flavor = existing.flavor;
      value =
        existing.flavor === "simple"
          ? appendVariableValue(existing.value, expandText(rawValue, variables))
          : appendVariableValue(existing.value, rawValue);
    }
    variables.set(name, { flavor, value, commandLine: false });
  }
  return variables;
}

export function planGuestMakeBuild(
  makefile: GuestMakefile,
  source: string,
  commandLineVariables: ReadonlyMap<string, string>,
  filesystem: GuestMakePlannerFilesystem,
  requestedTargets: readonly string[],
  force = false,
): GuestMakePlan {
  const roots =
    requestedTargets.length > 0
      ? [...requestedTargets]
      : makefile.defaultTarget === undefined
        ? fail("no targets specified and no default target found")
        : [makefile.defaultTarget];
  if (roots.length > GUEST_MAKE_LIMITS.requestedTargets) {
    fail(
      `requested target count exceeds ${GUEST_MAKE_LIMITS.requestedTargets}`,
    );
  }
  if (
    roots.some((target) => target.length > GUEST_MAKE_LIMITS.pathCharacters)
  ) {
    fail(
      `requested target exceeds ${GUEST_MAKE_LIMITS.pathCharacters} characters`,
    );
  }
  const variables = variablesForPlanning(source, commandLineVariables);
  const visiting: string[] = [];
  const visited = new Set<string>();
  const rebuilt = new Set<string>();
  const planned: GuestMakePlannedTarget[] = [];
  const skipped: string[] = [];

  const visit = (target: string, depth: number): void => {
    if (depth > GUEST_MAKE_LIMITS.graphDepth) {
      fail(`dependency graph exceeds depth ${GUEST_MAKE_LIMITS.graphDepth}`);
    }
    if (visited.has(target)) return;
    const cycleStart = visiting.indexOf(target);
    if (cycleStart >= 0)
      fail(
        `dependency cycle: ${[...visiting.slice(cycleStart), target].join(" -> ")}`,
      );
    visiting.push(target);
    const rule = makefile.rules.get(target);
    if (rule === undefined) {
      visiting.pop();
      visited.add(target);
      if (!filesystem.exists(target))
        fail(`no rule to make target '${target}'`);
      return;
    }
    for (const prerequisite of rule.prerequisites) {
      if (makefile.rules.has(prerequisite)) visit(prerequisite, depth + 1);
      else if (!filesystem.exists(prerequisite))
        fail(`no rule to make target '${prerequisite}'`);
    }

    const targetExists = filesystem.exists(target);
    const targetModifiedAt =
      filesystem.modifiedAt(target) ?? Number.NEGATIVE_INFINITY;
    const prerequisiteNewer = rule.prerequisites.some((prerequisite) => {
      if (rebuilt.has(prerequisite)) return true;
      const modifiedAt = filesystem.modifiedAt(prerequisite);
      return modifiedAt !== undefined && modifiedAt > targetModifiedAt;
    });
    const expandedRecipes = rule.recipes.map((recipe) =>
      expandRecipe(recipe, variables, target, rule.prerequisites),
    );
    const fingerprintChanged =
      filesystem.fingerprintChanged?.(
        target,
        rule.prerequisites,
        expandedRecipes,
      ) ?? false;
    const needsBuild =
      force ||
      rule.phony ||
      !targetExists ||
      prerequisiteNewer ||
      fingerprintChanged;
    if (needsBuild) {
      if (rule.recipes.length === 0) {
        if (rule.prerequisites.length === 0 && !rule.phony) {
          fail(`no recipe to make target '${target}'`);
        }
      } else {
        planned.push({
          target,
          prerequisites: [...rule.prerequisites],
          recipes: expandedRecipes,
          phony: rule.phony,
        });
      }
      rebuilt.add(target);
    } else {
      skipped.push(target);
    }
    visiting.pop();
    visited.add(target);
  };

  for (const root of roots) visit(root, 1);
  return { requestedTargets: roots, targets: planned, skippedTargets: skipped };
}

export function parseGuestMakeState(
  contents: string,
): Map<string, GuestMakeStateRecord> {
  if (contents.length > GUEST_MAKE_LIMITS.stateCharacters) {
    fail("invalid or oversized .cs-make-state");
  }
  if (contents === pendingGuestMakeStateMarker) return new Map();
  if (contents.startsWith(legacyGuestMakeStateMarker)) {
    const legacy = parseStateJson(
      contents.slice(legacyGuestMakeStateMarker.length),
      "invalid .cs-make-state JSON",
    );
    const entries = Object.entries(legacy);
    if (
      entries.length > GUEST_MAKE_LIMITS.stateRecords ||
      entries.some(
        ([target, fingerprint]) =>
          !isStateTarget(target) ||
          typeof fingerprint !== "string" ||
          !/^[0-9a-f]{8}$/u.test(fingerprint),
      )
    ) {
      fail("invalid .cs-make-state entry");
    }
    return new Map();
  }
  if (!contents.startsWith(GUEST_MAKE_STATE_MARKER)) {
    fail("invalid .cs-make-state marker");
  }
  const value = parseStateJson(
    contents.slice(GUEST_MAKE_STATE_MARKER.length),
    "invalid .cs-make-state JSON",
  );
  if (
    Object.keys(value).some(
      (key) => key !== "records" && key !== "toolchain",
    ) ||
    typeof value.toolchain !== "string" ||
    typeof value.records !== "object" ||
    value.records === null ||
    Array.isArray(value.records)
  ) {
    fail("invalid .cs-make-state record");
  }
  const entries = Object.entries(value.records);
  if (
    entries.length > GUEST_MAKE_LIMITS.stateRecords ||
    entries.some(
      ([target, record]) =>
        !isStateTarget(target) ||
        typeof record !== "object" ||
        record === null ||
        Array.isArray(record) ||
        Object.keys(record as Record<string, unknown>).some(
          (key) => key !== "inputFingerprint" && key !== "outputFingerprint",
        ) ||
        typeof (record as { inputFingerprint?: unknown }).inputFingerprint !==
          "string" ||
        typeof (record as { outputFingerprint?: unknown }).outputFingerprint !==
          "string" ||
        !/^[0-9a-f]{64}$/u.test(
          (record as { inputFingerprint: string }).inputFingerprint,
        ) ||
        !/^[0-9a-f]{64}$/u.test(
          (record as { outputFingerprint: string }).outputFingerprint,
        ),
    )
  ) {
    fail("invalid .cs-make-state entry");
  }
  if (value.toolchain !== GUEST_MAKE_TOOLCHAIN_ID) return new Map();
  return new Map(
    entries.map(([target, record]) => [
      target,
      {
        inputFingerprint: (record as { inputFingerprint: string })
          .inputFingerprint,
        outputFingerprint: (record as { outputFingerprint: string })
          .outputFingerprint,
      },
    ]),
  );
}

export function serializeGuestMakeState(
  state: ReadonlyMap<string, GuestMakeStateRecord>,
): string {
  if (
    state.size > GUEST_MAKE_LIMITS.stateRecords ||
    [...state].some(
      ([target, record]) =>
        !isStateTarget(target) ||
        !/^[0-9a-f]{64}$/u.test(record.inputFingerprint) ||
        !/^[0-9a-f]{64}$/u.test(record.outputFingerprint),
    )
  ) {
    fail("invalid .cs-make-state entry");
  }
  const records = Object.fromEntries(
    [...state]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([target, record]) => [target, { ...record }]),
  );
  const contents =
    GUEST_MAKE_STATE_MARKER +
    JSON.stringify({ toolchain: GUEST_MAKE_TOOLCHAIN_ID, records }) +
    "\n";
  if (contents.length > GUEST_MAKE_LIMITS.stateCharacters) {
    fail(".cs-make-state exceeds its size limit");
  }
  return contents;
}

export function fingerprintGuestMakeInput(
  target: string,
  prerequisites: readonly string[],
  recipes: readonly GuestMakeRecipe[],
  read: (path: string) => GuestMakeFingerprintFile,
): string {
  const inputs = prerequisites.map((path) => {
    const file = read(path);
    return {
      contents: file.kind === "file" ? (file.contents ?? "") : "",
      kind: file.kind,
      path,
    };
  });
  return sha256Hex(
    JSON.stringify({
      inputs,
      recipes: recipes.map((recipe) => ({
        command: recipe.command,
        silent: recipe.silent,
      })),
      target,
      toolchain: GUEST_MAKE_TOOLCHAIN_ID,
    }),
  );
}

export function fingerprintGuestMakeOutput(
  output: GuestMakeFingerprintFile,
): string {
  return sha256Hex(
    JSON.stringify({
      contents: output.kind === "file" ? (output.contents ?? "") : "",
      kind: output.kind,
    }),
  );
}

function parseStateJson(
  contents: string,
  error: string,
): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch {
    fail(error);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("invalid .cs-make-state record");
  }
  return value as Record<string, unknown>;
}

function isStateTarget(target: string): boolean {
  return target.length > 0 && target.length <= GUEST_MAKE_LIMITS.pathCharacters;
}
