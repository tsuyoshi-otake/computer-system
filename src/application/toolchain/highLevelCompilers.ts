import {
  assembleCs486,
  assembleCs486Object,
  Cs486CompileError,
} from "./cs486Assembler.js";
import type { Cs486Executable } from "../../domain/cpu/cs486.js";
import type { Cs486Object } from "../../domain/cpu/cs486Object.js";
import { linkCs486Objects } from "./cs486Linker.js";

export type Cs486SourceLanguage = "basic" | "c" | "cpp";

export function compileCs486Source(
  language: Cs486SourceLanguage,
  source: string,
): Cs486Executable {
  return linkCs486Objects([compileCs486Object(language, source)], {
    entry: language === "basic" ? "basic_main" : "main",
  });
}

export function compileCs486Object(
  language: Cs486SourceLanguage,
  source: string,
): Cs486Object {
  const compiler = new SourceCompiler();
  const assembly =
    language === "basic"
      ? compiler.basic(source)
      : compiler.cFamily(source, language === "cpp");
  return assembleCs486Object(assembly, {
    dataBytes: compiler.dataBytes,
    language,
  });
}

class SourceCompiler {
  private readonly assembly: string[] = [];
  private readonly variables = new Map<string, number>();
  private nextAddress = 0;
  private nextLabel = 0;
  private currentFunction: string | undefined;
  private currentFunctionReturned = false;

  get dataBytes(): number {
    return this.nextAddress;
  }

