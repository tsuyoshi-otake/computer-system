/**
 * Bounded CS-Linux `perl` interpreter.
 *
 * The guest command runs a fixed Perl 5.40-shaped subset entirely inside the
 * sandbox: no host process, no host filesystem, no host regular expressions,
 * and no unbounded work. Every construct outside the accepted subset fails
 * explicitly instead of being approximated.
 */

import { utf8ByteLength } from "../../domain/text/utf8.js";

import {
  type PerlBlock,
  type PerlExpression,
  type PerlRegexLiteral,
  type PerlStatement,
  PerlSyntaxError,
  parsePerlProgram,
} from "./linuxPerlParser.js";
import {
  type PerlRegex,
  PerlRegexError,
  type PerlRegexMatch,
  compilePerlRegex,
  matchPerlRegex,
} from "./linuxPerlRegex.js";

export const linuxPerlLimits = Object.freeze({
  maximumArrayElements: 65_536,
  maximumCallDepth: 64,
  maximumHandles: 8,
  maximumHashEntries: 65_536,
  maximumInputBytes: 1_048_576,
  maximumOutputBytes: 1_048_576,
  maximumRegexCache: 128,
  maximumScalarCharacters: 262_144,
  maximumSteps: 1_000_000,
});

export const linuxPerlVersion = "5.40.0";

export interface LinuxPerlIo {
  readonly environment?: ReadonlyMap<string, string>;
  isDirectory?: (path: string) => boolean;
  pathExists: (path: string) => boolean;
  readFile: (path: string) => string;
  writeFile: (path: string, contents: string, append: boolean) => void;
}

export interface LinuxPerlResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

type PerlScalar = string | number | undefined;

interface PerlValue {
  readonly items: readonly PerlScalar[];
  readonly kind: "aggregate" | "list" | "scalar";
}

interface PerlHandle {
  buffer: string;
  bufferBytes: number;
  closed: boolean;
  cursor: number;
  readonly lines: readonly string[];
  readonly mode: "<" | ">" | ">>";
  readonly path: string;
}

interface PerlScope {
  readonly arrays: Map<string, PerlScalar[]>;
  readonly hashes: Map<string, Map<string, PerlScalar>>;
  readonly parent: PerlScope | undefined;
  readonly scalars: Map<string, PerlScalar>;
}

type PerlLvalue =
  | { readonly kind: "scalar"; readonly name: string }
  | {
      readonly array: PerlScalar[];
      readonly index: number;
      readonly kind: "arrayElement";
    }
  | {
      readonly hash: Map<string, PerlScalar>;
      readonly key: string;
      readonly kind: "hashElement";
    }
  | { readonly kind: "array"; readonly name: string }
  | { readonly kind: "arrayLastIndex"; readonly name: string }
  | { readonly kind: "hash"; readonly name: string }
  | { readonly kind: "list"; readonly targets: readonly PerlLvalue[] }
  | {
      readonly kind: "substring";
      readonly start: number;
      readonly stop: number;
      readonly target: PerlLvalue;
    };

class PerlFatalError extends Error {}

class PerlDieError extends Error {
  constructor(readonly text: string) {
    super(text);
  }
}

class PerlExitSignal extends Error {
  constructor(readonly code: number) {
    super("exit");
  }
}

class PerlLoopSignal extends Error {
  constructor(
    readonly action: "last" | "next",
    readonly label?: string,
  ) {
    super(action);
  }

  /** A labelled jump passes through every loop that does not carry it. */
  targets(label: string | undefined): boolean {
    return this.label === undefined || this.label === label;
  }
}

class PerlReturnSignal extends Error {
  constructor(readonly value: PerlValue) {
    super("return");
  }
}

interface PerlOptions {
  autosplit: boolean;
  checkOnly: boolean;
  fieldSeparator: string | undefined;
  lineEnding: boolean;
  loop: "none" | "print" | "quiet";
  programName: string;
  source: string;
}

const usageText =
  "usage: perl [-n|-p] [-a] [-l] [-F PATTERN] [-c] [-w] [-e CODE] [SCRIPT] [ARGUMENT ...]\n";

/** Runs one bounded `perl` invocation and returns its guest-visible result. */
export function executeLinuxPerl(
  arguments_: readonly string[],
  stdin: string,
  io: LinuxPerlIo,
): LinuxPerlResult {
  let options: PerlOptions;
  let scriptArguments: readonly string[];
  try {
    const parsed = parseCommandLine(arguments_, io);
    if (parsed.version) {
      return {
        exitCode: 0,
        stderr: "",
        stdout:
          `This is perl 5, version 40, subversion 0 (v${linuxPerlVersion}) built for cs486-cs-linux\n\n` +
          "CS-Linux perl runs a bounded Perl subset inside the guest sandbox.\n" +
          "See 'man perl' for the supported surface and its fixed limits.\n",
      };
    }
    options = parsed.options;
    scriptArguments = parsed.scriptArguments;
  } catch (error) {
    return failure(error, "perl");
  }

  if (utf8ByteLength(stdin) > linuxPerlLimits.maximumInputBytes) {
    return {
      exitCode: 2,
      stderr: "perl: input byte limit exceeded\n",
      stdout: "",
    };
  }

  let program;
  try {
    program = parsePerlProgram(options.source);
  } catch (error) {
    const detail =
      error instanceof PerlSyntaxError ? error.message : describe(error);
    return {
      exitCode: 255,
      stderr:
        `${detail.replace(" at line ", ` at ${options.programName} line `)}\n` +
        `Execution of ${options.programName} aborted due to compilation errors.\n`,
      stdout: "",
    };
  }
  if (options.checkOnly) {
    return {
      exitCode: 0,
      stderr: `${options.programName} syntax OK\n`,
      stdout: "",
    };
  }

  const interpreter = new PerlInterpreter(options, scriptArguments, stdin, io);
  return interpreter.run(program.body);
}

interface CommandLine {
  readonly options: PerlOptions;
  readonly scriptArguments: readonly string[];
  readonly version: boolean;
}

function parseCommandLine(
  arguments_: readonly string[],
  io: LinuxPerlIo,
): CommandLine {
  const inlineParts: string[] = [];
  let autosplit = false;
  let checkOnly = false;
  let fieldSeparator: string | undefined;
  let lineEnding = false;
  let loop: "none" | "print" | "quiet" = "none";
  let index = 0;
  while (index < arguments_.length) {
    const argument = arguments_[index]!;
    if (argument === "--") {
      index += 1;
      break;
    }
    if (argument.length < 2 || !argument.startsWith("-") || argument === "-")
      break;
    if (argument === "--version") {
      return emptyCommandLine(true);
    }
    if (argument.startsWith("--")) {
      throw new PerlUsageError(`Unrecognized switch: ${argument}`);
    }
    let consumedValue = false;
    for (let position = 1; position < argument.length; position += 1) {
      const flag = argument[position]!;
      const inlineValue = argument.slice(position + 1);
      switch (flag) {
        case "e": {
          const value =
            inlineValue.length > 0 ? inlineValue : arguments_[index + 1];
          if (value === undefined)
            throw new PerlUsageError("option -e requires code");
          if (inlineValue.length === 0) index += 1;
          inlineParts.push(value);
          consumedValue = true;
          break;
        }
        case "F": {
          const value =
            inlineValue.length > 0 ? inlineValue : arguments_[index + 1];
          if (value === undefined) {
            throw new PerlUsageError("option -F requires a pattern");
          }
          if (inlineValue.length === 0) index += 1;
          fieldSeparator = value;
          autosplit = true;
          consumedValue = true;
          break;
        }
        case "a":
          autosplit = true;
          break;
        case "c":
          checkOnly = true;
          break;
        case "l":
          lineEnding = true;
          break;
        case "n":
          loop = "quiet";
          break;
        case "p":
          loop = "print";
          break;
        case "v":
          return emptyCommandLine(true);
        case "w":
        case "W":
          break;
        default:
          throw new PerlUsageError(`Unrecognized switch: -${flag}`);
      }
      if (consumedValue) break;
    }
    index += 1;
  }

  if (inlineParts.length > 0) {
    return {
      options: {
        autosplit,
        checkOnly,
        fieldSeparator,
        lineEnding,
        loop,
        programName: "-e",
        source: inlineParts.join("\n"),
      },
      scriptArguments: Object.freeze(arguments_.slice(index)),
      version: false,
    };
  }

  const scriptPath = arguments_[index];
  if (scriptPath === undefined) throw new PerlUsageError("no program given");
  let source: string;
  try {
    source = io.readFile(scriptPath);
  } catch (error) {
    throw new PerlUsageError(
      `Can't open perl script "${scriptPath}": ${describe(error)}`,
    );
  }
  return {
    options: {
      autosplit,
      checkOnly,
      fieldSeparator,
      lineEnding,
      loop,
      programName: scriptPath,
      source,
    },
    scriptArguments: Object.freeze(arguments_.slice(index + 1)),
    version: false,
  };
}

function emptyCommandLine(version: boolean): CommandLine {
  return {
    options: {
      autosplit: false,
      checkOnly: false,
      fieldSeparator: undefined,
      lineEnding: false,
      loop: "none",
      programName: "-e",
      source: "",
    },
    scriptArguments: Object.freeze([]),
    version,
  };
}

class PerlUsageError extends Error {}

