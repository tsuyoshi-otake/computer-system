import type {
  AssignmentTarget,
  ExceptHandler,
  Expression,
  FunctionDefinition,
  Statement,
} from "../../domain/language/ast.js";
import { LanguageSyntaxError } from "../../domain/language/errors.js";
import { parse } from "../../domain/language/parser.js";
import type { SourceSpan } from "../../domain/language/source.js";
import type {
  CodeObject,
  ExceptionHandlerCode,
  Instruction,
  LoopTarget,
} from "../../domain/runtime/bytecode.js";

export function compileSource(source: string, name = "<module>"): CodeObject {
  const module = parse(source);
  return new Compiler(name).compileStatements(module.body, "module");
}

class Compiler {
  private readonly instructions: Instruction[] = [];
  private readonly loops: LoopTarget[];

  constructor(
    private readonly name: string,
    inheritedLoops: readonly LoopTarget[] = [],
  ) {
    this.loops = [...inheritedLoops];
  }

  compileStatements(
    statements: readonly Statement[],
    kind: CodeObject["kind"] = "block",
  ): CodeObject {
    for (const statement of statements) this.statement(statement);
    const span = statements.at(-1)?.span ?? emptySpan();
    if (kind === "block") {
      this.emit({ op: "END_BLOCK", span });
    } else {
      this.emit({ op: "LOAD_CONST", value: null, span });
      this.emit({ op: "RETURN", span });
    }
    return { name: this.name, kind, instructions: this.instructions };
  }

  private statement(statement: Statement): void {
    switch (statement.kind) {
      case "AssignmentStatement":
        this.assignment(statement.target, statement.value);
        return;
      case "BreakStatement": {
        const loop = this.loops.at(-1);
        if (loop === undefined)
          throw new LanguageSyntaxError("break outside loop", statement.span);
        this.emit({
          op: "LOOP_CONTROL",
          action: "break",
          target: loop,
          span: statement.span,
        });
        return;
      }
      case "ContinueStatement": {
        const loop = this.loops.at(-1);
        if (loop === undefined) {
          throw new LanguageSyntaxError(
            "continue outside loop",
            statement.span,
          );
        }
        this.emit({
          op: "LOOP_CONTROL",
          action: "continue",
          target: loop,
          span: statement.span,
        });
        return;
      }
      case "ExpressionStatement":
        this.expression(statement.expression);
        this.emit({ op: "POP_TOP", span: statement.span });
        return;
      case "ForStatement": {
        this.expression(statement.iterable);
        this.emit({ op: "GET_ITER", span: statement.iterable.span });
        const loopStart = this.instructions.length;
        const exit = this.emitJump("FOR_ITER", statement.span);
        this.emit({
          op: "STORE_NAME",
          name: statement.target.name,
          span: statement.target.span,
        });
        const loop: LoopTarget = { continueTarget: loopStart, breakTarget: -1 };
        this.loops.push(loop);
        for (const child of statement.body) this.statement(child);
        this.loops.pop();
        this.emit({ op: "JUMP", target: loopStart, span: statement.span });
        const end = this.instructions.length;
        this.patch(exit, end);
        loop.breakTarget = end;
        return;
      }
      case "FunctionDefinition":
        this.functionDefinition(statement);
        return;
      case "IfStatement": {
        const exits: number[] = [];
        for (const branch of statement.branches) {
          this.expression(branch.test);
          const next = this.emitJump("JUMP_IF_FALSE", branch.test.span);
          for (const child of branch.body) this.statement(child);
          exits.push(this.emitJump("JUMP", branch.span));
          this.patch(next, this.instructions.length);
        }
        for (const child of statement.elseBody ?? []) this.statement(child);
        const end = this.instructions.length;
        for (const jump of exits) this.patch(jump, end);
        return;
      }
      case "ImportStatement":
        for (const imported of statement.imports) {
          this.emit({
            op: "IMPORT",
            module: imported.module,
            alias: imported.alias ?? imported.module.split(".")[0]!,
            span: imported.span,
          });
        }
        return;
      case "PassStatement":
        return;
      case "RaiseStatement":
        if (statement.value === undefined) {
          this.emit({ op: "LOAD_CONST", value: null, span: statement.span });
        } else {
          this.expression(statement.value);
        }
        this.emit({ op: "RAISE", span: statement.span });
        return;
      case "ReturnStatement":
        if (statement.value === undefined) {
          this.emit({ op: "LOAD_CONST", value: null, span: statement.span });
        } else {
          this.expression(statement.value);
        }
        this.emit({ op: "RETURN", span: statement.span });
        return;
      case "TryStatement": {
        const body = new Compiler(
          `${this.name}:try`,
          this.loops,
        ).compileStatements(statement.body);
        const handlers = statement.handlers.map((handler) =>
          this.exceptionHandler(handler),
        );
        const elseCode =
          statement.elseBody === undefined
            ? undefined
            : new Compiler(`${this.name}:else`, this.loops).compileStatements(
                statement.elseBody,
              );
        const finallyCode =
          statement.finallyBody === undefined
            ? undefined
            : new Compiler(
                `${this.name}:finally`,
                this.loops,
              ).compileStatements(statement.finallyBody);
        this.emit({
          op: "TRY",
          body,
          handlers,
          elseCode,
          finallyCode,
          span: statement.span,
        });
        return;
      }
      case "WhileStatement": {
        const loopStart = this.instructions.length;
        this.expression(statement.test);
        const exit = this.emitJump("JUMP_IF_FALSE", statement.test.span);
        const loop: LoopTarget = { continueTarget: loopStart, breakTarget: -1 };
        this.loops.push(loop);
        for (const child of statement.body) this.statement(child);
        this.loops.pop();
        this.emit({ op: "JUMP", target: loopStart, span: statement.span });
        const end = this.instructions.length;
        this.patch(exit, end);
        loop.breakTarget = end;
        return;
      }
    }
  }