  basic(source: string): string {
    this.emit("global basic_main", "basic_main:");
    const loops: {
      variable: string;
      start: string;
      endAddress: number;
      step: number;
    }[] = [];
    for (const [offset, raw] of lines(source).entries()) {
      const numbered = /^\s*(\d+)\s+(.*)$/u.exec(raw);
      const text = (numbered?.[2] ?? raw).trim();
      if (numbered !== null) this.emit(`basic_${numbered[1]}:`);
      if (text.length === 0 || /^REM\b/iu.test(text)) continue;
      const print = /^PRINT\s+(.+)$/iu.exec(text);
      if (print !== null) {
        this.print(print[1]!, offset + 1);
        continue;
      }
      const assignment =
        /^(?:LET\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/iu.exec(text);
      if (assignment !== null) {
        this.assign(assignment[1]!, assignment[2]!, offset + 1);
        continue;
      }
      const for_ =
        /^FOR\s+([A-Za-z_]\w*)\s*=\s*(.+?)\s+TO\s+(.+?)(?:\s+STEP\s+(-?\d+))?$/iu.exec(
          text,
        );
      if (for_ !== null) {
        const variable = for_[1]!;
        const step = Number(for_[4] ?? 1);
        if (step === 0)
          throw new Cs486CompileError("FOR STEP cannot be zero", offset + 1);
        this.assign(variable, for_[2]!, offset + 1);
        this.expression(for_[3]!, offset + 1);
        const endAddress = this.variable(`__end_${this.nextLabel}`);
        this.emit(`store [${endAddress}], eax`);
        const start = this.label("for");
        this.emit(`${start}:`);
        loops.push({ variable, start, endAddress, step });
        continue;
      }
      if (/^NEXT(?:\s+[A-Za-z_]\w*)?$/iu.test(text)) {
        const loop = loops.pop();
        if (loop === undefined)
          throw new Cs486CompileError("NEXT without FOR", offset + 1);
        this.emit(
          `load eax, [${this.variable(loop.variable)}]`,
          `add eax, ${loop.step}`,
          `store [${this.variable(loop.variable)}], eax`,
          `load ebx, [${loop.endAddress}]`,
          "cmp eax, ebx",
          `${loop.step > 0 ? "jle" : "jge"} ${loop.start}`,
        );
        continue;
      }
      const goto = /^GOTO\s+(\d+)$/iu.exec(text);
      if (goto !== null) {
        this.emit(`jmp basic_${goto[1]}`);
        continue;
      }
      const conditional = /^IF\s+(.+?)\s+THEN\s+GOTO\s+(\d+)$/iu.exec(text);
      if (conditional !== null) {
        this.expression(conditional[1]!, offset + 1);
        this.emit("cmp eax, 0", `jne basic_${conditional[2]}`);
        continue;
      }
      if (/^(?:END|STOP)$/iu.test(text)) {
        this.emit("halt");
        continue;
      }
      throw new Cs486CompileError(
        `unsupported BASIC statement: ${text}`,
        offset + 1,
      );
    }
    if (loops.length > 0) throw new Cs486CompileError("FOR without NEXT");
    this.emit("halt");
    return this.assembly.join("\n");
  }

  cFamily(source: string, cpp: boolean): string {
    const loops: {
      variable: string;
      start: string;
      end: string;
      increment: number;
    }[] = [];
    const normalized = source
      .replace(/\/\*[\s\S]*?\*\//gu, "")
      .replace(/\/\/.*$/gmu, "")
      .replaceAll("{", "{\n")
      .replaceAll("}", "\n}\n");
    for (const [offset, raw] of lines(normalized).entries()) {
      const text = raw.trim();
      const external =
        /^extern\s+(?:int|long|void)\s+([A-Za-z_]\w*)\s*\(\s*\)\s*;$/u.exec(
          text,
        );
      if (external !== null) {
        this.emit(`extern ${external[1]}`);
        continue;
      }
      const function_ =
        /^(?:int|long|void)\s+([A-Za-z_]\w*)\s*\(\s*\)\s*\{$/u.exec(text);
      if (function_ !== null) {
        if (this.currentFunction !== undefined)
          throw new Cs486CompileError(
            "nested functions are not supported",
            offset + 1,
          );
        this.currentFunction = function_[1]!;
        this.currentFunctionReturned = false;
        this.emit(`global ${this.currentFunction}`, `${this.currentFunction}:`);
        continue;
      }
      if (text.length === 0 || text.startsWith("#") || text === "{") continue;
      const for_ =
        /^for\s*\(\s*(?:int\s+)?([A-Za-z_]\w*)\s*=\s*(.+?)\s*;\s*\1\s*(<=|<|>=|>)\s*(.+?)\s*;\s*\1\s*(\+\+|--|\+=\s*\d+|-=\s*\d+)\s*\)\s*\{$/u.exec(
          text,
        );
      if (for_ !== null) {
        this.assign(for_[1]!, for_[2]!, offset + 1);
        const start = this.label("for");
        const end = this.label("endfor");
        this.emit(`${start}:`);
        this.expression(for_[4]!, offset + 1);
        this.emit(
          "mov ebx, eax",
          `load eax, [${this.variable(for_[1]!)}]`,
          "cmp eax, ebx",
        );
        const inverse = (
          { "<": "jge", "<=": "jg", ">": "jle", ">=": "jl" } as const
        )[for_[3] as "<"];
        this.emit(`${inverse} ${end}`);
        const increment =
          for_[5] === "++"
            ? 1
            : for_[5] === "--"
              ? -1
              : Number(for_[5]!.replace(/\s/gu, "").slice(2)) *
                (for_[5]!.includes("-=") ? -1 : 1);
        loops.push({ variable: for_[1]!, start, end, increment });
        continue;
      }
      if (text === "}") {
        const loop = loops.pop();
        if (loop !== undefined) {
          this.emit(
            `load eax, [${this.variable(loop.variable)}]`,
            `add eax, ${loop.increment}`,
            `store [${this.variable(loop.variable)}], eax`,
            `jmp ${loop.start}`,
            `${loop.end}:`,
          );
        } else if (this.currentFunction !== undefined) {
          if (!this.currentFunctionReturned) this.emit("mov eax, 0", "ret");
          this.currentFunction = undefined;
          this.currentFunctionReturned = false;
        }
        continue;
      }
      const inlineAssembly =
        /^(?:asm|__asm__)\s*\(\s*("(?:\\.|[^"\\])*")\s*\)\s*;$/u.exec(text);
      if (inlineAssembly !== null) {
        this.inlineAssembly(inlineAssembly[1]!, offset + 1);
        continue;
      }
      const declaration =
        /^(?:int|long)\s+([A-Za-z_]\w*)(?:\s*=\s*(.+?))?;$/u.exec(text);
      if (declaration !== null) {
        this.assign(declaration[1]!, declaration[2] ?? "0", offset + 1);
        continue;
      }
      const assignment = /^([A-Za-z_]\w*)\s*=\s*(.+);$/u.exec(text);
      if (assignment !== null) {
        this.assign(assignment[1]!, assignment[2]!, offset + 1);
        continue;
      }
      const printf = /^printf\s*\(\s*"%d(?:\\n)?"\s*,\s*(.+)\s*\);$/u.exec(
        text,
      );
      if (printf !== null) {
        this.expression(printf[1]!, offset + 1);
        this.emit("print eax", 'print "\\n"');
        continue;
      }
      const cout = /^std::cout\s*<<\s*(.+?)(?:\s*<<\s*std::endl)?\s*;$/u.exec(
        text,
      );
      if (cpp && cout !== null) {
        this.expression(cout[1]!, offset + 1);
        this.emit("print eax", 'print "\\n"');
        continue;
      }
      const call = /^([A-Za-z_]\w*)\s*\(\s*\)\s*;$/u.exec(text);
      if (call !== null) {
        this.emit(`call ${call[1]}`);
        continue;
      }
      const return_ = /^return\s+(.+);$/u.exec(text);
      if (return_ !== null) {
        this.expression(return_[1]!, offset + 1);
        this.emit("ret");
        this.currentFunctionReturned = true;
        continue;
      }
      throw new Cs486CompileError(
        `unsupported ${cpp ? "C++" : "C"} statement: ${text}`,
        offset + 1,
      );
    }
    if (loops.length > 0) throw new Cs486CompileError("unterminated for loop");
    if (this.currentFunction !== undefined)
      throw new Cs486CompileError(
        `unterminated function ${this.currentFunction}`,
      );
    return this.assembly.join("\n");
  }

  private assign(name: string, expression: string, line: number): void {
    this.expression(expression, line);
    this.emit(`store [${this.variable(name)}], eax`);
  }

  private print(expression: string, line: number): void {
    const trimmed = expression.trim();
    if (/^".*"$/u.test(trimmed)) this.emit(`print ${trimmed}`);
    else {
      this.expression(trimmed, line);
      this.emit("print eax");
    }
    this.emit('print "\\n"');
  }

  private expression(source: string, line: number): void {
    const call = /^([A-Za-z_]\w*)\s*\(\s*\)$/u.exec(source.trim());
    if (call !== null) {
      this.emit(`call ${call[1]}`, "push eax");
      return;
    }
    const tokens = tokenizeExpression(source, line);
    const output: string[] = [];
    const operators: string[] = [];
    for (const token of tokens) {
      if (/^(?:\d+|[A-Za-z_]\w*)$/u.test(token)) output.push(token);
      else if (token === "(") operators.push(token);
      else if (token === ")") {
        while (operators.at(-1) !== "(" && operators.length > 0)
          output.push(operators.pop()!);
        if (operators.pop() !== "(")
          throw new Cs486CompileError("unbalanced expression", line);
      } else {
        while (
          operators.length > 0 &&
          precedence(operators.at(-1)!) >= precedence(token)
        )
          output.push(operators.pop()!);
        operators.push(token);
      }
    }
    while (operators.length > 0) output.push(operators.pop()!);
    for (const token of output) {
      if (/^\d+$/u.test(token)) this.emit(`mov eax, ${token}`, "push eax");
      else if (/^[A-Za-z_]\w*$/u.test(token))
        this.emit(`load eax, [${this.variable(token)}]`, "push eax");
      else {
        this.emit(
          "pop ebx",
          "pop eax",
          `${({ "+": "add", "-": "sub", "*": "mul", "/": "div", "%": "mod" } as const)[token as "+"]} eax, ebx`,
          "push eax",
        );
      }
    }
    this.emit("pop eax");
  }

  private variable(name: string): number {
    const normalized = name.toLowerCase();
    let address = this.variables.get(normalized);
    if (address === undefined) {
      address = this.nextAddress;
      this.nextAddress += 4;
      this.variables.set(normalized, address);
    }
    return address;
  }

  private inlineAssembly(encoded: string, line: number): void {
    let source: string;
    try {
      source = JSON.parse(encoded) as string;
    } catch {
      throw new Cs486CompileError("invalid inline assembly string", line);
    }
    const instructions = source.split("\n");
    if (instructions.length > 16)
      throw new Cs486CompileError(
        "inline assembly instruction limit exceeded",
        line,
      );
    for (const raw of instructions) {
      let instruction = raw.trim();
      if (instruction.length === 0) continue;
      instruction = instruction.replace(
        /\[([A-Za-z_]\w*)\]/gu,
        (_match, name: string) => {
          const address = this.variables.get(name.toLowerCase());
          if (address === undefined)
            throw new Cs486CompileError(
              `unknown inline assembly variable ${name}`,
              line,
            );
          return `[${String(address)}]`;
        },
      );
      const op = /^(\w+)/u.exec(instruction)?.[1]?.toLowerCase();
      if (
        op === undefined ||
        [
          "call",
          "halt",
          "je",
          "jge",
          "jg",
          "jle",
          "jl",
          "jmp",
          "jne",
          "pop",
          "push",
          "ret",
          "syscall",
        ].includes(op) ||
        /\b(?:esp|ebp)\b/iu.test(instruction) ||
        instruction.includes(":")
      )
        throw new Cs486CompileError(
          `unsafe inline assembly instruction: ${instruction}`,
          line,
        );
      try {
        assembleCs486(`${instruction}\nhalt`);
      } catch (error: unknown) {
        throw new Cs486CompileError(
          error instanceof Error ? error.message : String(error),
          line,
        );
      }
      this.emit(instruction);
    }
  }
  private label(prefix: string): string {
    return `${prefix}_${this.nextLabel++}`;
  }
  private emit(...lines_: readonly string[]): void {
    this.assembly.push(...lines_);
  }
}

function lines(source: string): string[] {
  return source.replaceAll("\r\n", "\n").split("\n");
}
function tokenizeExpression(source: string, line: number): string[] {
  const compact = source.replace(/\s/gu, "");
  const tokens = compact.match(/\d+|[A-Za-z_]\w*|[()+*/%-]/gu) ?? [];
  if (tokens.join("") !== compact || tokens.length === 0 || tokens.length > 128)
    throw new Cs486CompileError("invalid or oversized expression", line);
  return tokens;
}
function precedence(operator: string): number {
  return operator === "*" || operator === "/" || operator === "%"
    ? 2
    : operator === "+" || operator === "-"
      ? 1
      : 0;
}