function failure(error: unknown, command: string): LinuxPerlResult {
  if (error instanceof PerlUsageError) {
    return {
      exitCode: 2,
      stderr: `${command}: ${error.message}\n${usageText}`,
      stdout: "",
    };
  }
  return {
    exitCode: 2,
    stderr: `${command}: ${describe(error)}\n`,
    stdout: "",
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function scalarValue(value: PerlScalar): PerlValue {
  return { items: [value], kind: "scalar" };
}

/** Reports whether assigning through one lvalue evaluates its right side as a list. */
function imposesListContext(lvalue: PerlLvalue): boolean {
  return (
    lvalue.kind === "array" || lvalue.kind === "hash" || lvalue.kind === "list"
  );
}

function listValue(items: readonly PerlScalar[]): PerlValue {
  return { items, kind: "list" };
}

function aggregateValue(items: readonly PerlScalar[]): PerlValue {
  return { items, kind: "aggregate" };
}

const emptyList: PerlValue = { items: [], kind: "list" };
const trueValue: PerlValue = { items: [1], kind: "scalar" };
const falseValue: PerlValue = { items: [""], kind: "scalar" };

function toScalar(value: PerlValue): PerlScalar {
  if (value.kind === "aggregate") return value.items.length;
  if (value.kind === "scalar") return value.items[0];
  return value.items.length === 0
    ? undefined
    : value.items[value.items.length - 1];
}

function toList(value: PerlValue): readonly PerlScalar[] {
  return value.items;
}

function toNumber(scalar: PerlScalar): number {
  if (scalar === undefined) return 0;
  if (typeof scalar === "number") return scalar;
  return parseLeadingNumber(scalar);
}

function parseLeadingNumber(text: string): number {
  let index = 0;
  while (index < text.length && /\s/u.test(text[index]!)) index += 1;
  const start = index;
  if (text[index] === "+" || text[index] === "-") index += 1;
  let digits = 0;
  while (index < text.length && text[index]! >= "0" && text[index]! <= "9") {
    index += 1;
    digits += 1;
  }
  if (text[index] === ".") {
    index += 1;
    while (index < text.length && text[index]! >= "0" && text[index]! <= "9") {
      index += 1;
      digits += 1;
    }
  }
  if (digits === 0) return 0;
  if (text[index] === "e" || text[index] === "E") {
    let lookahead = index + 1;
    if (text[lookahead] === "+" || text[lookahead] === "-") lookahead += 1;
    let exponentDigits = 0;
    while (
      lookahead < text.length &&
      text[lookahead]! >= "0" &&
      text[lookahead]! <= "9"
    ) {
      lookahead += 1;
      exponentDigits += 1;
    }
    if (exponentDigits > 0) index = lookahead;
  }
  const value = Number(text.slice(start, index));
  return Number.isFinite(value) ? value : 0;
}

function toText(scalar: PerlScalar): string {
  if (scalar === undefined) return "";
  if (typeof scalar === "string") return scalar;
  return numberToText(scalar);
}

function numberToText(value: number): string {
  if (Number.isNaN(value)) return "NaN";
  if (!Number.isFinite(value)) return value > 0 ? "Inf" : "-Inf";
  if (Number.isInteger(value) && Math.abs(value) < 1e15) return String(value);
  return formatGeneral(value, 15);
}

function isTrue(scalar: PerlScalar): boolean {
  if (scalar === undefined) return false;
  if (typeof scalar === "number") return scalar !== 0;
  return scalar.length > 0 && scalar !== "0";
}

function booleanValue(value: boolean): PerlValue {
  return value ? trueValue : falseValue;
}

class PerlInterpreter {
  private readonly argv: PerlScalar[];
  private callDepth = 0;
  private captures: readonly (string | undefined)[] = [];
  private currentLine = 0;
  private currentSubArguments: PerlScalar[] | undefined;
  private evalError = "";
  private readonly globals: PerlScope;
  private readonly handles = new Map<string, PerlHandle>();
  private handleSequence = 0;
  private readonly hashIterators = new Map<Map<string, PerlScalar>, number>();
  /** Where the most recent match landed, which is what `$&` reports. */
  private lastMatch:
    | { readonly end: number; readonly start: number; readonly subject: string }
    | undefined;
  /** Per-site `m//g` position, keyed by the match node and its subject. */
  private readonly matchCursors = new WeakMap<
    object,
    { cursor: number; subject: string }
  >();
  private lastError = "";
  private recordNumber = 0;
  private readonly regexCache = new Map<string, PerlRegex>();
  private scope: PerlScope;
  private stderr = "";
  private stderrBytes = 0;
  private stdout = "";
  private stdoutBytes = 0;
  private readonly stdinLines: readonly string[];
  private stdinCursor = 0;
  private steps = 0;
  private readonly subs = new Map<string, PerlBlock>();

  constructor(
    private readonly options: PerlOptions,
    scriptArguments: readonly string[],
    stdin: string,
    private readonly io: LinuxPerlIo,
  ) {
    this.globals = createScope(undefined);
    this.scope = this.globals;
    this.argv = scriptArguments.map((entry) => entry);
    this.globals.arrays.set("ARGV", this.argv);
    this.globals.arrays.set("F", []);
    const environment = new Map<string, PerlScalar>();
    for (const [name, value] of io.environment ?? new Map<string, string>()) {
      environment.set(name, value);
    }
    this.globals.hashes.set("ENV", environment);
    this.globals.scalars.set("_", undefined);
    this.stdinLines = splitLines(stdin);
  }

  run(body: PerlBlock): LinuxPerlResult {
    let exitCode = 0;
    try {
      this.hoistSubroutines(body);
      if (this.options.loop === "none") {
        this.executeBlockInPlace(body);
      } else {
        this.runInputLoop(body);
      }
      this.flushHandles();
    } catch (error) {
      if (error instanceof PerlExitSignal) {
        this.flushHandles();
        exitCode = error.code;
      } else if (error instanceof PerlDieError) {
        this.writeError(error.text);
        exitCode = 255;
      } else if (error instanceof PerlFatalError) {
        this.stderr += `perl: ${error.message}\n`;
        exitCode = 2;
      } else if (error instanceof PerlLoopSignal) {
        this.stderr += `perl: ${error.action} outside a loop\n`;
        exitCode = 255;
      } else if (error instanceof PerlReturnSignal) {
        this.stderr += "perl: return outside a subroutine\n";
        exitCode = 255;
      } else if (
        error instanceof PerlRegexError ||
        error instanceof RangeError
      ) {
        this.stderr += `perl: ${describe(error)}\n`;
        exitCode = 255;
      } else {
        throw error;
      }
    }
    return { exitCode, stderr: this.stderr, stdout: this.stdout };
  }

  private runInputLoop(body: PerlBlock): void {
    for (;;) {
      const line = this.readAnyInputLine();
      if (line === undefined) return;
      let record = line;
      if (this.options.lineEnding) record = chompText(record);
      this.setScalar("_", record);
      if (this.options.autosplit) {
        this.globals.arrays.set(
          "F",
          this.splitRecord(record, this.options.fieldSeparator),
        );
      }
      try {
        this.executeBlockInPlace(body);
      } catch (error) {
        if (error instanceof PerlLoopSignal) {
          if (error.action === "last") return;
        } else {
          throw error;
        }
      }
      if (this.options.loop === "print") {
        const current = toText(this.getScalar("_"));
        this.writeOutput(this.options.lineEnding ? `${current}\n` : current);
      }
    }
  }

  private splitRecord(
    record: string,
    separator: string | undefined,
  ): PerlScalar[] {
    if (separator === undefined) return splitOnWhitespace(record);
    const regex = this.compile(separator, "");
    return [...this.splitByRegex(regex, record, 0)];
  }

  // ---------------------------------------------------------------- scopes

  private pushScope(): void {
    this.scope = createScope(this.scope);
  }

  private popScope(): void {
    this.scope = this.scope.parent ?? this.globals;
  }

  private findScalarScope(name: string): PerlScope | undefined {
    for (
      let scope: PerlScope | undefined = this.scope;
      scope !== undefined;
      scope = scope.parent
    ) {
      if (scope.scalars.has(name)) return scope;
    }
    return undefined;
  }

  private getScalar(name: string): PerlScalar {
    if (name === "0") return this.options.programName;
    if (name === "@") return this.evalError;
    if (name === "!") return this.lastError;
    if (name === ".") return this.recordNumber;
    if (name === "&" || name === "`" || name === "'") {
      const match = this.lastMatch;
      if (match === undefined) return undefined;
      if (name === "&") return match.subject.slice(match.start, match.end);
      return name === "`"
        ? match.subject.slice(0, match.start)
        : match.subject.slice(match.end);
    }
    if (isDigits(name)) return this.captures[Number(name)];
    return this.findScalarScope(name)?.scalars.get(name);
  }

  private setScalar(name: string, value: PerlScalar): void {
    if (name === "@") {
      this.evalError = toText(value);
      return;
    }
    if (name === "!") {
      this.lastError = toText(value);
      return;
    }
    if (
      isDigits(name) ||
      name === "." ||
      name === "0" ||
      name === "&" ||
      name === "`" ||
      name === "'"
    ) {
      throw new PerlFatalError(
        `cannot assign to the read-only variable $${name}`,
      );
    }
    this.checkScalarSize(value);
    const scope = this.findScalarScope(name) ?? this.globals;
    scope.scalars.set(name, value);
  }

  private checkScalarSize(value: PerlScalar): void {
    if (
      typeof value === "string" &&
      value.length > linuxPerlLimits.maximumScalarCharacters
    ) {
      throw new PerlFatalError("scalar character limit exceeded");
    }
  }

  private getArray(name: string): PerlScalar[] {
    if (name === "_") {
      if (this.currentSubArguments === undefined) {
        const existing = this.globals.arrays.get("_");
        if (existing !== undefined) return existing;
        const created: PerlScalar[] = [];
        this.globals.arrays.set("_", created);
        return created;
      }
      return this.currentSubArguments;
    }
    for (
      let scope: PerlScope | undefined = this.scope;
      scope !== undefined;
      scope = scope.parent
    ) {
      const array = scope.arrays.get(name);
      if (array !== undefined) return array;
    }
    const created: PerlScalar[] = [];
    this.globals.arrays.set(name, created);
    return created;
  }

  private getHash(name: string): Map<string, PerlScalar> {
    for (
      let scope: PerlScope | undefined = this.scope;
      scope !== undefined;
      scope = scope.parent
    ) {
      const hash = scope.hashes.get(name);
      if (hash !== undefined) return hash;
    }
    const created = new Map<string, PerlScalar>();
    this.globals.hashes.set(name, created);
    return created;
  }

  private checkArraySize(array: readonly PerlScalar[]): void {
    if (array.length > linuxPerlLimits.maximumArrayElements) {
      throw new PerlFatalError("array element limit exceeded");
    }
  }

  private checkHashSize(hash: ReadonlyMap<string, PerlScalar>): void {
    if (hash.size > linuxPerlLimits.maximumHashEntries) {
      throw new PerlFatalError("hash entry limit exceeded");
    }
  }

  // ------------------------------------------------------------ statements

  private hoistSubroutines(block: PerlBlock): void {
    for (const statement of block.statements) {
      if (statement.kind === "sub")
        this.subs.set(statement.name, statement.body);
    }
  }

  private executeBlock(block: PerlBlock): void {
    this.pushScope();
    try {
      this.executeBlockInPlace(block);
    } finally {
      this.popScope();
    }
  }

  private executeBlockInPlace(block: PerlBlock): void {
    for (const statement of block.statements) this.executeStatement(statement);
  }

  /**
   * Runs a block in the current scope and yields the value of the last
   * statement it evaluated, which is what an `eval` block and a subroutine
   * without an explicit `return` both hand back.
   */
  private executeBlockValue(block: PerlBlock): PerlValue {
    let result: PerlValue = emptyList;
    for (const statement of block.statements) {
      if (statement.kind === "expression") {
        this.consumeStep();
        if (statement.line !== undefined) this.currentLine = statement.line;
        result = this.evaluate(statement.expression);
      } else {
        this.executeStatement(statement);
        result = emptyList;
      }
    }
    return result;
  }

  private executeStatement(statement: PerlStatement): void {
    this.consumeStep();
    if (statement.line !== undefined) this.currentLine = statement.line;
    switch (statement.kind) {
      case "expression":
        this.evaluate(statement.expression);
        return;
      case "pragma":
        return;
      case "sub":
        this.subs.set(statement.name, statement.body);
        return;
      case "block":
        this.executeLoopBody(statement.body, true);
        return;
      case "if": {
        for (const branch of statement.branches) {
          if (isTrue(toScalar(this.evaluateCondition(branch.condition)))) {
            this.executeBlock(branch.body);
            return;
          }
        }
        if (statement.otherwise !== undefined)
          this.executeBlock(statement.otherwise);
        return;
      }
      case "while": {
        for (;;) {
          if (
            !isTrue(toScalar(this.evaluateCondition(statement.condition, true)))
          )
            return;
          if (!this.executeLoopBody(statement.body, false, statement.label))
            return;
        }
      }
      case "cFor": {
        this.pushScope();
        try {
          if (statement.initializer !== undefined)
            this.evaluate(statement.initializer);
          for (;;) {
            if (
              statement.condition !== undefined &&
              !isTrue(
                toScalar(this.evaluateCondition(statement.condition, true)),
              )
            ) {
              return;
            }
            if (!this.executeLoopBody(statement.body, false, statement.label))
              return;
            if (statement.step !== undefined) this.evaluate(statement.step);
          }
        } finally {
          this.popScope();
        }
      }
      case "foreach":
        this.executeForeach(statement);
        return;
      case "return":
        throw new PerlReturnSignal(
          statement.value === undefined
            ? emptyList
            : this.evaluate(statement.value),
        );
      case "last":
      case "next":
        throw new PerlLoopSignal(statement.kind, statement.label);
      default:
        throw new PerlFatalError("unsupported statement");
    }
  }

  /** Applies Perl's implicit `defined` around `while (my $line = <FH>)`. */
  private evaluateCondition(
    condition: PerlExpression,
    looping = false,
  ): PerlValue {
    if (
      condition.kind === "assign" &&
      condition.operator === "=" &&
      condition.value.kind === "readline"
    ) {
      const value = this.evaluate(condition);
      return booleanValue(toScalar(value) !== undefined);
    }
    // A bare `while (<FH>)` reads into `$_`, which an `if` does not do.
    if (looping && condition.kind === "readline") {
      const line = toScalar(this.evaluate(condition));
      this.setScalar("_", line);
      return booleanValue(line !== undefined);
    }
    return this.evaluateInScalarContext(condition);
  }

  /**
   * Evaluates one node in scalar context. Only `m//g` observes the difference:
   * a scalar-context global match advances its own position and reports one
   * match at a time, which is what makes `while (/x/g)` terminate.
   */
  private evaluateInScalarContext(node: PerlExpression): PerlValue {
    if (
      node.kind !== "match" ||
      node.negated ||
      !node.regex.flags.includes("g")
    ) {
      return this.evaluate(node);
    }
    const subject = toText(toScalar(this.evaluate(node.target)));
    const regex = this.compileLiteral(node.regex);
    const previous = this.matchCursors.get(node);
    const start =
      previous !== undefined && previous.subject === subject
        ? previous.cursor
        : 0;
    const match =
      start > subject.length
        ? undefined
        : matchPerlRegex(regex, subject, start);
    if (match === undefined) {
      this.matchCursors.delete(node);
      return falseValue;
    }
    this.setCaptures(match, subject);
    this.matchCursors.set(node, {
      cursor: match.end > match.start ? match.end : match.end + 1,
      subject,
    });
    return trueValue;
  }

  /** Returns `false` when the loop must stop because of `last`. */
  private executeLoopBody(
    body: PerlBlock,
    bare: boolean,
    label?: string,
  ): boolean {
    this.pushScope();
    try {
      this.executeBlockInPlace(body);
    } catch (error) {
      if (error instanceof PerlLoopSignal && error.targets(label)) {
        if (error.action === "last") return false;
        return !bare;
      }
      throw error;
    } finally {
      this.popScope();
    }
    return !bare;
  }

  private executeForeach(statement: PerlStatement & { kind: "foreach" }): void {
    const aliasArray =
      statement.list.kind === "array"
        ? this.getArray(statement.list.name)
        : undefined;
    const items = aliasArray ?? [
      ...toList(this.evaluateInListContext(statement.list)),
    ];
    const name = statement.variable ?? "_";
    this.pushScope();
    try {
      if (statement.declared || statement.variable === undefined) {
        this.scope.scalars.set(name, undefined);
      }
      const previous =
        statement.declared || statement.variable === undefined
          ? undefined
          : this.getScalar(name);
      for (let index = 0; index < items.length; index += 1) {
        this.consumeStep();
        this.setScalar(name, items[index]);
        let stop = false;
        try {
          this.executeBlockInPlace(statement.body);
        } catch (error) {
          if (
            error instanceof PerlLoopSignal &&
            error.targets(statement.label)
          ) {
            if (error.action === "last") stop = true;
          } else {
            if (aliasArray !== undefined)
              aliasArray[index] = this.getScalar(name);
            throw error;
          }
        }
        if (aliasArray !== undefined) aliasArray[index] = this.getScalar(name);
        if (stop) break;
      }
      if (!statement.declared && statement.variable !== undefined) {
        this.setScalar(name, previous);
      }
    } finally {
      this.popScope();
    }
  }

  // ----------------------------------------------------------- expressions

  private consumeStep(): void {
    this.steps += 1;
    if (this.steps > linuxPerlLimits.maximumSteps) {
      throw new PerlFatalError("execution step limit exceeded");
    }
  }

  private evaluate(expression: PerlExpression): PerlValue {
    this.consumeStep();
    switch (expression.kind) {
      case "number":
        return scalarValue(expression.value);
      case "string":
        return scalarValue(expression.value);
      case "concat": {
        let text = "";
        for (const part of expression.parts) {
          text += toText(toScalar(this.evaluate(part)));
        }
        this.checkScalarSize(text);
        return scalarValue(text);
      }
      case "undefined":
        return scalarValue(undefined);
      case "undefine": {
        const target = expression.target;
        if (target.kind === "array") this.getArray(target.name).length = 0;
        else if (target.kind === "hash") this.getHash(target.name).clear();
        else this.writeLvalue(this.resolveLvalue(target, false), undefined);
        return scalarValue(undefined);
      }
      case "scalar":
        return scalarValue(this.getScalar(expression.name));
      case "array":
        return aggregateValue(this.getArray(expression.name));
      case "hash":
        return aggregateValue(flattenHash(this.getHash(expression.name)));
      case "lastIndex":
        return scalarValue(this.getArray(expression.name).length - 1);
      case "element": {
        if (expression.container === "array") {
          const array = this.getArray(expression.name);
          const index = normalizeIndex(
            toNumber(toScalar(this.evaluate(expression.index))),
            array.length,
          );
          return scalarValue(index === undefined ? undefined : array[index]);
        }
        const hash = this.getHash(expression.name);
        return scalarValue(
          hash.get(toText(toScalar(this.evaluate(expression.index)))),
        );
      }
      case "slice": {
        const keys = toList(this.evaluate(expression.keys));
        if (expression.container === "array") {
          const array = this.getArray(expression.name);
          return listValue(
            keys.map((key) => {
              const index = normalizeIndex(toNumber(key), array.length);
              return index === undefined ? undefined : array[index];
            }),
          );
        }
        const hash = this.getHash(expression.name);
        return listValue(keys.map((key) => hash.get(toText(key))));
      }
      case "list": {
        const items: PerlScalar[] = [];
        for (const item of expression.items)
          items.push(...toList(this.evaluate(item)));
        this.checkArraySize(items);
        return listValue(items);
      }
      case "range": {
        const from = toNumber(toScalar(this.evaluate(expression.from)));
        const to = toNumber(toScalar(this.evaluate(expression.to)));
        const count = Math.floor(to) - Math.floor(from) + 1;
        if (count <= 0) return emptyList;
        if (count > linuxPerlLimits.maximumArrayElements) {
          throw new PerlFatalError("range element limit exceeded");
        }
        const items: PerlScalar[] = [];
        for (
          let value = Math.floor(from);
          value <= Math.floor(to);
          value += 1
        ) {
          items.push(value);
        }
        return listValue(items);
      }
      case "declaration": {
        this.declare(expression.targets);
        if (
          expression.targets.length === 1 &&
          expression.targets[0]!.sigil === "$"
        ) {
          return scalarValue(undefined);
        }
        return emptyList;
      }
      case "unary":
        return this.evaluateUnary(expression);
      case "binary":
        return this.evaluateBinary(expression);
      case "logical": {
        const left = this.evaluate(expression.left);
        const leftScalar = toScalar(left);
        if (expression.operator === "&&") {
          return isTrue(leftScalar) ? this.evaluate(expression.right) : left;
        }
        if (expression.operator === "||") {
          return isTrue(leftScalar) ? left : this.evaluate(expression.right);
        }
        return leftScalar === undefined
          ? this.evaluate(expression.right)
          : left;
      }
      case "assign":
        return this.evaluateAssign(expression);
      case "ternary":
        return isTrue(toScalar(this.evaluate(expression.condition)))
          ? this.evaluate(expression.whenTrue)
          : this.evaluate(expression.whenFalse);
      case "step": {
        const lvalue = this.resolveLvalue(expression.target, false);
        const current = this.readLvalue(lvalue);
        const isMagicIncrement =
          expression.by === 1 &&
          typeof current === "string" &&
          current.length > 0 &&
          !isNumericText(current);
        const next = isMagicIncrement
          ? magicIncrement(current)
          : toNumber(current) + expression.by;
        this.writeLvalue(lvalue, next);
        return scalarValue(expression.prefix ? next : (current ?? 0));
      }
      case "output":
        return this.evaluateOutput(expression);
      case "call":
        return this.evaluateCall(expression);
      case "match":
        return this.evaluateMatch(expression);
      case "substitute":
        return this.evaluateSubstitute(expression);
      case "transliterate":
        return this.evaluateTransliterate(expression);
      case "readline":
        return this.evaluateReadline(expression);
      case "fileTest":
        return this.evaluateFileTest(expression);
      case "evalBlock": {
        const savedError = this.evalError;
        try {
          this.pushScope();
          let value: PerlValue;
          try {
            value = this.executeBlockValue(expression.body);
          } finally {
            this.popScope();
          }
          this.evalError = "";
          return value;
        } catch (error) {
          if (error instanceof PerlDieError) {
            this.evalError = error.text;
            return emptyList;
          }
          this.evalError = savedError;
          throw error;
        }
      }
      default:
        throw new PerlFatalError("unsupported expression");
    }
  }

  private evaluateUnary(
    expression: PerlExpression & { kind: "unary" },
  ): PerlValue {
    const value = this.evaluate(expression.operand);
    if (expression.operator === "!")
      return booleanValue(!isTrue(toScalar(value)));
    if (expression.operator === "-")
      return scalarValue(-toNumber(toScalar(value)));
    if (expression.operator === "~")
      return scalarValue(bitResult(~toBitInteger(toScalar(value))));
    return scalarValue(toNumber(toScalar(value)));
  }

  private evaluateBinary(
    expression: PerlExpression & { kind: "binary" },
  ): PerlValue {
    const operator = expression.operator;
    if (operator === "x") {
      const count = Math.max(
        0,
        Math.floor(toNumber(toScalar(this.evaluate(expression.right)))),
      );
      if (expression.left.kind === "list") {
        const source = toList(this.evaluate(expression.left));
        if (source.length * count > linuxPerlLimits.maximumArrayElements) {
          throw new PerlFatalError("list repetition limit exceeded");
        }
        const items: PerlScalar[] = [];
        for (let index = 0; index < count; index += 1) items.push(...source);
        return listValue(items);
      }
      const text = toText(toScalar(this.evaluate(expression.left)));
      if (text.length * count > linuxPerlLimits.maximumScalarCharacters) {
        throw new PerlFatalError("scalar character limit exceeded");
      }
      return scalarValue(text.repeat(count));
    }
    const left = toScalar(this.evaluate(expression.left));
    const right = toScalar(this.evaluate(expression.right));
    switch (operator) {
      case "+":
        return scalarValue(toNumber(left) + toNumber(right));
      case "-":
        return scalarValue(toNumber(left) - toNumber(right));
      case "*":
        return scalarValue(toNumber(left) * toNumber(right));
      case "/": {
        const divisor = toNumber(right);
        if (divisor === 0)
          throw new PerlDieError(this.dieText("Illegal division by zero"));
        return scalarValue(toNumber(left) / divisor);
      }
      case "%": {
        const divisor = Math.trunc(toNumber(right));
        if (divisor === 0) {
          throw new PerlDieError(this.dieText("Illegal modulus zero"));
        }
        const dividend = Math.trunc(toNumber(left));
        return scalarValue(((dividend % divisor) + divisor) % divisor);
      }
      case "**":
        return scalarValue(toNumber(left) ** toNumber(right));
      case ".": {
        const text = `${toText(left)}${toText(right)}`;
        this.checkScalarSize(text);
        return scalarValue(text);
      }
      case "==":
        return booleanValue(toNumber(left) === toNumber(right));
      case "!=":
        return booleanValue(toNumber(left) !== toNumber(right));
      case "<":
        return booleanValue(toNumber(left) < toNumber(right));
      case ">":
        return booleanValue(toNumber(left) > toNumber(right));
      case "<=":
        return booleanValue(toNumber(left) <= toNumber(right));
      case ">=":
        return booleanValue(toNumber(left) >= toNumber(right));
      case "<=>":
        return scalarValue(compareNumbers(toNumber(left), toNumber(right)));
      case "eq":
        return booleanValue(toText(left) === toText(right));
      case "ne":
        return booleanValue(toText(left) !== toText(right));
      case "lt":
        return booleanValue(toText(left) < toText(right));
      case "gt":
        return booleanValue(toText(left) > toText(right));
      case "le":
        return booleanValue(toText(left) <= toText(right));
      case "ge":
        return booleanValue(toText(left) >= toText(right));
      case "cmp":
        return scalarValue(compareText(toText(left), toText(right)));
      case "&":
        return scalarValue(bitResult(toBitInteger(left) & toBitInteger(right)));
      case "|":
        return scalarValue(bitResult(toBitInteger(left) | toBitInteger(right)));
      case "^":
        return scalarValue(bitResult(toBitInteger(left) ^ toBitInteger(right)));
      case "<<":
        return scalarValue(shiftBits(left, right, "left"));
      case ">>":
        return scalarValue(shiftBits(left, right, "right"));
      case "xor":
        return booleanValue(isTrue(left) !== isTrue(right));
      default:
        throw new PerlFatalError(`unsupported operator ${operator}`);
    }
  }

  private evaluateAssign(
    expression: PerlExpression & { kind: "assign" },
  ): PerlValue {
    if (expression.operator === "=") {
      const lvalue = this.resolveLvalue(expression.target, true);
      const value = imposesListContext(lvalue)
        ? this.evaluateInListContext(expression.value)
        : this.evaluate(expression.value);
      return this.assign(lvalue, value);
    }
    const lvalue = this.resolveLvalue(expression.target, false);
    const current = this.readLvalue(lvalue);
    const shortCircuit = expression.operator.slice(0, 2);
    if (shortCircuit === "||" && isTrue(current)) return scalarValue(current);
    if (shortCircuit === "&&" && !isTrue(current)) return scalarValue(current);
    if (shortCircuit === "//" && current !== undefined)
      return scalarValue(current);
    const right = this.evaluate(expression.value);
    if (
      shortCircuit === "||" ||
      shortCircuit === "&&" ||
      shortCircuit === "//"
    ) {
      const value = toScalar(right);
      this.writeLvalue(lvalue, value);
      return scalarValue(value);
    }
    const result = this.applyBinaryScalar(
      expression.operator.slice(0, -1),
      current,
      toScalar(right),
    );
    this.writeLvalue(lvalue, result);
    return scalarValue(result);
  }

  private applyBinaryScalar(
    operator: string,
    left: PerlScalar,
    right: PerlScalar,
  ): PerlScalar {
    return toScalar(
      this.evaluateBinary({
        kind: "binary",
        left: literalExpression(left),
        operator,
        right: literalExpression(right),
      }),
    );
  }

  private declare(
    targets: readonly { readonly name: string; readonly sigil: string }[],
  ): void {
    for (const target of targets) {
      if (target.sigil === "$") this.scope.scalars.set(target.name, undefined);
      else if (target.sigil === "@") this.scope.arrays.set(target.name, []);
      else this.scope.hashes.set(target.name, new Map());
    }
  }

  private resolveLvalue(
    expression: PerlExpression,
    declaring: boolean,
  ): PerlLvalue {
    switch (expression.kind) {
      case "declaration": {
        this.declare(expression.targets);
        const targets: PerlLvalue[] = expression.targets.map((target) =>
          target.sigil === "$"
            ? { kind: "scalar", name: target.name }
            : target.sigil === "@"
              ? { kind: "array", name: target.name }
              : { kind: "hash", name: target.name },
        );
        // `my $x = <FH>` is a scalar assignment, while the parenthesized
        // `my ($x) = <FH>` is a list assignment that yields the first line.
        return targets.length === 1 && !expression.parenthesized
          ? targets[0]!
          : { kind: "list", targets };
      }
      case "scalar":
        return { kind: "scalar", name: expression.name };
      case "lastIndex":
        return { kind: "arrayLastIndex", name: expression.name };
      case "array":
        return { kind: "array", name: expression.name };
      case "hash":
        return { kind: "hash", name: expression.name };
      case "element":
        return this.resolveElement(
          expression.container,
          expression.name,
          toScalar(this.evaluate(expression.index)),
        );
      case "slice": {
        // `@a[0,1] = ...` and `@h{qw(a b)} = ...` bind one element lvalue per
        // key, which also makes the right side a list assignment.
        const keys = toList(this.evaluate(expression.keys));
        return {
          kind: "list",
          targets: keys.map((key) =>
            this.resolveElement(expression.container, expression.name, key),
          ),
        };
      }
      case "list":
        return {
          kind: "list",
          targets: expression.items.map((item) =>
            this.resolveLvalue(item, declaring),
          ),
        };
      case "assign": {
        // `(my $copy = $text) =~ s/a/b/` binds to the already assigned variable.
        this.evaluate(expression);
        const target = expression.target;
        if (target.kind === "declaration") {
          const declared = target.targets[0];
          if (target.targets.length === 1 && declared?.sigil === "$") {
            return { kind: "scalar", name: declared.name };
          }
        }
        return this.resolveLvalue(target, false);
      }
      case "call":
        if (expression.name === "substr")
          return this.resolveSubstring(expression);
        break;
      default:
        break;
    }
    throw new PerlFatalError("invalid assignment target");
  }

  /** Binds the `substr($s, ...)` window so an assignment can splice into it. */
  private resolveSubstring(
    expression: PerlExpression & { kind: "call" },
  ): PerlLvalue {
    const nodes = expression.arguments;
    const target = this.resolveLvalue(
      this.requireArgument(nodes, "substr"),
      false,
    );
    const text = toText(this.readLvalue(target));
    const rawOffset = Math.trunc(
      toNumber(
        toScalar(this.evaluate(this.requireArgument(nodes, "substr", 1))),
      ),
    );
    const start = Math.min(
      text.length,
      rawOffset < 0 ? Math.max(0, text.length + rawOffset) : rawOffset,
    );
    if (nodes.length <= 2) {
      return { kind: "substring", start, stop: text.length, target };
    }
    const length = Math.trunc(toNumber(toScalar(this.evaluate(nodes[2]!))));
    const end = length < 0 ? text.length + length : start + length;
    return {
      kind: "substring",
      start,
      stop: Math.max(start, Math.min(text.length, end)),
      target,
    };
  }

  /** Binds one array or hash element from an already evaluated key. */
  private resolveElement(
    container: "array" | "hash",
    name: string,
    key: PerlScalar,
  ): PerlLvalue {
    if (container === "hash") {
      return {
        hash: this.getHash(name),
        key: toText(key),
        kind: "hashElement",
      };
    }
    const array = this.getArray(name);
    const raw = Math.trunc(toNumber(key));
    const index = raw < 0 ? array.length + raw : raw;
    if (index < 0) throw new PerlFatalError("negative array index");
    if (index >= linuxPerlLimits.maximumArrayElements) {
      throw new PerlFatalError("array element limit exceeded");
    }
    while (array.length <= index) array.push(undefined);
    return { array, index, kind: "arrayElement" };
  }

  private readLvalue(lvalue: PerlLvalue): PerlScalar {
    switch (lvalue.kind) {
      case "scalar":
        return this.getScalar(lvalue.name);
      case "arrayElement":
        return lvalue.array[lvalue.index];
      case "hashElement":
        return lvalue.hash.get(lvalue.key);
      case "array":
        return this.getArray(lvalue.name).length;
      case "arrayLastIndex":
        return this.getArray(lvalue.name).length - 1;
      case "substring":
        return toText(this.readLvalue(lvalue.target)).slice(
          lvalue.start,
          lvalue.stop,
        );
      case "hash":
        return this.getHash(lvalue.name).size;
      default:
        throw new PerlFatalError("invalid assignment target");
    }
  }

  private writeLvalue(lvalue: PerlLvalue, value: PerlScalar): void {
    switch (lvalue.kind) {
      case "scalar":
        this.setScalar(lvalue.name, value);
        return;
      case "arrayElement":
        this.checkScalarSize(value);
        lvalue.array[lvalue.index] = value;
        return;
      case "hashElement":
        this.checkScalarSize(value);
        lvalue.hash.set(lvalue.key, value);
        this.checkHashSize(lvalue.hash);
        return;
      case "substring": {
        // `substr($s, 0, 1) = "J"` splices through to the underlying scalar.
        const text = toText(this.readLvalue(lvalue.target));
        const spliced =
          text.slice(0, lvalue.start) + toText(value) + text.slice(lvalue.stop);
        this.checkScalarSize(spliced);
        this.writeLvalue(lvalue.target, spliced);
        return;
      }
      case "arrayLastIndex": {
        // `$#a = N` resizes the array, truncating or padding it with undef.
        const length = Math.trunc(toNumber(value)) + 1;
        if (length < 0) throw new PerlFatalError("negative array length");
        if (length > linuxPerlLimits.maximumArrayElements) {
          throw new PerlFatalError("array element limit exceeded");
        }
        const array = this.getArray(lvalue.name);
        while (array.length < length) array.push(undefined);
        array.length = length;
        return;
      }
      default:
        throw new PerlFatalError("invalid assignment target");
    }
  }

  private assign(lvalue: PerlLvalue, value: PerlValue): PerlValue {
    switch (lvalue.kind) {
      case "scalar":
      case "arrayElement":
      case "arrayLastIndex":
      case "hashElement":
      case "substring": {
        const scalar = toScalar(value);
        this.writeLvalue(lvalue, scalar);
        return scalarValue(scalar);
      }
      case "array": {
        const items = [...toList(value)];
        this.checkArraySize(items);
        for (const item of items) this.checkScalarSize(item);
        const array = this.getArray(lvalue.name);
        array.length = 0;
        array.push(...items);
        return aggregateValue(items);
      }
      case "hash": {
        const items = toList(value);
        const hash = this.getHash(lvalue.name);
        hash.clear();
        for (let index = 0; index < items.length; index += 2) {
          hash.set(toText(items[index]), items[index + 1]);
        }
        this.checkHashSize(hash);
        return aggregateValue(items);
      }
      case "list": {
        const items = toList(value);
        let cursor = 0;
        for (const target of lvalue.targets) {
          if (target.kind === "array") {
            this.assign(target, listValue(items.slice(cursor)));
            cursor = items.length;
            continue;
          }
          if (target.kind === "hash") {
            this.assign(target, listValue(items.slice(cursor)));
            cursor = items.length;
            continue;
          }
          this.writeLvalue(target, items[cursor]);
          cursor += 1;
        }
        return aggregateValue(items);
      }
      default:
        throw new PerlFatalError("invalid assignment target");
    }
  }

  // ---------------------------------------------------------------- output

  private evaluateOutput(
    expression: PerlExpression & { kind: "output" },
  ): PerlValue {
    const parts = expression.arguments.flatMap((argument) => [
      ...toList(this.evaluate(argument)),
    ]);
    let text: string;
    if (expression.name === "printf") {
      const format = toText(parts[0]);
      text = formatPerl(format, parts.slice(1));
    } else {
      text =
        parts.length === 0
          ? toText(this.getScalar("_"))
          : parts.map((part) => toText(part)).join("");
      if (expression.name === "say") text += "\n";
      else if (this.options.lineEnding && expression.name === "print")
        text += "\n";
    }
    const handleName =
      expression.handle === undefined
        ? "STDOUT"
        : toText(toScalar(this.evaluate(expression.handle)));
    this.writeTo(handleName, text);
    return trueValue;
  }

  private writeTo(handleName: string, text: string): void {
    if (handleName === "STDOUT") {
      this.writeOutput(text);
      return;
    }
    if (handleName === "STDERR") {
      this.writeError(text);
      return;
    }
    const handle = this.handles.get(handleName);
    if (handle === undefined || handle.closed) {
      throw new PerlDieError(
        this.dieText("print() on unopened or closed filehandle"),
      );
    }
    if (handle.mode === "<") {
      throw new PerlDieError(
        this.dieText(`Filehandle opened only for input at ${handle.path}`),
      );
    }
    // Admit the bytes before appending so a rejected write leaves the stream
    // exactly at its bound instead of one record past it.
    const bytes = handle.bufferBytes + utf8ByteLength(text);
    if (bytes > linuxPerlLimits.maximumOutputBytes) {
      throw new PerlFatalError("file output byte limit exceeded");
    }
    handle.buffer += text;
    handle.bufferBytes = bytes;
  }

  private writeOutput(text: string): void {
    const bytes = this.stdoutBytes + utf8ByteLength(text);
    if (bytes > linuxPerlLimits.maximumOutputBytes) {
      throw new PerlFatalError("output byte limit exceeded");
    }
    this.stdout += text;
    this.stdoutBytes = bytes;
  }

  private writeError(text: string): void {
    const bytes = this.stderrBytes + utf8ByteLength(text);
    if (bytes > linuxPerlLimits.maximumOutputBytes) {
      throw new PerlFatalError("diagnostic byte limit exceeded");
    }
    this.stderr += text;
    this.stderrBytes = bytes;
  }

  private dieText(message: string): string {
    return `${message} at ${this.options.programName} line ${String(this.currentLine)}.\n`;
  }

  // ------------------------------------------------------------- filehandles

  /**
   * Evaluates one node in list context. Only `<FH>` observes the difference:
   * a list-context read drains every remaining record instead of one line.
   */
  private evaluateInListContext(node: PerlExpression): PerlValue {
    if (node.kind === "readline") return this.drainReadline(node);
    if (node.kind !== "list") return this.evaluate(node);
    const items = node.items.flatMap((item) => [
      ...toList(this.evaluateInListContext(item)),
    ]);
    return listValue(items);
  }

  /** Reads every remaining record of one source under the array bound. */
  private drainReadline(
    expression: PerlExpression & { kind: "readline" },
  ): PerlValue {
    const lines: PerlScalar[] = [];
    for (;;) {
      this.consumeStep();
      const line = toScalar(this.evaluateReadline(expression));
      if (line === undefined) return listValue(lines);
      lines.push(line);
      if (lines.length > linuxPerlLimits.maximumArrayElements) {
        throw new PerlFatalError("array element limit exceeded");
      }
    }
  }

  private evaluateReadline(
    expression: PerlExpression & { kind: "readline" },
  ): PerlValue {
    if (expression.source === "stdin") return scalarValue(this.readStdinLine());
    if (expression.source === "argv")
      return scalarValue(this.readAnyInputLine());
    const name = toText(toScalar(this.evaluate(expression.handle!)));
    const handle = this.handles.get(name);
    if (handle === undefined || handle.closed) {
      throw new PerlDieError(
        this.dieText("readline() on unopened or closed filehandle"),
      );
    }
    if (handle.mode !== "<") {
      throw new PerlDieError(
        this.dieText(`Filehandle opened only for output at ${handle.path}`),
      );
    }
    if (handle.cursor >= handle.lines.length) return scalarValue(undefined);
    const line = handle.lines[handle.cursor]!;
    handle.cursor += 1;
    this.recordNumber += 1;
    return scalarValue(line);
  }

  private readStdinLine(): PerlScalar {
    if (this.stdinCursor >= this.stdinLines.length) return undefined;
    const line = this.stdinLines[this.stdinCursor]!;
    this.stdinCursor += 1;
    this.recordNumber += 1;
    return line;
  }

  /** Implements `<>`: named `@ARGV` files first, then standard input. */
  private readAnyInputLine(): string | undefined {
    if (this.argv.length === 0) {
      const line = this.readStdinLine();
      return line === undefined ? undefined : toText(line);
    }
    for (;;) {
      const active = this.handles.get("ARGV");
      if (active !== undefined && active.cursor < active.lines.length) {
        const line = active.lines[active.cursor]!;
        active.cursor += 1;
        this.recordNumber += 1;
        return line;
      }
      const next = this.argv.shift();
      if (next === undefined) return undefined;
      const path = toText(next);
      let contents: string;
      try {
        contents = this.io.readFile(path);
      } catch (error) {
        this.writeError(`perl: Can't open ${path}: ${describe(error)}\n`);
        continue;
      }
      this.handles.set("ARGV", {
        buffer: "",
        bufferBytes: 0,
        closed: false,
        cursor: 0,
        lines: splitLines(contents),
        mode: "<",
        path,
      });
    }
  }

  private openHandle(
    target: PerlExpression,
    mode: string,
    path: string,
  ): PerlValue {
    if (this.handles.size >= linuxPerlLimits.maximumHandles) {
      throw new PerlFatalError("open filehandle limit exceeded");
    }
    const normalized = mode.trim();
    if (normalized !== "<" && normalized !== ">" && normalized !== ">>") {
      throw new PerlDieError(this.dieText(`Unsupported open mode '${mode}'`));
    }
    let lines: readonly string[] = [];
    if (normalized === "<") {
      try {
        lines = splitLines(this.io.readFile(path));
      } catch (error) {
        this.lastError = stripPath(describe(error), path);
        return falseValue;
      }
    } else if (normalized === ">>" && this.io.pathExists(path)) {
      // Existing content stays on disk; the buffer only holds appended text.
    }
    this.handleSequence += 1;
    const name = `*CSPERL::FH${String(this.handleSequence)}`;
    this.handles.set(name, {
      buffer: "",
      bufferBytes: 0,
      closed: false,
      cursor: 0,
      lines,
      mode: normalized,
      path,
    });
    const lvalue = this.resolveLvalue(target, true);
    this.assign(lvalue, scalarValue(name));
    return trueValue;
  }

  private closeHandle(name: string): PerlValue {
    const handle = this.handles.get(name);
    if (handle === undefined || handle.closed) return falseValue;
    this.flushHandle(handle);
    handle.closed = true;
    this.handles.delete(name);
    return trueValue;
  }

  private flushHandles(): void {
    for (const handle of this.handles.values()) {
      if (!handle.closed) this.flushHandle(handle);
      handle.closed = true;
    }
    this.handles.clear();
  }

  private flushHandle(handle: PerlHandle): void {
    if (handle.mode === "<") return;
    try {
      this.io.writeFile(handle.path, handle.buffer, handle.mode === ">>");
    } catch (error) {
      this.writeError(`perl: ${describe(error)}\n`);
    }
    handle.buffer = "";
  }

  private evaluateFileTest(
    expression: PerlExpression & { kind: "fileTest" },
  ): PerlValue {
    const path = toText(toScalar(this.evaluate(expression.path)));
    const exists = this.io.pathExists(path);
    switch (expression.operator) {
      case "e":
        return booleanValue(exists);
      case "d":
        return booleanValue(exists && (this.io.isDirectory?.(path) ?? false));
      case "f":
        return booleanValue(exists && !(this.io.isDirectory?.(path) ?? false));
      case "s":
      case "z": {
        if (!exists) return falseValue;
        let size = 0;
        try {
          size = utf8ByteLength(this.io.readFile(path));
        } catch {
          return falseValue;
        }
        return expression.operator === "s"
          ? size > 0
            ? scalarValue(size)
            : falseValue
          : booleanValue(size === 0);
      }
      default:
        return falseValue;
    }
  }

  // ----------------------------------------------------------- regex support

  private compile(pattern: string, flags: string): PerlRegex {
    const key = `${flags}\u0000${pattern}`;
    const cached = this.regexCache.get(key);
    if (cached !== undefined) return cached;
    let compiled: PerlRegex;
    try {
      compiled = compilePerlRegex(pattern, flags.replaceAll(/[ge]/gu, ""));
    } catch (error) {
      if (error instanceof PerlRegexError) {
        throw new PerlDieError(this.dieText(error.message));
      }
      throw error;
    }
    if (this.regexCache.size >= linuxPerlLimits.maximumRegexCache) {
      this.regexCache.clear();
    }
    this.regexCache.set(key, compiled);
    return compiled;
  }

  private compileLiteral(literal: PerlRegexLiteral): PerlRegex {
    return this.compile(
      toText(toScalar(this.evaluate(literal.pattern))),
      literal.flags,
    );
  }

  private setCaptures(match: PerlRegexMatch, subject: string): void {
    this.captures = match.captures;
    // Keep the span rather than three copies of the subject so a global
    // substitution over a long string stays linear.
    this.lastMatch = { end: match.end, start: match.start, subject };
  }

  private evaluateMatch(
    expression: PerlExpression & { kind: "match" },
  ): PerlValue {
    const subject = toText(toScalar(this.evaluate(expression.target)));
    const regex = this.compileLiteral(expression.regex);
    const global = expression.regex.flags.includes("g");
    if (global && !expression.negated) {
      const found: PerlScalar[] = [];
      let cursor = 0;
      for (;;) {
        this.consumeStep();
        const match = matchPerlRegex(regex, subject, cursor);
        if (match === undefined) break;
        this.setCaptures(match, subject);
        if (regex.captureCount === 0) found.push(match.captures[0]);
        else found.push(...match.captures.slice(1));
        cursor = match.end > match.start ? match.end : match.end + 1;
        if (found.length > linuxPerlLimits.maximumArrayElements) {
          throw new PerlFatalError("match result limit exceeded");
        }
      }
      return listValue(found);
    }
    const match = matchPerlRegex(regex, subject, 0);
    if (match !== undefined) this.setCaptures(match, subject);
    if (expression.negated) return booleanValue(match === undefined);
    if (match === undefined) return falseValue;
    if (regex.captureCount === 0) return trueValue;
    return listValue(match.captures.slice(1));
  }

  private evaluateSubstitute(
    expression: PerlExpression & { kind: "substitute" },
  ): PerlValue {
    // `/r` leaves the subject alone and yields the rewritten copy instead.
    const lvalue = expression.returning
      ? undefined
      : this.resolveLvalue(expression.target, false);
    const subject = toText(
      lvalue === undefined
        ? toScalar(this.evaluate(expression.target))
        : this.readLvalue(lvalue),
    );
    const regex = this.compileLiteral(expression.regex);
    const global = expression.regex.flags.includes("g");
    let output = "";
    let cursor = 0;
    let count = 0;
    for (;;) {
      this.consumeStep();
      const match = matchPerlRegex(regex, subject, cursor);
      if (match === undefined) break;
      this.setCaptures(match, subject);
      output += subject.slice(cursor, match.start);
      output += toText(toScalar(this.evaluate(expression.replacement)));
      count += 1;
      if (match.end > match.start) {
        cursor = match.end;
      } else {
        if (match.start < subject.length) output += subject[match.start]!;
        cursor = match.start + 1;
      }
      if (!global || cursor > subject.length) break;
    }
    if (count === 0)
      return lvalue === undefined ? scalarValue(subject) : falseValue;
    output += subject.slice(Math.min(cursor, subject.length));
    this.checkScalarSize(output);
    if (lvalue === undefined) return scalarValue(output);
    this.writeLvalue(lvalue, output);
    return scalarValue(count);
  }

  private evaluateTransliterate(
    expression: PerlExpression & { kind: "transliterate" },
  ): PerlValue {
    // `/r` returns a new string, so it reads any expression; every other form
    // writes back and therefore needs a real assignment target.
    const returning = expression.modifiers.includes("r");
    const lvalue = returning
      ? undefined
      : this.resolveLvalue(expression.target, false);
    const subject = toText(
      lvalue === undefined
        ? toScalar(this.evaluate(expression.target))
        : this.readLvalue(lvalue),
    );
    const from = expandTransliterationSet(expression.from);
    const to = expandTransliterationSet(expression.to);
    if (expression.modifiers.replaceAll(/[cdrs]/gu, "").length > 0) {
      throw new PerlDieError(
        this.dieText(`Unsupported tr modifier '${expression.modifiers}'`),
      );
    }
    const complementing = expression.modifiers.includes("c");
    const deleting = expression.modifiers.includes("d");
    const squashing = expression.modifiers.includes("s");
    const searched = new Set(
      from.map((character) => character.codePointAt(0) ?? 0),
    );
    const ordered = [...searched].sort((left, right) => left - right);
    let output = "";
    let count = 0;
    let squashed: string | undefined;
    for (const character of subject) {
      this.consumeStep();
      const codePoint = character.codePointAt(0)!;
      const matched = complementing
        ? !searched.has(codePoint)
        : searched.has(codePoint);
      if (!matched) {
        output += character;
        squashed = undefined;
        continue;
      }
      count += 1;
      const index = complementing
        ? complementRank(codePoint, ordered)
        : from.indexOf(character);
      const replacement =
        to.length === 0
          ? deleting
            ? undefined
            : character
          : index < to.length
            ? to[index]!
            : deleting
              ? undefined
              : to[to.length - 1]!;
      if (replacement === undefined) continue;
      if (squashing && squashed === replacement) continue;
      squashed = replacement;
      output += replacement;
    }
    if (lvalue === undefined) return scalarValue(output);
    this.writeLvalue(lvalue, output);
    return scalarValue(count);
  }

  private splitByRegex(
    regex: PerlRegex,
    subject: string,
    limit: number,
  ): PerlScalar[] {
    const fields: PerlScalar[] = [];
    let cursor = 0;
    while (limit <= 0 || fields.length < limit - 1) {
      this.consumeStep();
      if (cursor > subject.length) break;
      const match = matchPerlRegex(regex, subject, cursor);
      if (match === undefined) break;
      if (match.end === match.start) {
        if (match.start >= subject.length) break;
        fields.push(subject.slice(cursor, match.start + 1));
        cursor = match.start + 1;
        continue;
      }
      fields.push(subject.slice(cursor, match.start));
      if (regex.captureCount > 0) fields.push(...match.captures.slice(1));
      cursor = match.end;
      if (fields.length > linuxPerlLimits.maximumArrayElements) {
        throw new PerlFatalError("split field limit exceeded");
      }
    }
    fields.push(subject.slice(cursor));
    // Only an omitted or zero limit strips trailing empty fields; a negative
    // limit means "unlimited fields, keep the empties".
    if (limit === 0) {
      while (fields.length > 0 && toText(fields[fields.length - 1]) === "") {
        fields.pop();
      }
    }
    return fields;
  }

  // -------------------------------------------------------------- functions

  private evaluateCall(
    expression: PerlExpression & { kind: "call" },
  ): PerlValue {
    const name = expression.name;
    const nodes = expression.arguments;
    switch (name) {
      case "my":
        throw new PerlFatalError("invalid declaration");
      case "defined": {
        if (nodes.length === 0) {
          return booleanValue(this.getScalar("_") !== undefined);
        }
        return booleanValue(toScalar(this.evaluate(nodes[0]!)) !== undefined);
      }
      case "exists": {
        const node = nodes[0];
        if (node?.kind !== "element") {
          throw new PerlDieError(
            this.dieText("exists requires a hash or array element"),
          );
        }
        if (node.container === "hash") {
          return booleanValue(
            this.getHash(node.name).has(
              toText(toScalar(this.evaluate(node.index))),
            ),
          );
        }
        const array = this.getArray(node.name);
        const index = normalizeIndex(
          toNumber(toScalar(this.evaluate(node.index))),
          array.length,
        );
        return booleanValue(index !== undefined && array[index] !== undefined);
      }
      case "delete": {
        const node = nodes[0];
        if (node?.kind !== "element" || node.container !== "hash") {
          throw new PerlDieError(
            this.dieText("delete requires a hash element"),
          );
        }
        const hash = this.getHash(node.name);
        const key = toText(toScalar(this.evaluate(node.index)));
        const value = hash.get(key);
        hash.delete(key);
        return scalarValue(value);
      }
      case "keys":
      case "values": {
        const node = nodes[0];
        if (node?.kind === "hash") {
          const hash = this.getHash(node.name);
          return aggregateValue(
            name === "keys" ? [...hash.keys()] : [...hash.values()],
          );
        }
        if (node?.kind === "array") {
          const array = this.getArray(node.name);
          return aggregateValue(
            name === "keys" ? array.map((_, index) => index) : [...array],
          );
        }
        throw new PerlDieError(
          this.dieText(`${name} requires a hash or array`),
        );
      }
      case "each": {
        const node = nodes[0];
        if (node?.kind !== "hash") {
          throw new PerlDieError(this.dieText("each requires a hash"));
        }
        const hash = this.getHash(node.name);
        const cursor = this.hashIterators.get(hash) ?? 0;
        const entries = [...hash.entries()];
        if (cursor >= entries.length) {
          this.hashIterators.delete(hash);
          return emptyList;
        }
        this.hashIterators.set(hash, cursor + 1);
        const entry = entries[cursor]!;
        return listValue([entry[0], entry[1]]);
      }
      case "push":
      case "unshift": {
        const node = nodes[0];
        if (node?.kind !== "array") {
          throw new PerlDieError(this.dieText(`${name} requires an array`));
        }
        const array = this.getArray(node.name);
        const items = nodes
          .slice(1)
          .flatMap((argument) => [...toList(this.evaluate(argument))]);
        for (const item of items) this.checkScalarSize(item);
        if (name === "push") array.push(...items);
        else array.unshift(...items);
        this.checkArraySize(array);
        return scalarValue(array.length);
      }
      case "pop":
      case "shift": {
        const array = this.defaultArgumentArray(nodes[0]);
        const value = name === "pop" ? array.pop() : array.shift();
        return scalarValue(value);
      }
      case "splice": {
        const node = nodes[0];
        if (node?.kind !== "array") {
          throw new PerlDieError(this.dieText("splice requires an array"));
        }
        const array = this.getArray(node.name);
        const rawOffset =
          nodes.length > 1
            ? Math.trunc(toNumber(toScalar(this.evaluate(nodes[1]!))))
            : 0;
        const offset =
          rawOffset < 0
            ? Math.max(0, array.length + rawOffset)
            : Math.min(rawOffset, array.length);
        const length =
          nodes.length > 2
            ? Math.trunc(toNumber(toScalar(this.evaluate(nodes[2]!))))
            : array.length - offset;
        const count =
          length < 0 ? Math.max(0, array.length - offset + length) : length;
        const replacement = nodes
          .slice(3)
          .flatMap((argument) => [...toList(this.evaluate(argument))]);
        const removed = array.splice(offset, count, ...replacement);
        this.checkArraySize(array);
        return aggregateValue(removed);
      }
      case "scalar":
        return scalarValue(
          toScalar(this.evaluate(this.requireArgument(nodes, "scalar"))),
        );
      case "chomp":
      case "chop": {
        // `chomp` reports how many characters it removed in total, while
        // `chop` reports the last character it actually removed.
        let removed = 0;
        let lastCharacter = "";
        const shorten = (current: string): string => {
          const next =
            name === "chomp" ? chompText(current) : current.slice(0, -1);
          removed += current.length - next.length;
          lastCharacter = current.slice(next.length);
          return next;
        };
        if (nodes.length === 0) {
          this.setScalar("_", shorten(toText(this.getScalar("_"))));
          return scalarValue(name === "chomp" ? removed : lastCharacter);
        }
        for (const node of nodes) {
          if (node.kind === "array") {
            const array = this.getArray(node.name);
            for (let index = 0; index < array.length; index += 1) {
              array[index] = shorten(toText(array[index]));
            }
            continue;
          }
          const lvalue = this.resolveLvalue(node, false);
          this.writeLvalue(lvalue, shorten(toText(this.readLvalue(lvalue))));
        }
        return scalarValue(name === "chomp" ? removed : lastCharacter);
      }
      case "join": {
        const parts = nodes.flatMap((argument) => [
          ...toList(this.evaluate(argument)),
        ]);
        const separator = toText(parts[0]);
        const text = parts
          .slice(1)
          .map((part) => toText(part))
          .join(separator);
        this.checkScalarSize(text);
        return scalarValue(text);
      }
      case "split":
        return this.evaluateSplit(nodes);
      case "reverse": {
        if (nodes.length === 1 && !isListNode(nodes[0]!)) {
          const value = this.evaluate(nodes[0]!);
          if (value.kind === "scalar") {
            return scalarValue([...toText(toScalar(value))].reverse().join(""));
          }
          return listValue([...toList(value)].reverse());
        }
        const items = nodes.flatMap((argument) => [
          ...toList(this.evaluate(argument)),
        ]);
        return listValue(items.reverse());
      }
      case "sort":
        return this.evaluateSort(expression);
      case "grep":
      case "map":
        return this.evaluateGrepMap(expression);
      case "length": {
        const value = this.argumentOrTopic(nodes);
        return value === undefined
          ? scalarValue(undefined)
          : scalarValue(toText(value).length);
      }
      case "uc":
        return scalarValue(toText(this.argumentOrTopic(nodes)).toUpperCase());
      case "lc":
        return scalarValue(toText(this.argumentOrTopic(nodes)).toLowerCase());
      case "quotemeta":
        return scalarValue(
          toText(this.argumentOrTopic(nodes)).replaceAll(
            /[^A-Za-z0-9_]/gu,
            (character) => `\\${character}`,
          ),
        );
      case "ucfirst": {
        const text = toText(this.argumentOrTopic(nodes));
        return scalarValue(text.slice(0, 1).toUpperCase() + text.slice(1));
      }
      case "lcfirst": {
        const text = toText(this.argumentOrTopic(nodes));
        return scalarValue(text.slice(0, 1).toLowerCase() + text.slice(1));
      }
      case "chr":
        return scalarValue(
          String.fromCodePoint(
            Math.max(0, Math.trunc(toNumber(this.argumentOrTopic(nodes)))),
          ),
        );
      case "ord": {
        const text = toText(this.argumentOrTopic(nodes));
        return scalarValue(text.length === 0 ? 0 : (text.codePointAt(0) ?? 0));
      }
      case "hex": {
        // `hex` accepts the `0x` prefix perl allows as well as bare digits.
        const text = toText(this.argumentOrTopic(nodes)).trim();
        const digits =
          text.startsWith("0x") || text.startsWith("0X") ? text.slice(2) : text;
        return scalarValue(parseRadix(digits, 16));
      }
      case "oct": {
        const text = toText(this.argumentOrTopic(nodes)).trim();
        if (text.startsWith("0x") || text.startsWith("0X")) {
          return scalarValue(parseRadix(text.slice(2), 16));
        }
        if (text.startsWith("0b") || text.startsWith("0B")) {
          return scalarValue(parseRadix(text.slice(2), 2));
        }
        return scalarValue(parseRadix(text, 8));
      }
      case "abs":
        return scalarValue(Math.abs(toNumber(this.argumentOrTopic(nodes))));
      case "int":
        return scalarValue(Math.trunc(toNumber(this.argumentOrTopic(nodes))));
      case "sqrt": {
        const value = toNumber(this.argumentOrTopic(nodes));
        if (value < 0)
          throw new PerlDieError(
            this.dieText("Can't take sqrt of a negative number"),
          );
        return scalarValue(Math.sqrt(value));
      }
      case "log": {
        const value = toNumber(this.argumentOrTopic(nodes));
        if (value <= 0)
          throw new PerlDieError(
            this.dieText("Can't take log of a non-positive number"),
          );
        return scalarValue(Math.log(value));
      }
      case "exp":
        return scalarValue(Math.exp(toNumber(this.argumentOrTopic(nodes))));
      case "index":
      case "rindex": {
        const haystack = toText(
          toScalar(this.evaluate(this.requireArgument(nodes, name))),
        );
        const needle = toText(
          toScalar(this.evaluate(this.requireArgument(nodes, name, 1))),
        );
        if (nodes.length > 2) {
          const position = Math.trunc(
            toNumber(toScalar(this.evaluate(nodes[2]!))),
          );
          return scalarValue(
            name === "index"
              ? haystack.indexOf(needle, position)
              : haystack.lastIndexOf(needle, position),
          );
        }
        return scalarValue(
          name === "index"
            ? haystack.indexOf(needle)
            : haystack.lastIndexOf(needle),
        );
      }
      case "substr": {
        const text = toText(
          toScalar(this.evaluate(this.requireArgument(nodes, "substr"))),
        );
        const rawOffset = Math.trunc(
          toNumber(
            toScalar(this.evaluate(this.requireArgument(nodes, "substr", 1))),
          ),
        );
        const offset =
          rawOffset < 0 ? Math.max(0, text.length + rawOffset) : rawOffset;
        if (offset > text.length) return scalarValue(undefined);
        if (nodes.length <= 2) return scalarValue(text.slice(offset));
        const length = Math.trunc(toNumber(toScalar(this.evaluate(nodes[2]!))));
        const end = length < 0 ? text.length + length : offset + length;
        const stop = Math.max(offset, end);
        if (nodes.length <= 3) return scalarValue(text.slice(offset, stop));
        // Four-argument `substr` splices the replacement into its first
        // argument, which must therefore be assignable, and yields the old
        // piece it displaced.
        const replacement = toText(toScalar(this.evaluate(nodes[3]!)));
        const lvalue = this.resolveLvalue(nodes[0]!, false);
        const updated = text.slice(0, offset) + replacement + text.slice(stop);
        this.checkScalarSize(updated);
        this.writeLvalue(lvalue, updated);
        return scalarValue(text.slice(offset, stop));
      }
      case "sprintf": {
        const parts = nodes.flatMap((argument) => [
          ...toList(this.evaluate(argument)),
        ]);
        const text = formatPerl(toText(parts[0]), parts.slice(1));
        this.checkScalarSize(text);
        return scalarValue(text);
      }
      case "ref":
        return scalarValue("");
      case "die": {
        const parts = nodes.flatMap((argument) => [
          ...toList(this.evaluate(argument)),
        ]);
        const message = parts.map((part) => toText(part)).join("");
        const text = message.length === 0 ? "Died" : message;
        throw new PerlDieError(text.endsWith("\n") ? text : this.dieText(text));
      }
      case "warn": {
        const parts = nodes.flatMap((argument) => [
          ...toList(this.evaluate(argument)),
        ]);
        const message = parts.map((part) => toText(part)).join("");
        const text =
          message.length === 0 ? "Warning: something's wrong" : message;
        this.writeError(text.endsWith("\n") ? text : this.dieText(text));
        return trueValue;
      }
      case "exit":
        throw new PerlExitSignal(
          nodes.length === 0
            ? 0
            : Math.trunc(toNumber(toScalar(this.evaluate(nodes[0]!)))) & 0xff,
        );
      case "open": {
        const target = this.requireArgument(nodes, "open");
        if (nodes.length >= 3) {
          const mode = toText(toScalar(this.evaluate(nodes[1]!)));
          const path = toText(toScalar(this.evaluate(nodes[2]!)));
          return this.openHandle(target, mode, path);
        }
        const specification = toText(
          toScalar(this.evaluate(this.requireArgument(nodes, "open", 1))),
        );
        const parsed = parseTwoArgumentOpen(specification);
        return this.openHandle(target, parsed.mode, parsed.path);
      }
      case "close":
        return this.closeHandle(
          toText(toScalar(this.evaluate(this.requireArgument(nodes, "close")))),
        );
      case "eof": {
        if (nodes.length === 0) {
          return booleanValue(
            this.argv.length === 0 &&
              this.stdinCursor >= this.stdinLines.length,
          );
        }
        const handle = this.handles.get(
          toText(toScalar(this.evaluate(nodes[0]!))),
        );
        return booleanValue(
          handle === undefined || handle.cursor >= handle.lines.length,
        );
      }
      case "wantarray":
        return scalarValue(undefined);
      case "time":
        throw new PerlDieError(
          this.dieText(
            "time() is unavailable; CS-Linux perl has no wall clock",
          ),
        );
      default:
        break;
    }
    return this.callSubroutine(name, nodes);
  }

  private defaultArgumentArray(node: PerlExpression | undefined): PerlScalar[] {
    if (node === undefined) {
      return this.currentSubArguments ?? this.argv;
    }
    if (node.kind === "array") return this.getArray(node.name);
    throw new PerlDieError(this.dieText("shift/pop require an array"));
  }

  private argumentOrTopic(nodes: readonly PerlExpression[]): PerlScalar {
    if (nodes.length === 0) return this.getScalar("_");
    return toScalar(this.evaluate(nodes[0]!));
  }

  private requireArgument(
    nodes: readonly PerlExpression[],
    name: string,
    index = 0,
  ): PerlExpression {
    const node = nodes[index];
    if (node === undefined) {
      throw new PerlDieError(this.dieText(`Not enough arguments for ${name}`));
    }
    return node;
  }

  private evaluateSplit(nodes: readonly PerlExpression[]): PerlValue {
    const first = this.requireArgument(nodes, "split");
    const subjectNode = nodes[1];
    const subject =
      subjectNode === undefined
        ? toText(this.getScalar("_"))
        : toText(toScalar(this.evaluate(subjectNode)));
    const limit =
      nodes.length > 2
        ? Math.trunc(toNumber(toScalar(this.evaluate(nodes[2]!))))
        : 0;
    if (first.kind === "match") {
      const pattern = toText(toScalar(this.evaluate(first.regex.pattern)));
      if (pattern === "")
        return aggregateValue(splitCharacters(subject, limit));
      return aggregateValue(
        this.splitByRegex(
          this.compile(pattern, first.regex.flags),
          subject,
          limit,
        ),
      );
    }
    const separator = toText(toScalar(this.evaluate(first)));
    if (separator === " ") return aggregateValue(splitOnWhitespace(subject));
    if (separator === "")
      return aggregateValue(splitCharacters(subject, limit));
    return aggregateValue(
      this.splitByRegex(
        this.compile(escapeRegexLiteral(separator), ""),
        subject,
        limit,
      ),
    );
  }

  private evaluateSort(
    expression: PerlExpression & { kind: "call" },
  ): PerlValue {
    const items = expression.arguments.flatMap((argument) => [
      ...toList(this.evaluate(argument)),
    ]);
    const block = expression.block;
    if (block === undefined) {
      return listValue(
        [...items].sort((left, right) =>
          compareText(toText(left), toText(right)),
        ),
      );
    }
    const previousA = this.globals.scalars.get("a");
    const previousB = this.globals.scalars.get("b");
    const sorted = [...items].sort((left, right) => {
      this.consumeStep();
      this.globals.scalars.set("a", left);
      this.globals.scalars.set("b", right);
      return Math.sign(toNumber(this.runBlockValue(block)));
    });
    this.globals.scalars.set("a", previousA);
    this.globals.scalars.set("b", previousB);
    return listValue(sorted);
  }

  private evaluateGrepMap(
    expression: PerlExpression & { kind: "call" },
  ): PerlValue {
    const block = expression.block;
    const nodes = expression.arguments;
    const bodyNode =
      block === undefined
        ? this.requireArgument(nodes, expression.name)
        : undefined;
    const listNodes = block === undefined ? nodes.slice(1) : nodes;
    const items = listNodes.flatMap((argument) => [
      ...toList(this.evaluate(argument)),
    ]);
    const previous = this.getScalar("_");
    const output: PerlScalar[] = [];
    for (const item of items) {
      this.consumeStep();
      this.setScalar("_", item);
      const value =
        block === undefined
          ? this.evaluate(bodyNode!)
          : this.runBlockList(block);
      if (expression.name === "grep") {
        if (isTrue(toScalar(value))) output.push(item);
      } else {
        output.push(...toList(value));
      }
      if (output.length > linuxPerlLimits.maximumArrayElements) {
        throw new PerlFatalError("list element limit exceeded");
      }
    }
    this.setScalar("_", previous);
    // An aggregate yields its element count in scalar context, which is what
    // `my $n = grep { ... } @items` means in perl.
    return aggregateValue(output);
  }

  private runBlockValue(block: PerlBlock): PerlScalar {
    return toScalar(this.runBlockList(block));
  }

  private runBlockList(block: PerlBlock): PerlValue {
    this.pushScope();
    let result: PerlValue = emptyList;
    try {
      for (const statement of block.statements) {
        if (statement.kind === "expression")
          result = this.evaluate(statement.expression);
        else {
          this.executeStatement(statement);
          result = emptyList;
        }
      }
    } catch (error) {
      if (error instanceof PerlReturnSignal) return error.value;
      throw error;
    } finally {
      this.popScope();
    }
    return result;
  }

  private callSubroutine(
    name: string,
    nodes: readonly PerlExpression[],
  ): PerlValue {
    const body = this.subs.get(name);
    if (body === undefined) {
      throw new PerlDieError(
        this.dieText(`Undefined subroutine &main::${name} called`),
      );
    }
    if (this.callDepth >= linuxPerlLimits.maximumCallDepth) {
      throw new PerlFatalError("subroutine call depth limit exceeded");
    }
    const parameters = nodes.flatMap((argument) => [
      ...toList(this.evaluate(argument)),
    ]);
    const previousArguments = this.currentSubArguments;
    const previousScope = this.scope;
    this.currentSubArguments = parameters;
    this.scope = createScope(this.globals);
    this.callDepth += 1;
    try {
      return this.executeBlockValue(body);
    } catch (error) {
      if (error instanceof PerlReturnSignal) return error.value;
      throw error;
    } finally {
      this.callDepth -= 1;
      this.currentSubArguments = previousArguments;
      this.scope = previousScope;
    }
  }
}

function createScope(parent: PerlScope | undefined): PerlScope {
  return {
    arrays: new Map(),
    hashes: new Map(),
    parent,
    scalars: new Map(),
  };
}

function literalExpression(value: PerlScalar): PerlExpression {
  return typeof value === "number"
    ? { kind: "number", value }
    : { kind: "string", value: toText(value) };
}

function isListNode(node: PerlExpression): boolean {
  return (
    node.kind === "list" ||
    node.kind === "array" ||
    node.kind === "hash" ||
    node.kind === "slice" ||
    node.kind === "range" ||
    node.kind === "call"
  );
}

function isDigits(text: string): boolean {
  if (text.length === 0) return false;
  for (const character of text) {
    if (character < "0" || character > "9") return false;
  }
  return true;
}

function isNumericText(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  return String(Number(trimmed)) === trimmed || /^[+-]?\d+$/u.test(trimmed);
}

function magicIncrement(text: string): string {
  const characters = [...text];
  let index = characters.length - 1;
  for (;;) {
    if (index < 0) {
      const first = characters[0] ?? "a";
      const prefix =
        first >= "0" && first <= "9"
          ? "1"
          : first === first.toUpperCase()
            ? "A"
            : "a";
      return prefix + characters.join("");
    }
    const character = characters[index]!;
    if (character === "z") characters[index] = "a";
    else if (character === "Z") characters[index] = "A";
    else if (character === "9") characters[index] = "0";
    else {
      characters[index] = String.fromCharCode(character.charCodeAt(0) + 1);
      return characters.join("");
    }
    index -= 1;
  }
}

function normalizeIndex(raw: number, length: number): number | undefined {
  const index = Math.trunc(raw);
  const resolved = index < 0 ? length + index : index;
  if (resolved < 0 || resolved >= length) return undefined;
  return resolved;
}

function flattenHash(hash: ReadonlyMap<string, PerlScalar>): PerlScalar[] {
  const items: PerlScalar[] = [];
  for (const [key, value] of hash) items.push(key, value);
  return items;
}

function compareNumbers(left: number, right: number): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

/** Reads one scalar as the 64-bit unsigned integer perl gives its bit operators. */
function toBitInteger(scalar: PerlScalar): bigint {
  // An exact integer kept as text, such as the `~0` this very function
  // produced, must not lose its low bits through a double.
  if (typeof scalar === "string" && /^\s*-?\d+\s*$/u.test(scalar)) {
    return BigInt.asUintN(64, BigInt(scalar.trim()));
  }
  const value = Math.trunc(toNumber(scalar));
  if (!Number.isFinite(value)) return 0n;
  return BigInt.asUintN(64, BigInt(value));
}

/**
 * Renders a bit-operation result as perl does: an unsigned 64-bit integer,
 * kept exact as text once it outgrows what a double can represent.
 */
function bitResult(value: bigint): PerlScalar {
  const masked = BigInt.asUintN(64, value);
  return masked <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(masked)
    : masked.toString();
}

/** Shifts by a 64-bit count, which perl flushes to zero past 63 places. */
function shiftBits(
  left: PerlScalar,
  right: PerlScalar,
  direction: "left" | "right",
): PerlScalar {
  const places = Math.trunc(toNumber(right));
  if (!Number.isFinite(places) || places < 0 || places > 63) return 0;
  const value = toBitInteger(left);
  return bitResult(
    direction === "left" ? value << BigInt(places) : value >> BigInt(places),
  );
}

function chompText(text: string): string {
  if (text.endsWith("\r\n")) return text.slice(0, -2);
  if (text.endsWith("\n")) return text.slice(0, -1);
  return text;
}

function splitLines(text: string): readonly string[] {
  if (text.length === 0) return Object.freeze([]);
  const lines: string[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") {
      lines.push(text.slice(start, index + 1));
      start = index + 1;
    }
  }
  if (start < text.length) lines.push(text.slice(start));
  return Object.freeze(lines);
}

function splitOnWhitespace(text: string): PerlScalar[] {
  const fields: PerlScalar[] = [];
  let current = "";
  for (const character of text) {
    if (
      character === " " ||
      character === "\t" ||
      character === "\n" ||
      character === "\r"
    ) {
      if (current.length > 0) {
        fields.push(current);
        current = "";
      }
      continue;
    }
    current += character;
  }
  if (current.length > 0) fields.push(current);
  return fields;
}

function splitCharacters(text: string, limit: number): PerlScalar[] {
  const characters: PerlScalar[] = [];
  for (const character of text) {
    if (limit > 0 && characters.length === limit - 1) {
      characters.push(text.slice(joinLength(characters)));
      return characters;
    }
    characters.push(character);
  }
  return characters;
}

function joinLength(items: readonly PerlScalar[]): number {
  let total = 0;
  for (const item of items) total += toText(item).length;
  return total;
}

function escapeRegexLiteral(text: string): string {
  let output = "";
  for (const character of text) {
    if ("\\^$.[]|()*+?{}".includes(character)) output += "\\";
    output += character;
  }
  return output;
}

function expandTransliterationSet(specification: string): readonly string[] {
  const characters: string[] = [];
  let index = 0;
  while (index < specification.length) {
    let character = specification[index]!;
    if (character === "\\" && index + 1 < specification.length) {
      const next = specification[index + 1]!;
      character =
        next === "n" ? "\n" : next === "t" ? "\t" : next === "r" ? "\r" : next;
      index += 2;
    } else {
      index += 1;
    }
    if (
      specification[index] === "-" &&
      index + 1 < specification.length &&
      specification[index + 1] !== undefined
    ) {
      const last = specification[index + 1]!;
      const from = character.charCodeAt(0);
      const to = last.charCodeAt(0);
      if (to >= from && to - from < 1024) {
        for (let code = from; code <= to; code += 1) {
          characters.push(String.fromCharCode(code));
        }
        index += 2;
        continue;
      }
    }
    characters.push(character);
  }
  return characters;
}

/**
 * Ranks one character inside a complemented `tr` search list, which perl orders
 * by code point, so `tr/abc/xy/c` still indexes into its replacement list.
 */
function complementRank(codePoint: number, ordered: readonly number[]): number {
  let low = 0;
  let high = ordered.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (ordered[middle]! < codePoint) low = middle + 1;
    else high = middle;
  }
  return codePoint - low;
}

