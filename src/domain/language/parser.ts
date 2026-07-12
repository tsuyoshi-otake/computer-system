import type {
  AssignmentStatement,
  AssignmentTarget,
  BinaryExpression,
  BooleanExpression,
  CallArgument,
  ComparisonExpression,
  ComparisonPart,
  DictionaryEntry,
  ExceptHandler,
  Expression,
  FormattedStringPart,
  FunctionDefinition,
  IdentifierExpression,
  IfBranch,
  ImportAlias,
  Module,
  Parameter,
  Statement,
} from "./ast.js";
import { LanguageSyntaxError } from "./errors.js";
import { lex } from "./lexer.js";
import { mergeSpans, type SourceSpan } from "./source.js";
import type { Token, TokenKind } from "./token.js";

export function parse(source: string): Module {
  return new Parser(lex(source)).parseModule();
}

export function parseExpression(source: string): Expression {
  const parser = new Parser(lex(source));
  const expression = parser.expression();
  parser.skipNewlines();
  parser.expect("eof");
  return expression;
}

class Parser {
  private current = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  parseModule(): Module {
    this.skipNewlines();
    const start = this.peek().span;
    const body: Statement[] = [];
    while (!this.check("eof")) {
      body.push(this.statement());
      this.skipNewlines();
    }
    return {
      kind: "Module",
      body,
      span: mergeSpans(start, this.peek().span),
    };
  }

  expression(): Expression {
    return this.tupleExpression();
  }

  skipNewlines(): void {
    while (this.match("newline")) {
      // Skip blank logical lines.
    }
  }

  expect(kind: TokenKind, lexeme?: string): Token {
    if (this.check(kind, lexeme)) return this.advance();
    const expected = lexeme === undefined ? kind : `${kind} ${lexeme}`;
    throw this.error(this.peek(), `Expected ${expected}`);
  }

  private statement(): Statement {
    if (this.checkLexeme("if")) return this.ifStatement();
    if (this.checkLexeme("while")) return this.whileStatement();
    if (this.checkLexeme("for")) return this.forStatement();
    if (this.checkLexeme("def")) return this.functionDefinition();
    if (this.checkLexeme("try")) return this.tryStatement();
    return this.simpleStatement();
  }

  private simpleStatement(): Statement {
    const start = this.peek();
    if (this.matchLexeme("return")) {
      const value = this.check("newline") ? undefined : this.expression();
      const end = this.expect("newline");
      return { kind: "ReturnStatement", value, span: this.span(start, end) };
    }
    if (this.matchLexeme("raise")) {
      const value = this.check("newline") ? undefined : this.expression();
      const end = this.expect("newline");
      return { kind: "RaiseStatement", value, span: this.span(start, end) };
    }
    if (this.matchLexeme("break")) {
      const end = this.expect("newline");
      return { kind: "BreakStatement", span: this.span(start, end) };
    }
    if (this.matchLexeme("continue")) {
      const end = this.expect("newline");
      return { kind: "ContinueStatement", span: this.span(start, end) };
    }
    if (this.matchLexeme("pass")) {
      const end = this.expect("newline");
      return { kind: "PassStatement", span: this.span(start, end) };
    }
    if (this.matchLexeme("import")) return this.importStatement(start);

    const expression = this.expression();
    if (this.matchLexeme("=")) {
      if (!isAssignmentTarget(expression)) {
        throw new LanguageSyntaxError(
          "Invalid assignment target",
          expression.span,
        );
      }
      const value = this.expression();
      const end = this.expect("newline");
      const assignment: AssignmentStatement = {
        kind: "AssignmentStatement",
        target: expression,
        value,
        span: this.span(start, end),
      };
      return assignment;
    }
    const end = this.expect("newline");
    return {
      kind: "ExpressionStatement",
      expression,
      span: this.span(start, end),
    };
  }

