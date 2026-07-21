import type {
  AnnotatedAssignmentStatement,
  AttributeExpression,
  AssertStatement,
  AssignmentStatement,
  AssignmentTarget,
  AugmentedAssignmentStatement,
  AwaitExpression,
  BinaryExpression,
  BooleanExpression,
  CallArgument,
  ClassDefinition,
  ComprehensionClause,
  ComprehensionExpression,
  ComparisonExpression,
  ComparisonPart,
  ConditionalExpression,
  DictionaryEntry,
  DeletionTarget,
  ExceptHandler,
  Expression,
  FormattedStringPart,
  FromImportAlias,
  FromImportStatement,
  FunctionDefinition,
  IdentifierExpression,
  IfBranch,
  ImportAlias,
  LambdaExpression,
  MappingPatternEntry,
  MatchCase,
  MatchStatement,
  Module,
  NamedExpression,
  NameDeclaration,
  Parameter,
  Pattern,
  ClassPatternKeyword,
  SliceExpression,
  SetExpression,
  StarredExpression,
  Statement,
  SubscriptExpression,
  TemplateStringExpression,
  TemplateStringInterpolation,
  TypeAliasStatement,
  TypeParameter,
  YieldExpression,
  WithItem,
  WithStatement,
} from "./ast.js";
import { LanguageSyntaxError } from "./errors.js";
import { lex } from "./lexer.js";
import {
  resolveLanguageFrontendLimits,
  type LanguageFrontendLimitOverrides,
  type LanguageFrontendLimits,
} from "./limits.js";
import { mergeSpans, type SourceSpan } from "./source.js";
import type { Token, TokenKind } from "./token.js";

export function parse(
  source: string,
  limitOverrides: LanguageFrontendLimitOverrides = {},
): Module {
  const limits = resolveLanguageFrontendLimits(limitOverrides);
  return new Parser(
    lex(source, limits.lexer),
    limits,
    createBudget(),
  ).parseModule();
}

export function parseExpression(
  source: string,
  limitOverrides: LanguageFrontendLimitOverrides = {},
): Expression {
  const limits = resolveLanguageFrontendLimits(limitOverrides);
  return new Parser(
    lex(source, limits.lexer),
    limits,
    createBudget(),
  ).parseStandaloneExpression();
}

interface ParserBudget {
  statements: number;
  blockNesting: number;
  expressionNesting: number;
  formattedStringExpressions: number;
}

function createBudget(): ParserBudget {
  return {
    statements: 0,
    blockNesting: 0,
    expressionNesting: 0,
    formattedStringExpressions: 0,
  };
}

type ExceptStarControlTransfer = Extract<
  Statement,
  {
    readonly kind: "BreakStatement" | "ContinueStatement" | "ReturnStatement";
  }
>;

function findExceptStarControlTransfer(
  statements: readonly Statement[],
): ExceptStarControlTransfer | undefined {
  for (const statement of statements) {
    if (
      statement.kind === "BreakStatement" ||
      statement.kind === "ContinueStatement" ||
      statement.kind === "ReturnStatement"
    ) {
      return statement;
    }
    let nested: readonly (readonly Statement[])[] = [];
    switch (statement.kind) {
      case "ClassDefinition":
      case "FunctionDefinition":
        continue;
      case "ForStatement":
      case "WhileStatement":
      case "WithStatement":
        nested = [statement.body];
        break;
      case "IfStatement":
        nested = [
          ...statement.branches.map((branch) => branch.body),
          ...(statement.elseBody === undefined ? [] : [statement.elseBody]),
        ];
        break;
      case "MatchStatement":
        nested = statement.cases.map((matchCase) => matchCase.body);
        break;
      case "TryStatement":
        nested = [
          statement.body,
          ...statement.handlers.map((handler) => handler.body),
          ...(statement.elseBody === undefined ? [] : [statement.elseBody]),
          ...(statement.finallyBody === undefined
            ? []
            : [statement.finallyBody]),
        ];
        break;
      default:
        break;
    }
    for (const body of nested) {
      const forbidden = findExceptStarControlTransfer(body);
      if (forbidden !== undefined) return forbidden;
    }
  }
  return undefined;
}

function exceptStarControlName(
  kind: ExceptStarControlTransfer["kind"],
): "break" | "continue" | "return" {
  switch (kind) {
    case "BreakStatement":
      return "break";
    case "ContinueStatement":
      return "continue";
    case "ReturnStatement":
      return "return";
  }
}

class Parser {
  private current = 0;
  private parsingComprehensionTarget = false;

  constructor(
    private readonly tokens: readonly Token[],
    private readonly limits: LanguageFrontendLimits,
    private readonly budget: ParserBudget,
  ) {}

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

  parseStandaloneExpression(): Expression {
    const expression = this.expression();
    this.skipNewlines();
    this.expect("eof");
    return expression;
  }

  expression(allowNamedExpression = false): Expression {
    return this.withExpressionNesting(() =>
      this.tupleExpression(allowNamedExpression),
    );
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
    if (this.budget.statements >= this.limits.parser.maxStatements) {
      throw this.error(
        this.peek(),
        `Statement limit exceeded (max ${this.limits.parser.maxStatements})`,
      );
    }
    this.budget.statements += 1;
    if (this.checkLexeme("@")) return this.decoratedDefinition();
    if (this.checkLexeme("async")) return this.asyncStatement();
    if (this.checkLexeme("if")) return this.ifStatement();
    if (this.checkLexeme("while")) return this.whileStatement();
    if (this.checkLexeme("for")) return this.forStatement();
    if (this.checkLexeme("class")) return this.classDefinition();
    if (this.checkLexeme("def")) return this.functionDefinition();
    if (this.checkLexeme("try")) return this.tryStatement();
    if (this.checkLexeme("with")) return this.withStatement();
    if (this.checkMatchStatementStart()) return this.matchStatement();
    return this.simpleStatement();
  }

  private asyncStatement(): Statement {
    const start = this.expect("keyword", "async");
    if (this.checkLexeme("def"))
      return this.functionDefinition([], start, true);
    if (this.checkLexeme("for")) return this.forStatement(start, true);
    if (this.checkLexeme("with")) return this.withStatement(start, true);
    throw this.error(
      this.peek(),
      "async must be followed by def, for, or with",
    );
  }

  private checkMatchStatementStart(): boolean {
    if (!this.check("identifier", "match")) return false;
    let nesting = 0;
    for (let distance = 1; ; distance += 1) {
      const token = this.peek(distance);
      if (token.kind === "eof" || token.kind === "newline") return false;
      if (["(", "[", "{"].includes(token.lexeme)) {
        nesting += 1;
        continue;
      }
      if ([")", "]", "}"].includes(token.lexeme)) {
        nesting -= 1;
        continue;
      }
      if (token.lexeme === ":" && nesting === 0) return distance > 1;
    }
  }