function parseRadix(text: string, radix: number): number {
  const trimmed = text.trim();
  let value = 0;
  for (const character of trimmed) {
    const digit = Number.parseInt(character, radix);
    if (Number.isNaN(digit)) break;
    value = value * radix + digit;
  }
  return value;
}

function parseTwoArgumentOpen(specification: string): {
  readonly mode: string;
  readonly path: string;
} {
  const trimmed = specification.trim();
  if (trimmed.startsWith(">>"))
    return { mode: ">>", path: trimmed.slice(2).trim() };
  if (trimmed.startsWith(">"))
    return { mode: ">", path: trimmed.slice(1).trim() };
  if (trimmed.startsWith("<"))
    return { mode: "<", path: trimmed.slice(1).trim() };
  return { mode: "<", path: trimmed };
}

function stripPath(message: string, path: string): string {
  return message.startsWith(`${path}: `)
    ? message.slice(path.length + 2)
    : message;
}

/** Bounded `sprintf`/`printf` conversion over a fixed directive set. */
export function formatPerl(
  format: string,
  args: readonly PerlScalar[],
): string {
  let output = "";
  let argumentIndex = 0;
  let index = 0;
  const nextArgument = (): PerlScalar => args[argumentIndex++];
  while (index < format.length) {
    const character = format[index]!;
    if (character !== "%") {
      output += character;
      index += 1;
      continue;
    }
    let cursor = index + 1;
    let leftAlign = false;
    let zeroPad = false;
    let plusSign = false;
    let spaceSign = false;
    let alternate = false;
    for (; cursor < format.length; cursor += 1) {
      const flag = format[cursor]!;
      if (flag === "-") leftAlign = true;
      else if (flag === "0") zeroPad = true;
      else if (flag === "+") plusSign = true;
      else if (flag === " ") spaceSign = true;
      else if (flag === "#") alternate = true;
      else break;
    }
    let width = 0;
    let hasWidth = false;
    if (format[cursor] === "*") {
      width = Math.trunc(toNumber(nextArgument()));
      hasWidth = true;
      cursor += 1;
      if (width < 0) {
        leftAlign = true;
        width = -width;
      }
    } else {
      while (
        cursor < format.length &&
        format[cursor]! >= "0" &&
        format[cursor]! <= "9"
      ) {
        width = width * 10 + Number(format[cursor]!);
        hasWidth = true;
        cursor += 1;
        if (width > 4096) throw new Error("format width limit exceeded");
      }
    }
    let precision = -1;
    if (format[cursor] === ".") {
      cursor += 1;
      precision = 0;
      if (format[cursor] === "*") {
        precision = Math.max(0, Math.trunc(toNumber(nextArgument())));
        cursor += 1;
      } else {
        while (
          cursor < format.length &&
          format[cursor]! >= "0" &&
          format[cursor]! <= "9"
        ) {
          precision = precision * 10 + Number(format[cursor]!);
          cursor += 1;
          if (precision > 4096)
            throw new Error("format precision limit exceeded");
        }
      }
    }
    const conversion = format[cursor];
    if (conversion === undefined) {
      output += format.slice(index);
      break;
    }
    cursor += 1;
    if (conversion === "%") {
      output += "%";
      index = cursor;
      continue;
    }
    let body = "";
    let signPrefix = "";
    switch (conversion) {
      case "s": {
        body = toText(nextArgument());
        if (precision >= 0) body = body.slice(0, precision);
        break;
      }
      case "c": {
        body = String.fromCodePoint(
          Math.max(0, Math.trunc(toNumber(nextArgument()))),
        );
        break;
      }
      case "d":
      case "i":
      case "u": {
        let value = Math.trunc(toNumber(nextArgument()));
        if (conversion === "u" && value < 0) value = value >>> 0;
        if (value < 0) {
          signPrefix = "-";
          body = String(Math.abs(value));
        } else {
          signPrefix = plusSign ? "+" : spaceSign ? " " : "";
          body = String(value);
        }
        if (precision >= 0) body = body.padStart(precision, "0");
        break;
      }
      case "f":
      case "F": {
        const value = toNumber(nextArgument());
        const digits = precision < 0 ? 6 : precision;
        body = fixedHalfEven(Math.abs(value), digits);
        signPrefix =
          value < 0 || Object.is(value, -0)
            ? "-"
            : plusSign
              ? "+"
              : spaceSign
                ? " "
                : "";
        break;
      }
      case "e":
      case "E": {
        const value = toNumber(nextArgument());
        const digits = precision < 0 ? 6 : precision;
        body = exponentialHalfEven(Math.abs(value), digits);
        if (conversion === "E") body = body.toUpperCase();
        signPrefix = value < 0 ? "-" : plusSign ? "+" : spaceSign ? " " : "";
        break;
      }
      case "g":
      case "G": {
        const value = toNumber(nextArgument());
        const digits = precision < 0 ? 6 : precision === 0 ? 1 : precision;
        body = formatGeneral(Math.abs(value), digits);
        if (conversion === "G") body = body.toUpperCase();
        signPrefix = value < 0 ? "-" : plusSign ? "+" : spaceSign ? " " : "";
        break;
      }
      case "x":
      case "X":
      case "o":
      case "b":
      case "B": {
        const value = Math.trunc(toNumber(nextArgument()));
        const unsigned = value < 0 ? value >>> 0 : value;
        const radix =
          conversion === "o"
            ? 8
            : conversion === "x" || conversion === "X"
              ? 16
              : 2;
        body = unsigned.toString(radix);
        if (conversion === "X") body = body.toUpperCase();
        if (precision >= 0) body = body.padStart(precision, "0");
        if (alternate && unsigned !== 0) {
          if (radix === 16) body = `${conversion === "X" ? "0X" : "0x"}${body}`;
          else if (radix === 8) body = `0${body}`;
          else body = `0b${body}`;
        }
        break;
      }
      default:
        output += format.slice(index, cursor);
        index = cursor;
        continue;
    }
    let rendered = `${signPrefix}${body}`;
    if (hasWidth && rendered.length < width) {
      if (leftAlign) rendered = rendered.padEnd(width, " ");
      // C ignores `0` for the integer conversions once a precision is given,
      // but keeps it for the floating ones, so `%05.2f` still pads with zeros.
      else if (zeroPad && zeroPadApplies(conversion, precision)) {
        rendered = signPrefix + body.padStart(width - signPrefix.length, "0");
      } else rendered = rendered.padStart(width, " ");
    }
    output += rendered;
    index = cursor;
  }
  return output;
}