  private importStatement(start: Token): Statement {
    const imports: ImportAlias[] = [];
    do {
      const first = this.expect("identifier");
      let module = first.lexeme;
      while (this.matchLexeme(".")) {
        module += `.${this.expect("identifier").lexeme}`;
      }
      let alias: string | undefined;
      if (this.matchLexeme("as")) alias = this.expect("identifier").lexeme;
      imports.push({ module, alias, span: first.span });
    } while (this.matchLexeme(","));
    const end = this.expect("newline");
    return { kind: "ImportStatement", imports, span: this.span(start, end) };
  }

  private ifStatement(): Statement {
    const start = this.expect("keyword", "if");
    const branches: IfBranch[] = [];
    let test = this.expression();
    let body = this.suite();
    branches.push({
      test,
      body,
      span: mergeSpans(test.span, body.at(-1)?.span ?? test.span),
    });
    while (this.matchLexeme("elif")) {
      test = this.expression();
      body = this.suite();
      branches.push({
        test,
        body,
        span: mergeSpans(test.span, body.at(-1)?.span ?? test.span),
      });
    }
    let elseBody: readonly Statement[] | undefined;
    if (this.matchLexeme("else")) elseBody = this.suite();
    const last = elseBody?.at(-1)?.span ?? branches.at(-1)?.span ?? start.span;
    return {
      kind: "IfStatement",
      branches,
      elseBody,
      span: mergeSpans(start.span, last),
    };
  }

  private whileStatement(): Statement {
    const start = this.expect("keyword", "while");
    const test = this.expression();
    const body = this.suite();
    return {
      kind: "WhileStatement",
      test,
      body,
      span: mergeSpans(start.span, body.at(-1)?.span ?? test.span),
    };
  }

  private forStatement(): Statement {
    const start = this.expect("keyword", "for");
    const targetToken = this.expect("identifier");
    const target: IdentifierExpression = {
      kind: "IdentifierExpression",
      name: targetToken.lexeme,
      span: targetToken.span,
    };
    this.expect("keyword", "in");
    const iterable = this.expression();
    const body = this.suite();
    return {
      kind: "ForStatement",
      target,
      iterable,
      body,
      span: mergeSpans(start.span, body.at(-1)?.span ?? iterable.span),
    };
  }

  private functionDefinition(): FunctionDefinition {
    const start = this.expect("keyword", "def");
    const name = this.expect("identifier").lexeme;
    this.expect("operator", "(");
    const parameters: Parameter[] = [];
    let sawDefault = false;
    if (!this.checkLexeme(")")) {
      do {
        const token = this.expect("identifier");
        let defaultValue: Expression | undefined;
        if (this.matchLexeme("=")) {
          sawDefault = true;
          defaultValue = this.orExpression();
        } else if (sawDefault) {
          throw this.error(
            token,
            "A required parameter cannot follow a default parameter",
          );
        }
        parameters.push({ name: token.lexeme, defaultValue, span: token.span });
      } while (this.matchLexeme(",") && !this.checkLexeme(")"));
    }
    this.expect("operator", ")");
    const body = this.suite();
    return {
      kind: "FunctionDefinition",
      name,
      parameters,
      body,
      span: mergeSpans(start.span, body.at(-1)?.span ?? start.span),
    };
  }