  private simpleStatement(): Statement {
    const start = this.peek();
    if (this.checkTypeAliasStatementStart()) {
      return this.typeAliasStatement();
    }
    if (this.matchLexeme("assert")) {
      const test = this.conditionalOrLambdaExpression();
      const message = this.matchLexeme(",")
        ? this.conditionalOrLambdaExpression()
        : undefined;
      const end = this.expect("newline");
      return {
        kind: "AssertStatement",
        test,
        message,
        span: this.span(start, end),
      } satisfies AssertStatement;
    }
    if (this.checkLexeme("yield")) {
      const yielded = this.yieldExpression();
      const end = this.expect("newline");
      return {
        delegate: yielded.delegate,
        kind: "YieldStatement",
        value: yielded.value,
        span: this.span(start, end),
      };
    }
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
    if (this.matchLexeme("del")) {
      const target = this.expression();
      if (!isDeletionTarget(target)) {
        throw new LanguageSyntaxError("Invalid deletion target", target.span);
      }
      const end = this.expect("newline");
      return {
        kind: "DeleteStatement",
        target,
        span: this.span(start, end),
      };
    }
    if (this.matchLexeme("global")) {
      return this.nameDeclarationStatement(start, "GlobalStatement");
    }
    if (this.matchLexeme("nonlocal")) {
      return this.nameDeclarationStatement(start, "NonlocalStatement");
    }
    if (this.matchLexeme("import")) return this.importStatement(start);
    if (this.matchLexeme("from")) return this.fromImportStatement(start);

    const expression = this.expression();
    if (this.matchLexeme(":")) {
      if (!isAnnotatedAssignmentTarget(expression)) {
        throw new LanguageSyntaxError(
          "Invalid annotated assignment target",
          expression.span,
        );
      }
      const annotation = this.annotationExpression();
      const value = this.matchLexeme("=")
        ? this.assignmentValueExpression()
        : undefined;
      const end = this.expect("newline");
      return {
        annotation,
        kind: "AnnotatedAssignmentStatement",
        simpleTarget:
          start.kind === "identifier" &&
          expression.kind === "IdentifierExpression" &&
          start.span.start.offset === expression.span.start.offset,
        target: expression,
        value,
        span: this.span(start, end),
      } satisfies AnnotatedAssignmentStatement;
    }
    if (isAugmentedAssignmentOperator(this.peek().lexeme)) {
      const operator = this.advance();
      if (!isAugmentedAssignmentTarget(expression)) {
        throw new LanguageSyntaxError(
          "Invalid augmented assignment target",
          expression.span,
        );
      }
      const value = this.expression();
      const end = this.expect("newline");
      const assignment: AugmentedAssignmentStatement = {
        kind: "AugmentedAssignmentStatement",
        target: expression,
        operator: operator.lexeme.slice(0, -1) as BinaryExpression["operator"],
        value,
        span: this.span(start, end),
      };
      return assignment;
    }
    if (this.matchLexeme("=")) {
      if (!isAssignmentTarget(expression)) {
        throw new LanguageSyntaxError(
          "Invalid assignment target",
          expression.span,
        );
      }
      const targets: AssignmentTarget[] = [expression];
      let value = this.assignmentValueExpression();
      while (this.matchLexeme("=")) {
        if (!isAssignmentTarget(value)) {
          throw new LanguageSyntaxError(
            "Invalid assignment target",
            value.span,
          );
        }
        targets.push(value);
        value = this.assignmentValueExpression();
      }
      const end = this.expect("newline");
      const assignment: AssignmentStatement = {
        kind: "AssignmentStatement",
        targets,
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

  private nameDeclarationStatement(
    start: Token,
    kind: "GlobalStatement" | "NonlocalStatement",
  ): Statement {
    const names: NameDeclaration[] = [];
    do {
      const token = this.expect("identifier");
      this.pushConstructItem(
        names,
        { name: identifierName(token), span: token.span },
        token,
      );
    } while (this.matchLexeme(","));
    const end = this.expect("newline");
    return { kind, names, span: this.span(start, end) };
  }

  private importStatement(start: Token): Statement {
    const imports: ImportAlias[] = [];
    do {
      const first = this.expect("identifier");
      let module = identifierName(first);
      while (this.matchLexeme(".")) {
        module += `.${identifierName(this.expect("identifier"))}`;
      }
      let alias: string | undefined;
      if (this.matchLexeme("as")) {
        alias = identifierName(this.expect("identifier"));
      }
      this.pushConstructItem(
        imports,
        { module, alias, span: first.span },
        first,
      );
    } while (this.matchLexeme(","));
    const end = this.expect("newline");
    return { kind: "ImportStatement", imports, span: this.span(start, end) };
  }

  private fromImportStatement(start: Token): FromImportStatement {
    let level = 0;
    while (this.matchLexeme(".")) level += 1;

    let module: string | undefined;
    if (this.check("identifier")) {
      module = identifierName(this.advance());
      while (this.matchLexeme(".")) {
        module += `.${identifierName(this.expect("identifier"))}`;
      }
    } else if (level === 0) {
      throw this.error(this.peek(), "Expected module name after from");
    }

    this.expect("keyword", "import");
    if (this.matchLexeme("*")) {
      const end = this.expect("newline");
      return {
        imports: [],
        kind: "FromImportStatement",
        level,
        module,
        span: this.span(start, end),
        wildcard: true,
      };
    }

    const parenthesized = this.matchLexeme("(");
    const imports: FromImportAlias[] = [];
    for (;;) {
      const nameToken = this.expect("identifier");
      const name = identifierName(nameToken);
      let alias: string | undefined;
      if (this.matchLexeme("as")) {
        alias = identifierName(this.expect("identifier"));
      }
      this.pushConstructItem(
        imports,
        { alias, name, span: nameToken.span },
        nameToken,
      );
      if (!this.matchLexeme(",")) break;
      if (parenthesized && this.checkLexeme(")")) break;
      if (!parenthesized && this.check("newline")) {
        throw this.error(
          this.peek(),
          "Trailing import comma requires parentheses",
        );
      }
    }
    if (parenthesized) this.expect("operator", ")");
    const end = this.expect("newline");
    return {
      imports,
      kind: "FromImportStatement",
      level,
      module,
      span: this.span(start, end),
      wildcard: false,
    };
  }

  private ifStatement(): Statement {
    const start = this.expect("keyword", "if");
    const branches: IfBranch[] = [];
    let test = this.expression(true);
    let body = this.suite();
    this.pushConstructItem(
      branches,
      {
        test,
        body,
        span: mergeSpans(test.span, body.at(-1)?.span ?? test.span),
      },
      start,
    );
    while (this.matchLexeme("elif")) {
      test = this.expression(true);
      body = this.suite();
      this.pushConstructItem(
        branches,
        {
          test,
          body,
          span: mergeSpans(test.span, body.at(-1)?.span ?? test.span),
        },
        this.previous(),
      );
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

  private matchStatement(): MatchStatement {
    const start = this.expect("identifier", "match");
    const subject = this.expression(true);
    const cases = this.withBlockNesting(() => {
      this.expect("operator", ":");
      this.expect("newline");
      this.expect("indent");
      const clauses: MatchCase[] = [];
      this.skipNewlines();
      while (!this.check("dedent") && !this.check("eof")) {
        const caseStart = this.expect("identifier", "case");
        const pattern = this.pattern();
        validatePatternCaptures(pattern);
        const guard = this.matchLexeme("if")
          ? this.expression(true)
          : undefined;
        const body = this.suite();
        this.pushConstructItem(
          clauses,
          {
            body,
            guard,
            pattern,
            span: mergeSpans(caseStart.span, body.at(-1)?.span ?? pattern.span),
          },
          caseStart,
        );
        this.skipNewlines();
      }
      this.expect("dedent");
      if (clauses.length === 0) {
        throw this.error(start, "Expected at least one case block");
      }
      for (let index = 0; index < clauses.length - 1; index += 1) {
        const clause = clauses[index]!;
        if (
          clause.guard === undefined &&
          isIrrefutablePattern(clause.pattern)
        ) {
          throw new LanguageSyntaxError(
            "Irrefutable case must be last",
            clause.pattern.span,
          );
        }
      }
      return clauses;
    });
    return {
      cases,
      kind: "MatchStatement",
      span: mergeSpans(start.span, cases.at(-1)?.span ?? subject.span),
      subject,
    };
  }

  private pattern(): Pattern {
    return this.withExpressionNesting(() => this.patternInternal());
  }

  private patternInternal(): Pattern {
    const alternatives: Pattern[] = [this.closedPattern()];
    while (this.matchLexeme("|")) {
      this.pushConstructItem(
        alternatives,
        this.closedPattern(),
        this.previous(),
      );
    }
    let pattern: Pattern =
      alternatives.length === 1
        ? alternatives[0]!
        : {
            alternatives,
            kind: "OrPattern",
            span: mergeSpans(alternatives[0]!.span, alternatives.at(-1)!.span),
          };
    if (this.matchLexeme("as")) {
      const name = this.expect("identifier");
      const captureName = identifierName(name);
      if (captureName === "_") {
        throw this.error(
          name,
          "Wildcard cannot be used as an as-pattern target",
        );
      }
      pattern = {
        kind: "AsPattern",
        name: captureName,
        pattern,
        span: mergeSpans(pattern.span, name.span),
      };
    }
    return pattern;
  }

  private closedPattern(): Pattern {
    const token = this.peek();
    if (this.matchLexeme("[")) return this.sequencePattern(token, "]");
    if (this.matchLexeme("(")) {
      if (this.matchLexeme(")")) {
        return {
          elements: [],
          kind: "SequencePattern",
          span: this.span(token, this.previous()),
        };
      }
      if (this.checkLexeme("*")) return this.sequencePattern(token, ")");
      const first = this.pattern();
      if (!this.matchLexeme(",")) {
        this.expect("operator", ")");
        return first;
      }
      return this.sequencePattern(token, ")", first);
    }
    if (this.matchLexeme("{")) return this.mappingPattern(token);
    if (this.matchLexeme("*")) {
      throw this.error(
        token,
        "Star pattern is only allowed in a sequence pattern",
      );
    }
    if (this.matchLexeme("+") || this.matchLexeme("-")) {
      const operator = this.previous();
      const number = this.expect("number");
      if (
        typeof number.literal !== "number" &&
        typeof number.literal !== "bigint"
      ) {
        throw this.error(number, "Expected a numeric literal pattern");
      }
      return {
        kind: "LiteralPattern",
        span: mergeSpans(operator.span, number.span),
        value:
          operator.lexeme === "-"
            ? typeof number.literal === "bigint"
              ? -number.literal
              : -number.literal
            : number.literal,
      };
    }
    if (token.kind === "number" || token.kind === "string") {
      this.advance();
      return {
        kind: "LiteralPattern",
        span: token.span,
        value: token.literal as bigint | number | string,
      };
    }
    if (["True", "False", "None"].includes(token.lexeme)) {
      this.advance();
      return {
        kind: "LiteralPattern",
        span: token.span,
        value: token.literal as boolean | null,
      };
    }
    if (token.kind !== "identifier") {
      throw this.error(token, "Expected a pattern");
    }
    this.advance();
    const name = identifierName(token);
    if (name === "_") return { kind: "WildcardPattern", span: token.span };
    let value: Expression = {
      kind: "IdentifierExpression",
      name,
      span: token.span,
    };
    let dotted = false;
    while (this.matchLexeme(".")) {
      dotted = true;
      const attribute = this.expect("identifier");
      value = {
        attribute: identifierName(attribute),
        kind: "AttributeExpression",
        object: value,
        span: mergeSpans(value.span, attribute.span),
      };
    }
    if (this.matchLexeme("(")) return this.classPattern(value, token);
    if (dotted) return { kind: "ValuePattern", span: value.span, value };
    return { kind: "CapturePattern", name, span: token.span };
  }

  private sequencePattern(
    open: Token,
    terminator: "]" | ")",
    first?: Pattern,
  ): Pattern {
    const elements: Pattern[] = first === undefined ? [] : [first];
    let starred = 0;
    while (!this.checkLexeme(terminator)) {
      const itemStart = this.peek();
      let element: Pattern;
      if (this.matchLexeme("*")) {
        starred += 1;
        if (starred > 1) {
          throw this.error(
            itemStart,
            "Multiple star patterns in sequence pattern",
          );
        }
        const target = this.expect("identifier");
        const name = identifierName(target);
        element = {
          kind: "StarPattern",
          name: name === "_" ? undefined : name,
          span: mergeSpans(itemStart.span, target.span),
        };
      } else {
        element = this.pattern();
      }
      this.pushConstructItem(elements, element, itemStart);
      if (!this.matchLexeme(",")) break;
    }
    const close = this.expect("operator", terminator);
    return {
      elements,
      kind: "SequencePattern",
      span: this.span(open, close),
    };
  }

  private mappingPattern(open: Token): Pattern {
    const entries: MappingPatternEntry[] = [];
    const literalKeys = new Set<string>();
    let rest: string | undefined;
    while (!this.checkLexeme("}")) {
      const entryStart = this.peek();
      if (this.matchLexeme("**")) {
        if (rest !== undefined) {
          throw this.error(
            entryStart,
            "Multiple rest patterns in mapping pattern",
          );
        }
        const target = this.expect("identifier");
        rest = identifierName(target);
        if (rest === "_") {
          throw this.error(target, "Mapping rest pattern cannot use wildcard");
        }
        if (this.matchLexeme(",") && !this.checkLexeme("}")) {
          throw this.error(this.peek(), "Mapping rest pattern must be last");
        }
        break;
      }
      const key = this.patternValueExpression(true);
      if (key.kind === "LiteralExpression") {
        const keyIdentity = `${typeof key.value}:${String(key.value)}`;
        if (literalKeys.has(keyIdentity)) {
          throw new LanguageSyntaxError(
            "Duplicate mapping pattern key",
            key.span,
          );
        }
        literalKeys.add(keyIdentity);
      }
      this.expect("operator", ":");
      const pattern = this.pattern();
      this.pushConstructItem(
        entries,
        { key, pattern, span: mergeSpans(key.span, pattern.span) },
        entryStart,
      );
      if (!this.matchLexeme(",")) break;
    }
    const close = this.expect("operator", "}");
    return {
      entries,
      kind: "MappingPattern",
      rest,
      span: this.span(open, close),
    };
  }

  private classPattern(className: Expression, start: Token): Pattern {
    const positional: Pattern[] = [];
    const keywords: ClassPatternKeyword[] = [];
    const keywordNames = new Set<string>();
    let sawKeyword = false;
    while (!this.checkLexeme(")")) {
      const itemStart = this.peek();
      if (this.check("identifier") && this.peek(1).lexeme === "=") {
        sawKeyword = true;
        const attribute = identifierName(this.advance());
        this.advance();
        if (keywordNames.has(attribute)) {
          throw this.error(
            itemStart,
            `Duplicate class pattern keyword ${attribute}`,
          );
        }
        keywordNames.add(attribute);
        const pattern = this.pattern();
        this.pushConstructItem(
          keywords,
          {
            attribute,
            pattern,
            span: mergeSpans(itemStart.span, pattern.span),
          },
          itemStart,
        );
      } else {
        if (sawKeyword) {
          throw this.error(
            itemStart,
            "Positional pattern follows keyword pattern",
          );
        }
        this.pushConstructItem(positional, this.pattern(), itemStart);
      }
      if (!this.matchLexeme(",")) break;
    }
    const close = this.expect("operator", ")");
    return {
      className,
      keywords,
      kind: "ClassPattern",
      positional,
      span: mergeSpans(start.span, close.span),
    };
  }

  private patternValueExpression(mappingKey: boolean): Expression {
    const start = this.peek();
    if (this.matchLexeme("+") || this.matchLexeme("-")) {
      const operator = this.previous();
      const number = this.expect("number");
      const literal = number.literal;
      if (typeof literal !== "number" && typeof literal !== "bigint") {
        throw this.error(number, "Expected a numeric literal pattern key");
      }
      return {
        kind: "LiteralExpression",
        span: mergeSpans(operator.span, number.span),
        value:
          operator.lexeme === "-"
            ? typeof literal === "bigint"
              ? -literal
              : -literal
            : literal,
      };
    }
    if (start.kind === "number" || start.kind === "string") {
      this.advance();
      return {
        kind: "LiteralExpression",
        span: start.span,
        value: start.literal as bigint | number | string,
      };
    }
    if (["True", "False", "None"].includes(start.lexeme)) {
      this.advance();
      return {
        kind: "LiteralExpression",
        span: start.span,
        value: start.literal as boolean | null,
      };
    }
    if (start.kind !== "identifier") {
      throw this.error(
        start,
        mappingKey
          ? "Expected a literal or value pattern key"
          : "Expected a value pattern",
      );
    }
    this.advance();
    let value: Expression = {
      kind: "IdentifierExpression",
      name: identifierName(start),
      span: start.span,
    };
    if (!this.checkLexeme(".")) {
      throw this.error(start, "Value pattern must use a dotted name");
    }
    while (this.matchLexeme(".")) {
      const attribute = this.expect("identifier");
      value = {
        attribute: identifierName(attribute),
        kind: "AttributeExpression",
        object: value,
        span: mergeSpans(value.span, attribute.span),
      };
    }
    return value;
  }

  private whileStatement(): Statement {
    const start = this.expect("keyword", "while");
    const test = this.expression(true);
    const body = this.suite();
    return {
      kind: "WhileStatement",
      test,
      body,
      span: mergeSpans(start.span, body.at(-1)?.span ?? test.span),
    };
  }

  private forStatement(asyncStart?: Token, asynchronous = false): Statement {
    const forToken = this.expect("keyword", "for");
    const start = asyncStart ?? forToken;
    const targetToken = this.expect("identifier");
    const target: IdentifierExpression = {
      kind: "IdentifierExpression",
      name: identifierName(targetToken),
      span: targetToken.span,
    };
    this.expect("keyword", "in");
    const iterable = this.expression();
    const body = this.suite();
    return {
      asynchronous,
      kind: "ForStatement",
      target,
      iterable,
      body,
      span: mergeSpans(start.span, body.at(-1)?.span ?? iterable.span),
    };
  }

  private withStatement(
    asyncStart?: Token,
    asynchronous = false,
  ): WithStatement {
    const withToken = this.expect("keyword", "with");
    const start = asyncStart ?? withToken;
    const parenthesized = this.matchLexeme("(");
    const items: WithItem[] = [];
    for (;;) {
      const itemStart = this.peek();
      const context = this.namedOrConditionalExpression(true);
      let target: AssignmentTarget | undefined;
      if (this.matchLexeme("as")) {
        const candidate = this.namedOrConditionalExpression(true);
        if (!isAssignmentTarget(candidate)) {
          throw new LanguageSyntaxError(
            "Invalid with assignment target",
            candidate.span,
          );
        }
        target = candidate;
      }
      this.pushConstructItem(
        items,
        {
          context,
          target,
          span: mergeSpans(itemStart.span, target?.span ?? context.span),
        },
        itemStart,
      );
      if (!this.matchLexeme(",")) break;
      if (parenthesized && this.checkLexeme(")")) break;
    }
    if (parenthesized) this.expect("operator", ")");
    const body = this.suite();
    return {
      asynchronous,
      body,
      items,
      kind: "WithStatement",
      span: mergeSpans(start.span, body.at(-1)?.span ?? items.at(-1)!.span),
    };
  }

  private decoratedDefinition(): FunctionDefinition | ClassDefinition {
    const start = this.peek();
    const decorators: Expression[] = [];
    while (this.matchLexeme("@")) {
      const marker = this.previous();
      const decorator = this.withExpressionNesting(() =>
        this.namedOrConditionalExpression(true),
      );
      this.expect("newline");
      this.pushConstructItem(decorators, decorator, marker);
    }
    if (this.checkLexeme("def")) {
      return this.functionDefinition(decorators, start);
    }
    if (this.matchLexeme("async")) {
      if (!this.checkLexeme("def")) {
        throw this.error(this.peek(), "Decorator async target must be def");
      }
      return this.functionDefinition(decorators, start, true);
    }
    if (this.checkLexeme("class")) {
      return this.classDefinition(decorators, start);
    }
    throw this.error(
      this.peek(),
      "Decorator must be followed by def, async def, or class",
    );
  }

  private functionDefinition(
    decorators: readonly Expression[] = [],
    decoratedStart?: Token,
    asynchronous = false,
  ): FunctionDefinition {
    const start = this.expect("keyword", "def");
    const name = identifierName(this.expect("identifier"));
    const typeParameters = this.typeParameterList();
    this.expect("operator", "(");
    const parameters = this.parameterList(")", true);
    this.expect("operator", ")");
    const returnAnnotation = this.matchLexeme("->")
      ? this.annotationExpression()
      : undefined;
    const body = this.suite();
    return {
      asynchronous,
      decorators,
      kind: "FunctionDefinition",
      name,
      parameters,
      returnAnnotation,
      typeParameters,
      body,
      span: mergeSpans(
        decoratedStart?.span ?? start.span,
        body.at(-1)?.span ?? start.span,
      ),
    };
  }

  private classDefinition(
    decorators: readonly Expression[] = [],
    decoratedStart?: Token,
  ): ClassDefinition {
    const start = this.expect("keyword", "class");
    const name = identifierName(this.expect("identifier"));
    const typeParameters = this.typeParameterList();
    const bases: Expression[] = [];
    if (this.matchLexeme("(")) {
      if (!this.checkLexeme(")")) {
        do {
          this.pushConstructItem(
            bases,
            this.conditionalOrLambdaExpression(),
            this.peek(),
          );
        } while (this.matchLexeme(",") && !this.checkLexeme(")"));
      }
      this.expect("operator", ")");
    }
    const body = this.suite();
    return {
      bases,
      body,
      decorators,
      kind: "ClassDefinition",
      name,
      typeParameters,
      span: mergeSpans(
        decoratedStart?.span ?? start.span,
        body.at(-1)?.span ?? start.span,
      ),
    };
  }

  private checkTypeAliasStatementStart(): boolean {
    return (
      this.check("identifier", "type") && this.peek(1).kind === "identifier"
    );
  }

  private typeAliasStatement(): TypeAliasStatement {
    const start = this.expect("identifier", "type");
    const name = identifierName(this.expect("identifier"));
    const typeParameters = this.typeParameterList();
    this.expect("operator", "=");
    const value = this.annotationExpression();
    const end = this.expect("newline");
    return {
      kind: "TypeAliasStatement",
      name,
      typeParameters,
      value,
      span: this.span(start, end),
    };
  }

  private typeParameterList(): TypeParameter[] {
    if (!this.matchLexeme("[")) return [];
    const parameters: TypeParameter[] = [];
    const names = new Set<string>();
    let sawDefault = false;
    while (!this.checkLexeme("]")) {
      const start = this.peek();
      const kind = this.matchLexeme("**")
        ? "ParameterSpecification"
        : this.matchLexeme("*")
          ? "TypeVariableTuple"
          : "TypeVariable";
      const nameToken = this.expect("identifier");
      const name = identifierName(nameToken);
      if (names.has(name)) {
        throw this.error(nameToken, `Duplicate type parameter ${name}`);
      }
      let bound: Expression | undefined;
      if (this.matchLexeme(":")) {
        if (kind !== "TypeVariable") {
          throw this.error(
            this.previous(),
            "Only a type variable may declare a bound or constraints",
          );
        }
        bound = this.annotationExpression();
      }
      const defaultValue = this.matchLexeme("=")
        ? this.annotationExpression()
        : undefined;
      if (defaultValue === undefined && sawDefault) {
        throw this.error(
          nameToken,
          "Non-default type parameter follows default type parameter",
        );
      }
      sawDefault ||= defaultValue !== undefined;
      const parameter: TypeParameter =
        kind === "TypeVariable"
          ? {
              bound,
              defaultValue,
              kind,
              name,
              span: mergeSpans(
                start.span,
                (defaultValue ?? bound)?.span ?? nameToken.span,
              ),
            }
          : {
              defaultValue,
              kind,
              name,
              span: mergeSpans(
                start.span,
                defaultValue?.span ?? nameToken.span,
              ),
            };
      names.add(name);
      this.pushConstructItem(parameters, parameter, start);
      if (!this.matchLexeme(",")) break;
      if (this.checkLexeme("]")) break;
    }
    this.expect("operator", "]");
    if (parameters.length === 0) {
      throw this.error(this.previous(), "Type parameter list cannot be empty");
    }
    for (let index = 0; index < parameters.length; index += 1) {
      const parameter = parameters[index]!;
      const laterNames = new Set(
        parameters.slice(index + 1).map(({ name }) => name),
      );
      const expressions = [
        parameter.kind === "TypeVariable" ? parameter.bound : undefined,
        parameter.defaultValue,
      ].filter((value): value is Expression => value !== undefined);
      for (const expression of expressions) {
        const laterReference = [...directAnnotationReferences(expression)].find(
          (name) => laterNames.has(name),
        );
        if (laterReference !== undefined) {
          throw new LanguageSyntaxError(
            `Type parameter ${parameter.name} cannot reference later type parameter ${laterReference}`,
            expression.span,
          );
        }
      }
    }
    return parameters;
  }

  private parameterList(
    terminator: ")" | ":",
    allowAnnotations = false,
  ): Parameter[] {
    const parameters: Parameter[] = [];
    const names = new Set<string>();
    let sawPositionalDefault = false;
    let sawSlash = false;
    let sawStar = false;
    let bareStarNeedsKeywordParameter = false;
    let sawVariadicKeyword = false;
    while (!this.checkLexeme(terminator)) {
      const start = this.peek();
      if (this.matchLexeme("/")) {
        if (
          sawSlash ||
          sawStar ||
          !parameters.some(
            ({ parameterKind }) => parameterKind === "positional_or_keyword",
          )
        ) {
          throw this.error(start, "Invalid positional-only parameter marker");
        }
        sawSlash = true;
        parameters.forEach((parameter, index) => {
          if (parameter.parameterKind === "positional_or_keyword") {
            parameters[index] = {
              ...parameter,
              parameterKind: "positional_only",
            };
          }
        });
      } else if (this.matchLexeme("**")) {
        if (sawVariadicKeyword) {
          throw this.error(start, "Duplicate variadic keyword parameter");
        }
        const token = this.expect("identifier");
        const annotation =
          allowAnnotations && this.matchLexeme(":")
            ? this.annotationExpression()
            : undefined;
        this.pushParameter(
          parameters,
          names,
          {
            name: identifierName(token),
            annotation,
            parameterKind: "variadic_keyword",
            span: mergeSpans(start.span, token.span),
          },
          token,
        );
        sawVariadicKeyword = true;
      } else if (this.matchLexeme("*")) {
        if (sawStar || sawVariadicKeyword) {
          throw this.error(start, "Invalid variadic parameter marker");
        }
        sawStar = true;
        if (this.check("identifier")) {
          const token = this.advance();
          const annotation =
            allowAnnotations && this.matchLexeme(":")
              ? this.annotationExpression()
              : undefined;
          this.pushParameter(
            parameters,
            names,
            {
              name: identifierName(token),
              annotation,
              parameterKind: "variadic_positional",
              span: mergeSpans(start.span, token.span),
            },
            token,
          );
        } else {
          bareStarNeedsKeywordParameter = true;
        }
      } else {
        if (sawVariadicKeyword) {
          throw this.error(
            start,
            "Parameter follows variadic keyword parameter",
          );
        }
        const token = this.expect("identifier");
        const parameterKind = sawStar
          ? ("keyword_only" as const)
          : ("positional_or_keyword" as const);
        let defaultValue: Expression | undefined;
        const annotation =
          allowAnnotations && this.matchLexeme(":")
            ? this.annotationExpression()
            : undefined;
        if (this.matchLexeme("=")) {
          defaultValue = this.conditionalOrLambdaExpression();
          if (parameterKind === "positional_or_keyword") {
            sawPositionalDefault = true;
          }
        } else if (
          parameterKind === "positional_or_keyword" &&
          sawPositionalDefault
        ) {
          throw this.error(
            token,
            "A required parameter cannot follow a default parameter",
          );
        }
        this.pushParameter(
          parameters,
          names,
          {
            name: identifierName(token),
            annotation,
            parameterKind,
            defaultValue,
            span: token.span,
          },
          token,
        );
        if (parameterKind === "keyword_only") {
          bareStarNeedsKeywordParameter = false;
        }
      }
      if (this.checkLexeme(terminator)) break;
      this.expect("operator", ",");
      if (this.checkLexeme(terminator)) break;
      if (sawVariadicKeyword) {
        throw this.error(
          this.peek(),
          "Parameter follows variadic keyword parameter",
        );
      }
    }
    if (bareStarNeedsKeywordParameter) {
      throw this.error(this.peek(), "Bare * requires a keyword-only parameter");
    }
    return parameters;
  }

  private pushParameter(
    parameters: Parameter[],
    names: Set<string>,
    parameter: Parameter,
    token: Token,
  ): void {
    if (names.has(parameter.name)) {
      throw this.error(token, `Duplicate parameter ${parameter.name}`);
    }
    if (parameters.length >= this.limits.parser.maxParameters) {
      throw this.error(
        token,
        `Parameter limit exceeded (max ${this.limits.parser.maxParameters})`,
      );
    }
    names.add(parameter.name);
    parameters.push(parameter);
  }

  private tryStatement(): Statement {
    const start = this.expect("keyword", "try");
    const body = this.suite();
    const handlers: ExceptHandler[] = [];
    while (this.matchLexeme("except")) {
      const exceptToken = this.previous();
      const starred = this.matchLexeme("*");
      const parenthesizedType = this.checkLexeme("(");
      const type = this.checkLexeme(":") ? undefined : this.expression();
      if (starred && type === undefined) {
        throw this.error(exceptToken, "except* requires an exception type");
      }
      if (
        handlers.length > 0 &&
        handlers.some((handler) => handler.starred !== starred)
      ) {
        throw this.error(
          exceptToken,
          "Cannot mix except and except* handlers in one try statement",
        );
      }
      let name: string | undefined;
      if (
        type?.kind === "TupleExpression" &&
        !parenthesizedType &&
        this.previous().lexeme === ","
      ) {
        throw this.error(
          this.previous(),
          "Trailing exception-type comma requires parentheses",
        );
      }
      if (this.matchLexeme("as")) {
        name = identifierName(this.expect("identifier"));
      }
      if (
        name !== undefined &&
        type?.kind === "TupleExpression" &&
        !parenthesizedType
      ) {
        throw this.error(
          exceptToken,
          "Multiple exception types require parentheses when followed by as",
        );
      }
      const handlerBody = this.suite();
      if (starred) {
        const forbidden = findExceptStarControlTransfer(handlerBody);
        if (forbidden !== undefined) {
          throw new LanguageSyntaxError(
            `${exceptStarControlName(forbidden.kind)} is not allowed in an except* suite`,
            forbidden.span,
          );
        }
      }
      this.pushConstructItem(
        handlers,
        {
          type,
          name,
          body: handlerBody,
          starred,
          span: mergeSpans(
            exceptToken.span,
            handlerBody.at(-1)?.span ?? exceptToken.span,
          ),
        },
        exceptToken,
      );
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
    return this.withBlockNesting(() => {
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
    });
  }

  private tupleExpression(allowNamedExpression = false): Expression {
    const first = this.flexibleExpression(allowNamedExpression);
    if (!this.matchLexeme(",")) {
      if (first.kind === "StarredExpression") {
        throw new LanguageSyntaxError(
          "Starred expression must be in an expression list",
          first.span,
        );
      }
      return first;
    }
    const elements: Expression[] = [];
    this.pushConstructItem(elements, first, this.previous());
    while (!this.checkExpressionTerminator()) {
      const element = this.flexibleExpression(allowNamedExpression);
      this.pushConstructItem(elements, element, this.previous());
      if (!this.matchLexeme(",")) break;
    }
    return {
      kind: "TupleExpression",
      elements,
      span: mergeSpans(first.span, elements.at(-1)?.span ?? first.span),
    };
  }

  private assignmentValueExpression(): Expression {
    return this.checkLexeme("yield")
      ? this.yieldExpression()
      : this.expression();
  }

  private yieldExpression(): YieldExpression {
    const start = this.expect("keyword", "yield");
    const delegate = this.matchLexeme("from");
    if (delegate && this.checkYieldExpressionTerminator()) {
      throw this.error(this.previous(), "Expected expression after yield from");
    }
    const value =
      !delegate && this.checkYieldExpressionTerminator()
        ? undefined
        : this.expression();
    return {
      delegate,
      kind: "YieldExpression",
      value,
      span:
        value === undefined ? start.span : mergeSpans(start.span, value.span),
    };
  }

  private flexibleExpression(allowNamedExpression = false): Expression {
    if (!this.matchLexeme("*")) {
      return this.namedOrConditionalExpression(allowNamedExpression);
    }
    const start = this.previous();
    const value = this.booleanExpression();
    const expression: StarredExpression = {
      kind: "StarredExpression",
      value,
      span: mergeSpans(start.span, value.span),
    };
    return expression;
  }

  private namedOrConditionalExpression(
    allowNamedExpression: boolean,
  ): Expression {
    if (
      !allowNamedExpression ||
      !this.check("identifier") ||
      this.peek(1).lexeme !== ":="
    ) {
      return this.conditionalOrLambdaExpression();
    }
    const targetToken = this.advance();
    const target: IdentifierExpression = {
      kind: "IdentifierExpression",
      name: identifierName(targetToken),
      span: targetToken.span,
    };
    this.advance();
    const value = this.withExpressionNesting(() =>
      this.conditionalOrLambdaExpression(),
    );
    return {
      kind: "NamedExpression",
      target,
      value,
      span: mergeSpans(target.span, value.span),
    } satisfies NamedExpression;
  }

  private conditionalOrLambdaExpression(): Expression {
    if (this.checkLexeme("lambda")) return this.lambdaExpression();
    const whenTrue = this.booleanExpression();
    if (!this.matchLexeme("if")) return whenTrue;
    const condition = this.booleanExpression();
    this.expect("keyword", "else");
    const whenFalse = this.withExpressionNesting(() =>
      this.conditionalOrLambdaExpression(),
    );
    const expression: ConditionalExpression = {
      kind: "ConditionalExpression",
      condition,
      whenTrue,
      whenFalse,
      span: mergeSpans(whenTrue.span, whenFalse.span),
    };
    return expression;
  }

  private lambdaExpression(): LambdaExpression {
    const start = this.expect("keyword", "lambda");
    const parameters = this.checkLexeme(":") ? [] : this.parameterList(":");
    this.expect("operator", ":");
    const body = this.withExpressionNesting(() =>
      this.conditionalOrLambdaExpression(),
    );
    return {
      kind: "LambdaExpression",
      parameters,
      body,
      span: mergeSpans(start.span, body.span),
    };
  }

  private annotationExpression(): Expression {
    const annotation = this.conditionalOrLambdaExpression();
    if (containsForbiddenAnnotationExpression(annotation)) {
      throw new LanguageSyntaxError(
        "Annotation expressions cannot contain yield or assignment expressions",
        annotation.span,
      );
    }
    return annotation;
  }

  /**
   * Parses the two left-associative boolean precedences with explicit stacks.
   * Keeping the precedence state in data instead of nested callbacks matters in
   * Bedrock, where Script API events begin with substantially less host stack
   * than the Node.js test process.
   */
  private booleanExpression(): Expression {
    const expressions: Expression[] = [this.notExpression()];
    const operators: { operator: "and" | "or"; token: Token }[] = [];
    while (this.checkLexeme("and") || this.checkLexeme("or")) {
      const token = this.advance();
      const operator = token.lexeme as "and" | "or";
      const precedence = operator === "and" ? 2 : 1;
      while (
        operators.length > 0 &&
        (operators.at(-1)!.operator === "and" ? 2 : 1) >= precedence
      ) {
        this.reduceBoolean(expressions, operators.pop()!);
      }
      operators.push({ operator, token });
      expressions.push(this.notExpression());
    }
    while (operators.length > 0) {
      this.reduceBoolean(expressions, operators.pop()!);
    }
    return expressions[0]!;
  }

  private reduceBoolean(
    expressions: Expression[],
    operation: { readonly operator: "and" | "or"; readonly token: Token },
  ): void {
    const right = expressions.pop()!;
    const left = expressions.pop()!;
    const values: Expression[] =
      left.kind === "BooleanExpression" && left.operator === operation.operator
        ? [...left.values]
        : [left];
    this.pushConstructItem(values, right, operation.token);
    expressions.push({
      kind: "BooleanExpression",
      operator: operation.operator,
      values,
      span: mergeSpans(left.span, right.span),
    } satisfies BooleanExpression);
  }

  private notExpression(): Expression {
    if (this.matchLexeme("not")) {
      const operator = this.previous();
      const operand = this.withExpressionNesting(() => this.notExpression());
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
    const left = this.binaryExpression();
    const comparisons: ComparisonPart[] = [];
    while (true) {
      const start = this.peek();
      let operator: ComparisonPart["operator"] | undefined;
      if (this.parsingComprehensionTarget && start.lexeme === "in") break;
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
      const right = this.binaryExpression();
      this.pushConstructItem(
        comparisons,
        {
          operator,
          right,
          span: mergeSpans(start.span, right.span),
        },
        start,
      );
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

  /** Parses every left-associative numeric/bitwise precedence in O(N). */
  private binaryExpression(): Expression {
    const expressions: Expression[] = [this.unaryExpression()];
    const operators: {
      operator: BinaryExpression["operator"];
      precedence: number;
    }[] = [];
    while (true) {
      const operator = this.peek().lexeme as BinaryExpression["operator"];
      const precedence = leftBinaryPrecedence(operator);
      if (precedence === undefined) break;
      this.advance();
      while (
        operators.length > 0 &&
        operators.at(-1)!.precedence >= precedence
      ) {
        reduceBinary(expressions, operators.pop()!.operator);
      }
      operators.push({ operator, precedence });
      expressions.push(this.unaryExpression());
    }
    while (operators.length > 0) {
      reduceBinary(expressions, operators.pop()!.operator);
    }
    return expressions[0]!;
  }

  private unaryExpression(): Expression {
    if (
      this.matchLexeme("+") ||
      this.matchLexeme("-") ||
      this.matchLexeme("~")
    ) {
      const operator = this.previous();
      const operand = this.withExpressionNesting(() => this.unaryExpression());
      return {
        kind: "UnaryExpression",
        operator: operator.lexeme as "+" | "-" | "~",
        operand,
        span: mergeSpans(operator.span, operand.span),
      };
    }
    return this.powerExpression();
  }

  private powerExpression(): Expression {
    let left: Expression;
    if (this.matchLexeme("await")) {
      const start = this.previous();
      const value = this.withExpressionNesting(() => this.postfixExpression());
      left = {
        kind: "AwaitExpression",
        span: mergeSpans(start.span, value.span),
        value,
      } satisfies AwaitExpression;
    } else {
      left = this.postfixExpression();
    }
    if (this.matchLexeme("**")) {
      const right = this.withExpressionNesting(() => this.unaryExpression());
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
        const callOpen = this.previous();
        const arguments_: CallArgument[] = [];
        const explicitKeywords = new Set<string>();
        let sawKeywordOrMapping = false;
        let sawMappingUnpack = false;
        let consumedClose: Token | undefined;
        if (!this.checkLexeme(")")) {
          do {
            const start = this.peek();
            let argumentKind: CallArgument["argumentKind"];
            let name: string | undefined;
            if (this.matchLexeme("**")) {
              argumentKind = "mapping_unpack";
              sawKeywordOrMapping = true;
              sawMappingUnpack = true;
            } else if (this.matchLexeme("*")) {
              if (sawMappingUnpack) {
                throw this.error(
                  start,
                  "Iterable unpacking follows mapping unpacking",
                );
              }
              argumentKind = "iterable_unpack";
            } else if (
              this.check("identifier") &&
              this.peek(1).lexeme === "="
            ) {
              name = identifierName(this.advance());
              this.advance();
              if (explicitKeywords.has(name)) {
                throw this.error(start, `Repeated keyword argument ${name}`);
              }
              explicitKeywords.add(name);
              argumentKind = "keyword";
              sawKeywordOrMapping = true;
            } else if (sawKeywordOrMapping) {
              throw this.error(
                start,
                "Positional argument follows keyword argument",
              );
            } else {
              argumentKind = "positional";
            }
            let value =
              argumentKind === "positional"
                ? this.namedOrConditionalExpression(true)
                : this.conditionalOrLambdaExpression();
            const generatorArgument =
              argumentKind === "positional" &&
              arguments_.length === 0 &&
              (this.checkLexeme("for") || this.checkLexeme("async"));
            if (generatorArgument) {
              if (value.kind === "StarredExpression") {
                throw new LanguageSyntaxError(
                  "Iterable unpacking cannot be used in a generator expression",
                  value.span,
                );
              }
              value = this.comprehension(callOpen, ")", "generator", {
                element: value,
              });
              consumedClose = this.previous();
            }
            if (arguments_.length >= this.limits.parser.maxArguments) {
              throw this.error(
                start,
                `Argument limit exceeded (max ${this.limits.parser.maxArguments})`,
              );
            }
            arguments_.push({
              argumentKind,
              name,
              value,
              span: mergeSpans(start.span, value.span),
            });
            if (generatorArgument) break;
          } while (this.matchLexeme(",") && !this.checkLexeme(")"));
        }
        const close = consumedClose ?? this.expect("operator", ")");
        expression = {
          kind: "CallExpression",
          callee: expression,
          arguments: arguments_,
          span: mergeSpans(expression.span, close.span),
        };
      } else if (this.matchLexeme("[")) {
        const open = this.previous();
        const first = this.checkLexeme(":") ? undefined : this.expression();
        if (this.matchLexeme(":")) {
          const stop =
            this.checkLexeme("]") || this.checkLexeme(":")
              ? undefined
              : this.expression();
          let step: Expression | undefined;
          if (this.matchLexeme(":")) {
            step = this.checkLexeme("]") ? undefined : this.expression();
          }
          const close = this.expect("operator", "]");
          expression = {
            kind: "SliceExpression",
            object: expression,
            start: first,
            stop,
            step,
            span: mergeSpans(expression.span, close.span),
          } satisfies SliceExpression;
          continue;
        }
        if (first === undefined) {
          throw this.error(open, "Expected a subscript or slice");
        }
        const close = this.expect("operator", "]");
        expression = {
          kind: "SubscriptExpression",
          object: expression,
          index: first,
          span: mergeSpans(expression.span, close.span),
        };
      } else if (this.matchLexeme(".")) {
        const attribute = this.expect("identifier");
        expression = {
          kind: "AttributeExpression",
          object: expression,
          attribute: identifierName(attribute),
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
        name: identifierName(token),
        span: token.span,
      };
    }
    if (token.kind === "formatted_string") return this.formattedString(token);
    if (token.kind === "template_string") return this.templateString(token);
    if (token.lexeme === "[") return this.listExpression(token);
    if (token.lexeme === "{") return this.braceExpression(token);
    if (token.lexeme === "(") return this.parenthesizedExpression(token);
    throw this.error(token, "Expected an expression");
  }

  private listExpression(open: Token): Expression {
    if (this.checkLexeme("]")) {
      const close = this.advance();
      return {
        kind: "ListExpression",
        elements: [],
        span: this.span(open, close),
      };
    }
    const first = this.flexibleExpression(true);
    if (this.checkLexeme("for") || this.checkLexeme("async")) {
      if (first.kind === "StarredExpression") {
        throw new LanguageSyntaxError(
          "Iterable unpacking cannot be used in a comprehension",
          first.span,
        );
      }
      return this.comprehension(open, "]", "list", { element: first });
    }
    const elements: Expression[] = [];
    this.pushConstructItem(elements, first, open);
    while (this.matchLexeme(",") && !this.checkLexeme("]")) {
      const element = this.flexibleExpression(true);
      this.pushConstructItem(elements, element, this.previous());
    }
    const close = this.expect("operator", "]");
    return { kind: "ListExpression", elements, span: this.span(open, close) };
  }

  private braceExpression(open: Token): Expression {
    if (this.checkLexeme("}")) {
      const close = this.advance();
      return {
        kind: "DictionaryExpression",
        entries: [],
        span: this.span(open, close),
      };
    }
    if (this.checkLexeme("**")) return this.dictionaryDisplay(open, []);

    const directNamedExpression =
      this.check("identifier") && this.peek(1).lexeme === ":=";
    const first = this.flexibleExpression(true);
    if (this.matchLexeme(":")) {
      if (directNamedExpression || first.kind === "StarredExpression") {
        throw new LanguageSyntaxError("Invalid dictionary key", first.span);
      }
      const value = this.conditionalOrLambdaExpression();
      if (this.checkLexeme("for") || this.checkLexeme("async")) {
        return this.comprehension(open, "}", "dictionary", {
          key: first,
          value,
        });
      }
      return this.dictionaryDisplay(open, [
        {
          entryKind: "pair",
          key: first,
          value,
          span: mergeSpans(first.span, value.span),
        },
      ]);
    }
    if (this.checkLexeme("for") || this.checkLexeme("async")) {
      if (first.kind === "StarredExpression") {
        throw new LanguageSyntaxError(
          "Iterable unpacking cannot be used in a comprehension",
          first.span,
        );
      }
      return this.comprehension(open, "}", "set", { element: first });
    }

    const elements: Expression[] = [];
    this.pushConstructItem(elements, first, open);
    while (this.matchLexeme(",") && !this.checkLexeme("}")) {
      const element = this.flexibleExpression(true);
      this.pushConstructItem(elements, element, this.previous());
    }
    const close = this.expect("operator", "}");
    return {
      kind: "SetExpression",
      elements,
      span: this.span(open, close),
    } satisfies SetExpression;
  }

  private dictionaryDisplay(
    open: Token,
    initialEntries: readonly DictionaryEntry[],
  ): Expression {
    const entries: DictionaryEntry[] = [];
    for (const entry of initialEntries) {
      this.pushConstructItem(entries, entry, open);
    }
    let acceptEntry = initialEntries.length === 0 || this.matchLexeme(",");
    while (acceptEntry && !this.checkLexeme("}")) {
      const start = this.peek();
      if (this.matchLexeme("**")) {
        const value = this.conditionalOrLambdaExpression();
        this.pushConstructItem(
          entries,
          {
            entryKind: "mapping_unpack",
            value,
            span: mergeSpans(start.span, value.span),
          },
          start,
        );
      } else {
        const key = this.conditionalOrLambdaExpression();
        this.expect("operator", ":");
        const value = this.conditionalOrLambdaExpression();
        this.pushConstructItem(
          entries,
          {
            entryKind: "pair",
            key,
            value,
            span: mergeSpans(key.span, value.span),
          },
          start,
        );
      }
      acceptEntry = this.matchLexeme(",");
    }
    const close = this.expect("operator", "}");
    return {
      kind: "DictionaryExpression",
      entries,
      span: this.span(open, close),
    };
  }

  private comprehension(
    open: Token,
    terminator: ")" | "]" | "}",
    containerKind: ComprehensionExpression["containerKind"],
    result: Pick<ComprehensionExpression, "element" | "key" | "value">,
  ): ComprehensionExpression {
    const clauses: ComprehensionClause[] = [];
    while (this.checkLexeme("for") || this.checkLexeme("async")) {
      const asyncStart = this.matchLexeme("async")
        ? this.previous()
        : undefined;
      const forToken = this.expect("keyword", "for");
      const start = asyncStart ?? forToken;
      const target = this.comprehensionTarget();
      this.expect("keyword", "in");
      const iterable = this.booleanExpression();
      this.pushConstructItem(
        clauses,
        {
          asynchronous: asyncStart !== undefined,
          clauseKind: "for",
          target,
          iterable,
          span: mergeSpans(start.span, iterable.span),
        },
        start,
      );
      while (this.matchLexeme("if")) {
        const filter = this.previous();
        const condition = this.booleanExpression();
        this.pushConstructItem(
          clauses,
          {
            clauseKind: "if",
            condition,
            span: mergeSpans(filter.span, condition.span),
          },
          filter,
        );
      }
    }
    const close = this.expect("operator", terminator);
    return {
      ...result,
      clauses,
      containerKind,
      kind: "ComprehensionExpression",
      span: this.span(open, close),
    };
  }

  private comprehensionTarget(): AssignmentTarget {
    this.parsingComprehensionTarget = true;
    let expression: Expression;
    try {
      expression = this.expression();
    } finally {
      this.parsingComprehensionTarget = false;
    }
    if (
      expression.kind === "StarredExpression" ||
      !isComprehensionTarget(expression)
    ) {
      throw new LanguageSyntaxError(
        "Invalid comprehension target",
        expression.span,
      );
    }
    return expression;
  }

  private parenthesizedExpression(open: Token): Expression {
    if (this.matchLexeme(")")) {
      return {
        kind: "TupleExpression",
        elements: [],
        span: this.span(open, this.previous()),
      };
    }
    if (this.checkLexeme("yield")) {
      const expression = this.yieldExpression();
      this.expect("operator", ")");
      return expression;
    }
    const first = this.withExpressionNesting(() =>
      this.flexibleExpression(true),
    );
    if (this.checkLexeme("for") || this.checkLexeme("async")) {
      if (first.kind === "StarredExpression") {
        throw new LanguageSyntaxError(
          "Iterable unpacking cannot be used in a generator expression",
          first.span,
        );
      }
      return this.comprehension(open, ")", "generator", { element: first });
    }
    if (!this.matchLexeme(",")) {
      this.expect("operator", ")");
      if (first.kind === "StarredExpression") {
        throw new LanguageSyntaxError(
          "Starred expression must be in an expression list",
          first.span,
        );
      }
      return first;
    }
    const elements: Expression[] = [];
    this.pushConstructItem(elements, first, open);
    while (!this.checkLexeme(")")) {
      const element = this.flexibleExpression(true);
      this.pushConstructItem(elements, element, this.previous());
      if (!this.matchLexeme(",")) break;
    }
    const close = this.expect("operator", ")");
    return {
      elements,
      kind: "TupleExpression",
      span: this.span(open, close),
    };
  }

  private formattedString(token: Token): Expression {
    return {
      ...this.interpolatedString(token, "Formatted"),
      kind: "FormattedStringExpression",
      span: token.span,
    };
  }

  private templateString(token: Token): TemplateStringExpression {
    return {
      ...this.interpolatedString(token, "Template"),
      kind: "TemplateStringExpression",
      span: token.span,
    };
  }

  private interpolatedString(
    token: Token,
    label: "Formatted" | "Template",
  ): Pick<TemplateStringExpression, "interpolations" | "strings"> {
    const source = String(token.literal ?? "");
    const strings = [""];
    const interpolations: TemplateStringInterpolation[] = [];
    for (let index = 0; index < source.length; index += 1) {
      const character = source[index];
      if (character === "{" && source[index + 1] === "{") {
        strings[strings.length - 1] = `${strings.at(-1)!}{`;
        index += 1;
        continue;
      }
      if (character === "}" && source[index + 1] === "}") {
        strings[strings.length - 1] = `${strings.at(-1)!}}`;
        index += 1;
        continue;
      }
      if (character === "}") {
        throw this.error(
          token,
          `Unmatched closing brace in ${label.toLowerCase()} string`,
        );
      }
      if (character !== "{") {
        strings[strings.length - 1] = strings.at(-1)! + character;
        continue;
      }
      if (
        this.budget.formattedStringExpressions >=
        this.limits.parser.maxFormattedStringExpressions
      ) {
        throw this.error(
          token,
          `${label === "Formatted" ? "Formatted string expression" : "Template string interpolation"} limit exceeded (max ${this.limits.parser.maxFormattedStringExpressions})`,
        );
      }
      const field = splitFormattedStringField(source, index + 1, label);
      if (field.expression.trim() === "") {
        throw this.error(
          token,
          `Empty ${label.toLowerCase()} string interpolation`,
        );
      }
      this.budget.formattedStringExpressions += 1;
      if (field.debugText !== undefined) {
        strings[strings.length - 1] = strings.at(-1)! + field.debugText;
      }
      const value = new Parser(
        lex(field.expression.trim(), this.limits.lexer),
        this.limits,
        this.budget,
      ).parseStandaloneExpression();
      interpolations.push({
        conversion: field.conversion,
        expression: field.expression,
        formatSpec: this.formattedStringParts(field.formatSpec, token, label),
        value,
      });
      strings.push("");
      index = field.close;
    }
    return { interpolations, strings };
  }

  private formattedStringParts(
    formatSpec: string,
    token: Token,
    label: "Formatted" | "Template",
  ): readonly FormattedStringPart[] {
    if (formatSpec === "") return [];
    const parts: FormattedStringPart[] = [];
    let text = "";
    for (let index = 0; index < formatSpec.length; index += 1) {
      const character = formatSpec[index];
      if (character === "{" && formatSpec[index + 1] === "{") {
        text += "{";
        index += 1;
      } else if (character === "}" && formatSpec[index + 1] === "}") {
        text += "}";
        index += 1;
      } else if (character === "{") {
        if (text !== "") parts.push(text);
        text = "";
        const field = splitFormattedStringField(formatSpec, index + 1, label);
        if (field.expression.trim() === "") {
          throw this.error(
            token,
            `Empty ${label.toLowerCase()} string format interpolation`,
          );
        }
        if (
          this.budget.formattedStringExpressions >=
          this.limits.parser.maxFormattedStringExpressions
        ) {
          throw this.error(
            token,
            `${label === "Formatted" ? "Formatted string expression" : "Template string interpolation"} limit exceeded (max ${this.limits.parser.maxFormattedStringExpressions})`,
          );
        }
        this.budget.formattedStringExpressions += 1;
        parts.push({
          conversion: field.conversion,
          expression: field.expression,
          formatSpec: this.formattedStringParts(field.formatSpec, token, label),
          value: new Parser(
            lex(field.expression.trim(), this.limits.lexer),
            this.limits,
            this.budget,
          ).parseStandaloneExpression(),
        });
        index = field.close;
      } else if (character === "}") {
        throw this.error(
          token,
          `Unmatched closing brace in ${label.toLowerCase()} format`,
        );
      } else {
        text += character;
      }
    }
    if (text !== "") parts.push(text);
    return parts;
  }

  private checkExpressionTerminator(): boolean {
    return (
      [")", "]", "}", ":", "\n"].includes(this.peek().lexeme) ||
      this.check("eof")
    );
  }

  private checkYieldExpressionTerminator(): boolean {
    return [")", "\n"].includes(this.peek().lexeme) || this.check("eof");
  }

  private pushConstructItem<T>(items: T[], item: T, token: Token): void {
    if (items.length >= this.limits.parser.maxItemsPerConstruct) {
      throw this.error(
        token,
        `Construct item limit exceeded (max ${this.limits.parser.maxItemsPerConstruct})`,
      );
    }
    items.push(item);
  }

  private withBlockNesting<T>(operation: () => T): T {
    if (this.budget.blockNesting >= this.limits.parser.maxBlockNesting) {
      throw this.error(
        this.peek(),
        `Block nesting limit exceeded (max ${this.limits.parser.maxBlockNesting})`,
      );
    }
    this.budget.blockNesting += 1;
    try {
      return operation();
    } finally {
      this.budget.blockNesting -= 1;
    }
  }

  private withExpressionNesting<T>(operation: () => T): T {
    if (
      this.budget.expressionNesting >= this.limits.parser.maxExpressionNesting
    ) {
      throw this.error(
        this.peek(),
        `Expression nesting limit exceeded (max ${this.limits.parser.maxExpressionNesting})`,
      );
    }
    this.budget.expressionNesting += 1;
    try {
      return operation();
    } finally {
      this.budget.expressionNesting -= 1;
    }
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

function validatePatternCaptures(pattern: Pattern): ReadonlySet<string> {
  switch (pattern.kind) {
    case "CapturePattern":
      return new Set([pattern.name]);
    case "StarPattern":
      return pattern.name === undefined ? new Set() : new Set([pattern.name]);
    case "AsPattern": {
      const names = new Set(validatePatternCaptures(pattern.pattern));
      if (names.has(pattern.name)) {
        throw new LanguageSyntaxError(
          `Multiple assignments to name ${pattern.name} in pattern`,
          pattern.span,
        );
      }
      names.add(pattern.name);
      return names;
    }
    case "SequencePattern": {
      const names = new Set<string>();
      for (const element of pattern.elements) {
        mergePatternCaptureNames(
          names,
          validatePatternCaptures(element),
          element,
        );
      }
      return names;
    }
    case "MappingPattern": {
      const names = new Set<string>();
      for (const entry of pattern.entries) {
        mergePatternCaptureNames(
          names,
          validatePatternCaptures(entry.pattern),
          entry.pattern,
        );
      }
      if (pattern.rest !== undefined) {
        if (names.has(pattern.rest)) {
          throw new LanguageSyntaxError(
            `Multiple assignments to name ${pattern.rest} in pattern`,
            pattern.span,
          );
        }
        names.add(pattern.rest);
      }
      return names;
    }
    case "ClassPattern": {
      const names = new Set<string>();
      for (const positional of pattern.positional) {
        mergePatternCaptureNames(
          names,
          validatePatternCaptures(positional),
          positional,
        );
      }
      for (const keyword of pattern.keywords) {
        mergePatternCaptureNames(
          names,
          validatePatternCaptures(keyword.pattern),
          keyword.pattern,
        );
      }
      return names;
    }
    case "OrPattern": {
      const alternatives = pattern.alternatives.map(validatePatternCaptures);
      const expected = alternatives[0] ?? new Set<string>();
      for (let index = 0; index < alternatives.length; index += 1) {
        if (!setsEqual(expected, alternatives[index]!)) {
          throw new LanguageSyntaxError(
            "Alternative patterns bind different names",
            pattern.alternatives[index]!.span,
          );
        }
      }
      for (let index = 0; index < alternatives.length - 1; index += 1) {
        if (isIrrefutablePattern(pattern.alternatives[index]!)) {
          throw new LanguageSyntaxError(
            "Irrefutable alternative must be last",
            pattern.alternatives[index]!.span,
          );
        }
      }
      return new Set(expected);
    }
    case "LiteralPattern":
    case "ValuePattern":
    case "WildcardPattern":
      return new Set();
  }
}

function mergePatternCaptureNames(
  target: Set<string>,
  source: ReadonlySet<string>,
  pattern: Pattern,
): void {
  for (const name of source) {
    if (target.has(name)) {
      throw new LanguageSyntaxError(
        `Multiple assignments to name ${name} in pattern`,
        pattern.span,
      );
    }
    target.add(name);
  }
}

function setsEqual(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): boolean {
  return left.size === right.size && [...left].every((name) => right.has(name));
}

function isIrrefutablePattern(pattern: Pattern): boolean {
  switch (pattern.kind) {
    case "CapturePattern":
    case "WildcardPattern":
      return true;
    case "AsPattern":
      return isIrrefutablePattern(pattern.pattern);
    case "OrPattern":
      return pattern.alternatives.some(isIrrefutablePattern);
    default:
      return false;
  }
}

function leftBinaryPrecedence(
  operator: BinaryExpression["operator"],
): number | undefined {
  switch (operator) {
    case "|":
      return 1;
    case "^":
      return 2;
    case "&":
      return 3;
    case "<<":
    case ">>":
      return 4;
    case "+":
    case "-":
      return 5;
    case "*":
    case "/":
    case "//":
    case "%":
      return 6;
    case "**":
      return undefined;
  }
}

function reduceBinary(
  expressions: Expression[],
  operator: BinaryExpression["operator"],
): void {
  const right = expressions.pop()!;
  const left = expressions.pop()!;
  expressions.push({
    kind: "BinaryExpression",
    operator,
    left,
    right,
    span: mergeSpans(left.span, right.span),
  });
}

function isAssignmentTarget(
  expression: Expression,
): expression is AssignmentTarget {
  if (isAugmentedAssignmentTarget(expression)) return true;
  if (expression.kind === "SliceExpression") return true;
  if (expression.kind === "StarredExpression") {
    return isAssignmentTarget(expression.value);
  }
  if (
    expression.kind === "ListExpression" ||
    expression.kind === "TupleExpression"
  ) {
    let starred = 0;
    for (const element of expression.elements) {
      if (!isAssignmentTarget(element)) return false;
      if (element.kind === "StarredExpression") starred += 1;
      if (starred > 1) return false;
    }
    return true;
  }
  return false;
}

function isDeletionTarget(
  expression: Expression,
): expression is DeletionTarget {
  if (
    expression.kind === "AttributeExpression" ||
    expression.kind === "IdentifierExpression" ||
    expression.kind === "SliceExpression" ||
    expression.kind === "SubscriptExpression"
  ) {
    return true;
  }
  if (
    expression.kind !== "ListExpression" &&
    expression.kind !== "TupleExpression"
  ) {
    return false;
  }
  return expression.elements.every(isDeletionTarget);
}

function isComprehensionTarget(
  expression: Expression,
): expression is AssignmentTarget {
  if (expression.kind === "IdentifierExpression") return true;
  if (expression.kind === "StarredExpression") {
    return isComprehensionTarget(expression.value);
  }
  if (
    expression.kind !== "ListExpression" &&
    expression.kind !== "TupleExpression"
  ) {
    return false;
  }
  let starred = 0;
  for (const element of expression.elements) {
    if (!isComprehensionTarget(element)) return false;
    if (element.kind === "StarredExpression") starred += 1;
    if (starred > 1) return false;
  }
  return true;
}

function isAugmentedAssignmentTarget(
  expression: Expression,
): expression is
  AttributeExpression | IdentifierExpression | SubscriptExpression {
  return [
    "AttributeExpression",
    "IdentifierExpression",
    "SubscriptExpression",
  ].includes(expression.kind);
}

function isAnnotatedAssignmentTarget(
  expression: Expression,
): expression is
  | AttributeExpression
  | IdentifierExpression
  | SliceExpression
  | SubscriptExpression {
  return [
    "AttributeExpression",
    "IdentifierExpression",
    "SliceExpression",
    "SubscriptExpression",
  ].includes(expression.kind);
}

function containsForbiddenAnnotationExpression(
  expression: Expression,
): boolean {
  const pending: Expression[] = [expression];
  while (pending.length > 0) {
    const current = pending.pop()!;
    switch (current.kind) {
      case "NamedExpression":
      case "YieldExpression":
        return true;
      case "AttributeExpression":
        pending.push(current.object);
        break;
      case "BinaryExpression":
        pending.push(current.left, current.right);
        break;
      case "BooleanExpression":
        pending.push(...current.values);
        break;
      case "CallExpression":
        pending.push(
          current.callee,
          ...current.arguments.map(({ value }) => value),
        );
        break;
      case "ComparisonExpression":
        pending.push(
          current.left,
          ...current.comparisons.map(({ right }) => right),
        );
        break;
      case "ConditionalExpression":
        pending.push(current.condition, current.whenTrue, current.whenFalse);
        break;
      case "ComprehensionExpression": {
        const leftmost = current.clauses[0];
        if (leftmost?.clauseKind === "for") pending.push(leftmost.iterable);
        break;
      }
      case "DictionaryExpression":
        for (const entry of current.entries) {
          pending.push(entry.value);
          if (entry.entryKind === "pair") pending.push(entry.key);
        }
        break;
      case "FormattedStringExpression":
      case "TemplateStringExpression":
        for (const interpolation of current.interpolations) {
          pushFormattedInterpolationExpressions(pending, interpolation);
        }
        break;
      case "LambdaExpression":
        pending.push(
          ...current.parameters.flatMap(({ defaultValue }) =>
            defaultValue === undefined ? [] : [defaultValue],
          ),
        );
        break;
      case "ListExpression":
      case "SetExpression":
      case "TupleExpression":
        pending.push(...current.elements);
        break;
      case "SliceExpression":
        pending.push(
          current.object,
          ...[current.start, current.stop, current.step].filter(
            (part): part is Expression => part !== undefined,
          ),
        );
        break;
      case "StarredExpression":
        pending.push(current.value);
        break;
      case "SubscriptExpression":
        pending.push(current.object, current.index);
        break;
      case "UnaryExpression":
        pending.push(current.operand);
        break;
      case "IdentifierExpression":
      case "LiteralExpression":
        break;
    }
  }
  return false;
}

function pushFormattedInterpolationExpressions(
  pending: Expression[],
  interpolation: TemplateStringInterpolation,
): void {
  pending.push(interpolation.value);
  for (const part of interpolation.formatSpec) {
    if (typeof part !== "string") {
      pushFormattedInterpolationExpressions(pending, part);
    }
  }
}

function directAnnotationReferences(
  expression: Expression,
): ReadonlySet<string> {
  const names = new Set<string>();
  const pending: unknown[] = [expression];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === null || typeof current !== "object") continue;
    if (Array.isArray(current)) {
      pending.push(...(current as unknown[]));
      continue;
    }
    const candidate = current as Record<string, unknown>;
    if (candidate.kind === "IdentifierExpression") {
      names.add(candidate.name as string);
      continue;
    }
    if (candidate.kind === "LambdaExpression") {
      const parameters = candidate.parameters as readonly Parameter[];
      pending.push(
        ...parameters.flatMap(({ defaultValue }) =>
          defaultValue === undefined ? [] : [defaultValue],
        ),
      );
      continue;
    }
    if (candidate.kind === "ComprehensionExpression") {
      const clauses = candidate.clauses as readonly ComprehensionClause[];
      const leftmost = clauses[0];
      if (leftmost?.clauseKind === "for") pending.push(leftmost.iterable);
      continue;
    }
    for (const [key, value] of Object.entries(candidate)) {
      if (key !== "kind" && key !== "span") pending.push(value);
    }
  }
  return names;
}

interface FormattedStringFieldSource {
  readonly close: number;
  readonly conversion: "a" | "r" | "s" | null;
  readonly debugText?: string;
  readonly expression: string;
  readonly formatSpec: string;
}

function splitFormattedStringField(
  template: string,
  start: number,
  label: "Formatted" | "Template",
): FormattedStringFieldSource {
  let quote: "'" | '"' | undefined;
  let escaped = false;
  let parentheses = 0;
  let brackets = 0;
  let braces = 0;
  let close = -1;
  for (let index = start; index < template.length; index += 1) {
    const character = template[index]!;
    if (quote !== undefined) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "(") parentheses += 1;
    else if (character === ")") parentheses -= 1;
    else if (character === "[") brackets += 1;
    else if (character === "]") brackets -= 1;
    else if (character === "{") braces += 1;
    else if (character === "}" && braces > 0) braces -= 1;
    else if (
      character === "}" &&
      parentheses === 0 &&
      brackets === 0 &&
      braces === 0
    ) {
      close = index;
      break;
    }
  }
  if (close === -1) {
    throw new LanguageSyntaxError(
      `Unclosed ${label.toLowerCase()} string interpolation`,
      {
        start: { column: 1, line: 1, offset: start - 1 },
        end: { column: 1, line: 1, offset: template.length },
      },
    );
  }

  const source = template.slice(start, close);
  quote = undefined;
  escaped = false;
  parentheses = 0;
  brackets = 0;
  braces = 0;
  let conversionIndex = -1;
  let formatIndex = -1;
  let debugIndex = -1;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (quote !== undefined) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "(") parentheses += 1;
    else if (character === ")") parentheses -= 1;
    else if (character === "[") brackets += 1;
    else if (character === "]") brackets -= 1;
    else if (character === "{") braces += 1;
    else if (character === "}") braces -= 1;
    if (parentheses !== 0 || brackets !== 0 || braces !== 0) continue;
    if (character === "!" && conversionIndex === -1 && formatIndex === -1) {
      conversionIndex = index;
      continue;
    }
    if (character === ":" && formatIndex === -1) {
      formatIndex = index;
      continue;
    }
    const previous = source[index - 1] ?? "";
    const next = source[index + 1] ?? "";
    if (
      character === "=" &&
      debugIndex === -1 &&
      conversionIndex === -1 &&
      formatIndex === -1 &&
      !"<>=!:".includes(previous) &&
      next !== "="
    ) {
      debugIndex = index;
    }
  }

  const expressionEnd = Math.min(
    ...[debugIndex, conversionIndex, formatIndex, source.length].filter(
      (index) => index >= 0,
    ),
  );
  const conversionSource =
    conversionIndex === -1
      ? ""
      : source.slice(
          conversionIndex + 1,
          formatIndex === -1 ? source.length : formatIndex,
        );
  if (conversionSource !== "" && !["a", "r", "s"].includes(conversionSource)) {
    throw new LanguageSyntaxError(
      `Invalid ${label.toLowerCase()} string conversion`,
      {
        start: { column: 1, line: 1, offset: start + conversionIndex },
        end: { column: 1, line: 1, offset: start + close },
      },
    );
  }
  const conversion =
    conversionSource === "a" ||
    conversionSource === "r" ||
    conversionSource === "s"
      ? conversionSource
      : debugIndex !== -1 && formatIndex === -1
        ? "r"
        : null;
  return {
    close,
    conversion,
    ...(debugIndex === -1
      ? {}
      : {
          debugText: source.slice(
            0,
            conversionIndex === -1
              ? formatIndex === -1
                ? source.length
                : formatIndex
              : conversionIndex,
          ),
        }),
    expression: source.slice(0, expressionEnd),
    formatSpec:
      formatIndex === -1 ? "" : source.slice(formatIndex + 1, source.length),
  };
}

function isAugmentedAssignmentOperator(value: string): boolean {
  return [
    "+=",
    "-=",
    "*=",
    "/=",
    "//=",
    "%=",
    "**=",
    "<<=",
    ">>=",
    "&=",
    "^=",
    "|=",
  ].includes(value);
}

function identifierName(token: Token): string {
  return typeof token.literal === "string" ? token.literal : token.lexeme;
}