/** Reports whether the `0` flag survives for one conversion and precision. */
function zeroPadApplies(conversion: string, precision: number): boolean {
  if (conversion === "s" || conversion === "c") return false;
  const integerConversion = "diuxXobB".includes(conversion);
  return !integerConversion || precision < 0;
}

/** Formats one non-negative value the way C's `%g` conversion does. */
function formatGeneral(value: number, precision: number): string {
  if (value === 0) return "0";
  const exponent = Math.floor(Math.log10(Math.abs(value)));
  if (exponent < -4 || exponent >= precision) {
    const text = exponentialHalfEven(
      Math.abs(value),
      Math.max(0, precision - 1),
    );
    const [mantissa, exponentText] = text.split("e");
    const trimmed = trimTrailingZeros(mantissa!);
    const sign = exponentText!.startsWith("-") ? "-" : "+";
    const digits = exponentText!.replace(/^[+-]/u, "").padStart(2, "0");
    return `${value < 0 ? "-" : ""}${trimmed}e${sign}${digits}`;
  }
  const fixed = fixedHalfEven(
    Math.abs(value),
    Math.max(0, precision - 1 - exponent),
  );
  return `${value < 0 ? "-" : ""}${trimTrailingZeros(fixed)}`;
}

/**
 * Splits one finite non-negative double into the exact decimal
 * `digits * 10 ** -scale` it really holds. A double is a binary fraction, so
 * this expansion always terminates and no precision is invented.
 */