  private tryStatement(): Statement {
    const start = this.expect("keyword", "try");
    const body = this.suite();
    const handlers: ExceptHandler[] = [];
    while (this.matchLexeme("except")) {
      const exceptToken = this.previous();
      const type = this.checkLexeme(":") ? undefined : this.expression();
      let name: string | undefined;
      if (this.matchLexeme("as")) name = this.expect("identifier").lexeme;
      const handlerBody = this.suite();
      handlers.push({
        type,
        name,
        body: handlerBody,
        span: mergeSpans(
          exceptToken.span,
          handlerBody.at(-1)?.span ?? exceptToken.span,
        ),
      });
    }
    let elseBody: readonly Statement[] | undefined;
    if (this.matchLexeme("else")) elseBody = this.suite();
    let finallyBody: readonly Statement[] | undefined;
    if (this.matchLexeme("finally")) finallyBody = this.suite();
    if (handlers.length === 0 && finallyBody === undefined) {
      throw this.error(start, "try requires except or finally");
    }
    const end =
      finallyBody?.at(-1)?.span ??
      elseBody?.at(-1)?.span ??
      handlers.at(-1)?.span ??
      body.at(-1)?.span ??
      start.span;
    return {
      kind: "TryStatement",
      body,
      handlers,
      elseBody,
      finallyBody,
      span: mergeSpans(start.span, end),
    };
  }

  private suite(): readonly Statement[] {
    this.expect("operator", ":");
    this.expect("newline");
    this.expect("indent");
    const body: Statement[] = [];
    this.skipNewlines();
    while (!this.check("dedent") && !this.check("eof")) {
      body.push(this.statement());
      this.skipNewlines();
    }
    this.expect("dedent");
    if (body.length === 0)
      throw this.error(this.previous(), "Expected an indented block");
    return body;
  }

  private tupleExpression(): Expression {
    const first = this.orExpression();
    if (!this.matchLexeme(",")) return first;
    const elements = [first];
    while (!this.checkExpressionTerminator()) {
      elements.push(this.orExpression());
      if (!this.matchLexeme(",")) break;
    }
    return {
      kind: "TupleExpression",
      elements,
      span: mergeSpans(first.span, elements.at(-1)?.span ?? first.span),
    };
  }

  private orExpression(): Expression {
    return this.booleanChain("or", () => this.andExpression());
  }

  private andExpression(): Expression {
    return this.booleanChain("and", () => this.notExpression());
  }

  private booleanChain(
    operator: "and" | "or",
    operand: () => Expression,
  ): Expression {
    const first = operand();
    if (!this.matchLexeme(operator)) return first;
    const values = [first, operand()];
    while (this.matchLexeme(operator)) values.push(operand());
    const expression: BooleanExpression = {
      kind: "BooleanExpression",
      operator,
      values,
      span: mergeSpans(first.span, values.at(-1)?.span ?? first.span),
    };
    return expression;
  }

  private notExpression(): Expression {
    if (this.matchLexeme("not")) {
      const operator = this.previous();
      const operand = this.notExpression();
      return {
        kind: "UnaryExpression",
        operator: "not",
        operand,
        span: mergeSpans(operator.span, operand.span),
      };
    }
    return this.comparisonExpression();
  }

  private comparisonExpression(): Expression {
    const left = this.additiveExpression();
    const comparisons: ComparisonPart[] = [];
    while (true) {
      const start = this.peek();
      let operator: ComparisonPart["operator"] | undefined;
      if (["==", "!=", "<", "<=", ">", ">=", "in"].includes(start.lexeme)) {
        operator = this.advance().lexeme as ComparisonPart["operator"];
      } else if (this.matchLexeme("is")) {
        operator = this.matchLexeme("not") ? "is not" : "is";
      } else if (this.checkLexeme("not") && this.peek(1).lexeme === "in") {
        this.advance();
        this.advance();
        operator = "not in";
      }
      if (operator === undefined) break;
      const right = this.additiveExpression();
      comparisons.push({
        operator,
        right,
        span: mergeSpans(start.span, right.span),
      });
    }
    if (comparisons.length === 0) return left;
    const expression: ComparisonExpression = {
      kind: "ComparisonExpression",
      left,
      comparisons,
      span: mergeSpans(left.span, comparisons.at(-1)?.span ?? left.span),
    };
    return expression;
  }

  private additiveExpression(): Expression {
    return this.binaryLeft(() => this.multiplicativeExpression(), ["+", "-"]);
  }

  private multiplicativeExpression(): Expression {
    return this.binaryLeft(() => this.unaryExpression(), ["*", "/", "//", "%"]);
  }