  private assignment(target: AssignmentTarget, value: Expression): void {
    if (target.kind === "IdentifierExpression") {
      this.expression(value);
      this.emit({ op: "STORE_NAME", name: target.name, span: target.span });
    } else if (target.kind === "AttributeExpression") {
      this.expression(target.object);
      this.expression(value);
      this.emit({
        op: "STORE_ATTRIBUTE",
        name: target.attribute,
        span: target.span,
      });
    } else {
      this.expression(target.object);
      this.expression(target.index);
      this.expression(value);
      this.emit({ op: "STORE_SUBSCRIPT", span: target.span });
    }
  }

  private functionDefinition(statement: FunctionDefinition): void {
    const requiredParameters = statement.parameters.findIndex(
      ({ defaultValue }) => defaultValue !== undefined,
    );
    const defaultValues = statement.parameters
      .map(({ defaultValue }) => defaultValue)
      .filter((value): value is Expression => value !== undefined);
    for (const value of defaultValues) this.expression(value);
    const code = new Compiler(statement.name).compileStatements(
      statement.body,
      "function",
    );
    this.emit({
      op: "MAKE_FUNCTION",
      prototype: {
        name: statement.name,
        parameters: statement.parameters.map(({ name }) => name),
        requiredParameters:
          requiredParameters === -1
            ? statement.parameters.length
            : requiredParameters,
        code,
      },
      defaultCount: defaultValues.length,
      span: statement.span,
    });
    this.emit({ op: "STORE_NAME", name: statement.name, span: statement.span });
  }

  private exceptionHandler(handler: ExceptHandler): ExceptionHandlerCode {
    let typeName: string | undefined;
    if (handler.type !== undefined) {
      if (handler.type.kind !== "IdentifierExpression") {
        throw new LanguageSyntaxError(
          "except type must be an exception name",
          handler.type.span,
        );
      }
      typeName = handler.type.name;
    }
    return {
      typeName,
      name: handler.name,
      code: new Compiler(`${this.name}:except`, this.loops).compileStatements(
        handler.body,
      ),
    };
  }