function exactDecimal(value: number): { digits: bigint; scale: number } {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  const high = view.getUint32(0);
  const low = view.getUint32(4);
  const exponentField = (high >>> 20) & 0x7ff;
  const fraction = (BigInt(high & 0xf_ff_ff) << 32n) | BigInt(low);
  const significand = exponentField === 0 ? fraction : fraction | (1n << 52n);
  const exponent = (exponentField === 0 ? 1 : exponentField) - 1075;
  if (exponent >= 0) {
    return { digits: significand << BigInt(exponent), scale: 0 };
  }
  return { digits: significand * 5n ** BigInt(-exponent), scale: -exponent };
}

/** Divides exactly, breaking a tie toward the even quotient as C's printf does. */
function divideHalfEven(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const twiceRemainder = (numerator % denominator) * 2n;
  if (twiceRemainder > denominator) return quotient + 1n;
  if (twiceRemainder < denominator) return quotient;
  return quotient % 2n === 0n ? quotient : quotient + 1n;
}

/** Renders `%f` for one non-negative value with C's round-half-to-even rule. */
function fixedHalfEven(value: number, digits: number): string {
  if (!Number.isFinite(value)) return Number.isNaN(value) ? "NaN" : "Inf";
  const exact = exactDecimal(value);
  const scaled =
    exact.scale < digits
      ? exact.digits * 10n ** BigInt(digits - exact.scale)
      : exact.digits;
  const scale = Math.max(exact.scale, digits);
  const rounded = divideHalfEven(scaled, 10n ** BigInt(scale - digits));
  const text = rounded.toString().padStart(digits + 1, "0");
  const split = text.length - digits;
  return digits === 0 ? text : `${text.slice(0, split)}.${text.slice(split)}`;
}