  private binaryLeft(
    operand: () => Expression,
    operators: readonly BinaryExpression["operator"][],
  ): Expression {
    let expression = operand();
    while (
      operators.includes(this.peek().lexeme as BinaryExpression["operator"])
    ) {
      const operator = this.advance().lexeme as BinaryExpression["operator"];
      const right = operand();
      expression = {
        kind: "BinaryExpression",
        operator,
        left: expression,
        right,
        span: mergeSpans(expression.span, right.span),
      };
    }
    return expression;
  }

  private unaryExpression(): Expression {
    if (this.matchLexeme("+") || this.matchLexeme("-")) {
      const operator = this.previous();
      const operand = this.unaryExpression();
      return {
        kind: "UnaryExpression",
        operator: operator.lexeme as "+" | "-",
        operand,
        span: mergeSpans(operator.span, operand.span),
      };
    }
    return this.powerExpression();
  }

  private powerExpression(): Expression {
    let left = this.postfixExpression();
    if (this.matchLexeme("**")) {
      const right = this.unaryExpression();
      left = {
        kind: "BinaryExpression",
        operator: "**",
        left,
        right,
        span: mergeSpans(left.span, right.span),
      };
    }
    return left;
  }

  private postfixExpression(): Expression {
    let expression = this.primaryExpression();
    while (true) {
      if (this.matchLexeme("(")) {
        const arguments_: CallArgument[] = [];
        let sawKeyword = false;
        if (!this.checkLexeme(")")) {
          do {
            const start = this.peek();
            let name: string | undefined;
            if (this.check("identifier") && this.peek(1).lexeme === "=") {
              name = this.advance().lexeme;
              this.advance();
              sawKeyword = true;
            } else if (sawKeyword) {
              throw this.error(
                start,
                "Positional argument follows keyword argument",
              );
            }
            const value = this.orExpression();
            arguments_.push({
              name,
              value,
              span: mergeSpans(start.span, value.span),
            });
          } while (this.matchLexeme(",") && !this.checkLexeme(")"));
        }
        const close = this.expect("operator", ")");
        expression = {
          kind: "CallExpression",
          callee: expression,
          arguments: arguments_,
          span: mergeSpans(expression.span, close.span),
        };
      } else if (this.matchLexeme("[")) {
        const index = this.expression();
        const close = this.expect("operator", "]");
        expression = {
          kind: "SubscriptExpression",
          object: expression,
          index,
          span: mergeSpans(expression.span, close.span),
        };
      } else if (this.matchLexeme(".")) {
        const attribute = this.expect("identifier");
        expression = {
          kind: "AttributeExpression",
          object: expression,
          attribute: attribute.lexeme,
          span: mergeSpans(expression.span, attribute.span),
        };
      } else {
        break;
      }
    }
    return expression;
  }

  private primaryExpression(): Expression {
    const token = this.advance();
    if (token.kind === "number" || token.kind === "string") {
      return {
        kind: "LiteralExpression",
        value: token.literal ?? null,
        span: token.span,
      };
    }
    if (["True", "False", "None"].includes(token.lexeme)) {
      return {
        kind: "LiteralExpression",
        value: token.literal ?? null,
        span: token.span,
      };
    }
    if (token.kind === "identifier") {
      return {
        kind: "IdentifierExpression",
        name: token.lexeme,
        span: token.span,
      };
    }
    if (token.kind === "formatted_string") return this.formattedString(token);
    if (token.lexeme === "[") return this.listExpression(token);
    if (token.lexeme === "{") return this.dictionaryExpression(token);
    if (token.lexeme === "(") return this.parenthesizedExpression(token);
    throw this.error(token, "Expected an expression");
  }