  private expression(expression: Expression): void {
    switch (expression.kind) {
      case "AttributeExpression":
        this.expression(expression.object);
        this.emit({
          op: "LOAD_ATTRIBUTE",
          name: expression.attribute,
          span: expression.span,
        });
        return;
      case "BinaryExpression":
        this.expression(expression.left);
        this.expression(expression.right);
        this.emit({
          op: "BINARY",
          operator: expression.operator,
          span: expression.span,
        });
        return;
      case "BooleanExpression": {
        this.expression(expression.values[0]!);
        const jumps: number[] = [];
        for (const value of expression.values.slice(1)) {
          jumps.push(
            this.emitJump(
              expression.operator === "and"
                ? "JUMP_IF_FALSE_OR_POP"
                : "JUMP_IF_TRUE_OR_POP",
              value.span,
            ),
          );
          this.expression(value);
        }
        const end = this.instructions.length;
        for (const jump of jumps) this.patch(jump, end);
        return;
      }
      case "CallExpression":
        this.expression(expression.callee);
        for (const argument of expression.arguments)
          this.expression(argument.value);
        this.emit({
          op: "CALL",
          argumentNames: expression.arguments.map(({ name }) => name),
          span: expression.span,
        });
        return;
      case "ComparisonExpression":
        this.expression(expression.left);
        for (const comparison of expression.comparisons)
          this.expression(comparison.right);
        this.emit({
          op: "COMPARE_CHAIN",
          operators: expression.comparisons.map(({ operator }) => operator),
          span: expression.span,
        });
        return;
      case "DictionaryExpression":
        for (const entry of expression.entries) {
          this.expression(entry.key);
          this.expression(entry.value);
        }
        this.emit({
          op: "BUILD_DICT",
          count: expression.entries.length,
          span: expression.span,
        });
        return;
      case "FormattedStringExpression":
        for (const part of expression.parts) {
          if (typeof part === "string") {
            this.emit({ op: "LOAD_CONST", value: part, span: expression.span });
          } else {
            this.expression(part);
          }
        }
        this.emit({
          op: "FORMAT",
          count: expression.parts.length,
          span: expression.span,
        });
        return;
      case "IdentifierExpression":
        this.emit({
          op: "LOAD_NAME",
          name: expression.name,
          span: expression.span,
        });
        return;
      case "ListExpression":
      case "TupleExpression":
        for (const element of expression.elements) this.expression(element);
        this.emit({
          op:
            expression.kind === "ListExpression" ? "BUILD_LIST" : "BUILD_TUPLE",
          count: expression.elements.length,
          span: expression.span,
        });
        return;
      case "LiteralExpression":
        this.emit({
          op: "LOAD_CONST",
          value: expression.value,
          span: expression.span,
        });
        return;
      case "SubscriptExpression":
        this.expression(expression.object);
        this.expression(expression.index);
        this.emit({ op: "LOAD_SUBSCRIPT", span: expression.span });
        return;
      case "UnaryExpression":
        this.expression(expression.operand);
        this.emit({
          op: "UNARY",
          operator: expression.operator,
          span: expression.span,
        });
        return;
    }
  }

  private emit(instruction: Instruction): number {
    this.instructions.push(instruction);
    return this.instructions.length - 1;
  }

  private emitJump(
    op:
      | "FOR_ITER"
      | "JUMP"
      | "JUMP_IF_FALSE"
      | "JUMP_IF_FALSE_OR_POP"
      | "JUMP_IF_TRUE_OR_POP",
    span: SourceSpan,
  ): number {
    return this.emit({ op, target: -1, span });
  }

  private patch(index: number, target: number): void {
    const instruction = this.instructions[index];
    if (instruction === undefined || !isPatchableJump(instruction)) {
      throw new Error(`Instruction ${index} is not a patchable jump.`);
    }
    instruction.target = target;
  }
}

function isPatchableJump(
  instruction: Instruction,
): instruction is Extract<Instruction, { target: number }> {
  return (
    instruction.op === "FOR_ITER" ||
    instruction.op === "JUMP" ||
    instruction.op === "JUMP_IF_FALSE" ||
    instruction.op === "JUMP_IF_FALSE_OR_POP" ||
    instruction.op === "JUMP_IF_TRUE_OR_POP"
  );
}

function emptySpan(): SourceSpan {
  const position = { offset: 0, line: 1, column: 1 };
  return { start: position, end: position };
}