/** Renders `%e` for one non-negative value with C's round-half-to-even rule. */
function exponentialHalfEven(value: number, digits: number): string {
  if (!Number.isFinite(value)) return Number.isNaN(value) ? "NaN" : "Inf";
  if (value === 0) return `${fixedHalfEven(0, digits)}e+00`;
  const exact = exactDecimal(value);
  const text = exact.digits.toString();
  const keep = digits + 1;
  let exponent = text.length - 1 - exact.scale;
  let mantissa =
    text.length <= keep
      ? (exact.digits * 10n ** BigInt(keep - text.length)).toString()
      : divideHalfEven(
          exact.digits,
          10n ** BigInt(text.length - keep),
        ).toString();
  if (mantissa.length > keep) {
    mantissa = mantissa.slice(0, keep);
    exponent += 1;
  }
  const sign = exponent < 0 ? "-" : "+";
  const magnitude = String(Math.abs(exponent)).padStart(2, "0");
  const fraction = mantissa.slice(1);
  return `${mantissa.slice(0, 1)}${fraction === "" ? "" : `.${fraction}`}e${sign}${magnitude}`;
}

function trimTrailingZeros(text: string): string {
  if (!text.includes(".")) return text;
  let end = text.length;
  while (end > 0 && text[end - 1] === "0") end -= 1;
  if (end > 0 && text[end - 1] === ".") end -= 1;
  return text.slice(0, end);
}