  private listExpression(open: Token): Expression {
    const elements: Expression[] = [];
    if (!this.checkLexeme("]")) {
      do {
        elements.push(this.orExpression());
      } while (this.matchLexeme(",") && !this.checkLexeme("]"));
    }
    const close = this.expect("operator", "]");
    return { kind: "ListExpression", elements, span: this.span(open, close) };
  }

  private dictionaryExpression(open: Token): Expression {
    const entries: DictionaryEntry[] = [];
    if (!this.checkLexeme("}")) {
      do {
        const key = this.orExpression();
        this.expect("operator", ":");
        const value = this.orExpression();
        entries.push({ key, value, span: mergeSpans(key.span, value.span) });
      } while (this.matchLexeme(",") && !this.checkLexeme("}"));
    }
    const close = this.expect("operator", "}");
    return {
      kind: "DictionaryExpression",
      entries,
      span: this.span(open, close),
    };
  }

  private parenthesizedExpression(open: Token): Expression {
    if (this.matchLexeme(")")) {
      return {
        kind: "TupleExpression",
        elements: [],
        span: this.span(open, this.previous()),
      };
    }
    const expression = this.expression();
    const close = this.expect("operator", ")");
    if (expression.kind === "TupleExpression") {
      return { ...expression, span: this.span(open, close) };
    }
    return expression;
  }

  private formattedString(token: Token): Expression {
    const template = String(token.literal ?? "");
    const parts: FormattedStringPart[] = [];
    let text = "";
    for (let index = 0; index < template.length; index += 1) {
      const character = template[index];
      if (character === "{" && template[index + 1] === "{") {
        text += "{";
        index += 1;
      } else if (character === "}" && template[index + 1] === "}") {
        text += "}";
        index += 1;
      } else if (character === "{") {
        if (text !== "") parts.push(text);
        text = "";
        const close = template.indexOf("}", index + 1);
        if (close === -1)
          throw this.error(token, "Unclosed formatted string expression");
        const embedded = template.slice(index + 1, close).trim();
        if (embedded === "")
          throw this.error(token, "Empty formatted string expression");
        parts.push(parseExpression(embedded));
        index = close;
      } else if (character === "}") {
        throw this.error(token, "Unmatched closing brace in formatted string");
      } else {
        text += character;
      }
    }
    if (text !== "") parts.push(text);
    return { kind: "FormattedStringExpression", parts, span: token.span };
  }

  private checkExpressionTerminator(): boolean {
    return (
      [")", "]", "}", ":", "\n"].includes(this.peek().lexeme) ||
      this.check("eof")
    );
  }

  private match(kind: TokenKind, lexeme?: string): boolean {
    if (!this.check(kind, lexeme)) return false;
    this.advance();
    return true;
  }

  private matchLexeme(lexeme: string): boolean {
    if (!this.checkLexeme(lexeme)) return false;
    this.advance();
    return true;
  }

  private check(kind: TokenKind, lexeme?: string): boolean {
    const token = this.peek();
    return (
      token.kind === kind && (lexeme === undefined || token.lexeme === lexeme)
    );
  }

  private checkLexeme(lexeme: string): boolean {
    return this.peek().lexeme === lexeme;
  }

  private advance(): Token {
    const token = this.peek();
    if (token.kind !== "eof") this.current += 1;
    return token;
  }

  private peek(distance = 0): Token {
    return this.tokens[
      Math.min(this.current + distance, this.tokens.length - 1)
    ]!;
  }

  private previous(): Token {
    return this.tokens[Math.max(0, this.current - 1)]!;
  }

  private span(first: Token, last: Token): SourceSpan {
    return mergeSpans(first.span, last.span);
  }

  private error(token: Token, message: string): LanguageSyntaxError {
    return new LanguageSyntaxError(message, token.span);
  }
}

function isAssignmentTarget(
  expression: Expression,
): expression is AssignmentTarget {
  return [
    "AttributeExpression",
    "IdentifierExpression",
    "SubscriptExpression",
  ].includes(expression.kind);
}
