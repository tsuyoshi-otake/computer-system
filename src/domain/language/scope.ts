import type {
  AnnotationScopeOwner,
  AssignmentTarget,
  ClassDefinition,
  Expression,
  FormattedStringInterpolation,
  FunctionScopeNode,
  Module,
  Pattern,
  ScopeNode,
  Statement,
  TypeParameter,
} from "./ast.js";
import { LanguageSyntaxError } from "./errors.js";
import type { SourceSpan } from "./source.js";

export type ScopeKind = "annotation" | "class" | "function" | "module";
export type ScopeBinding = "cell" | "free" | "global" | "local";

export const comprehensionIteratorName = "<comprehension-iterator>";
export const comprehensionResultName = "<comprehension-result>";

export interface ScopeSymbol {
  readonly assigned: boolean;
  readonly binding: ScopeBinding;
  readonly declaredGlobal: boolean;
  readonly declaredNonlocal: boolean;
  readonly name: string;
  readonly parameter: boolean;
  readonly referenced: boolean;
}

export interface ScopeInfo {
  readonly children: readonly ScopeInfo[];
  readonly freeNames: readonly string[];
  readonly kind: ScopeKind;
  readonly name: string;
  readonly needsClassCell: boolean;
  readonly span: SourceSpan;
  readonly symbols: readonly ScopeSymbol[];
}

export interface ScopeAnalysis {
  readonly annotationScopes: ReadonlyMap<AnnotationScopeOwner, ScopeInfo>;
  readonly classScopes: ReadonlyMap<ClassDefinition, ScopeInfo>;
  readonly functionScopes: ReadonlyMap<FunctionScopeNode, ScopeInfo>;
  readonly root: ScopeInfo;
}

export interface ScopeAnalysisLimits {
  readonly maxScopeNesting: number;
  readonly maxScopes: number;
  readonly maxSymbolsPerScope: number;
}

export const defaultScopeAnalysisLimits: ScopeAnalysisLimits = Object.freeze({
  maxScopeNesting: 64,
  maxScopes: 1_024,
  maxSymbolsPerScope: 4_096,
});

interface RawScope {
  readonly assigned: Map<string, SourceSpan>;
  readonly children: RawScope[];
  readonly globalDeclarations: Map<string, SourceSpan>;
  readonly kind: ScopeKind;
  readonly nesting: number;
  readonly names: Set<string>;
  readonly node: AnnotationScopeOwner | ScopeNode;
  readonly nonlocalDeclarations: Map<string, SourceSpan>;
  readonly parameters: Set<string>;
  readonly parent?: RawScope;
  readonly referenced: Map<string, SourceSpan>;
  readonly typeParameters: Set<string>;
  readonly comprehensionTargets: ReadonlySet<string>;
  directYield: boolean;
  implicitClassCell: boolean;
  valuedReturnSpan?: SourceSpan;
}

interface CollectionState {
  readonly annotationScopes: Map<AnnotationScopeOwner, RawScope>;
  readonly limits: ScopeAnalysisLimits;
  scopeCount: number;
}

interface ResolvedScope {
  readonly freeNames: ReadonlySet<string>;
  readonly info: ScopeInfo;
}

interface AncestorBindingScope {
  readonly locals: ReadonlySet<string>;
  readonly typeParameters: ReadonlySet<string>;
}

export function analyzeScopes(
  module: Module,
  limitOverrides: Partial<ScopeAnalysisLimits> = {},
): ScopeAnalysis {
  const limits = resolveScopeAnalysisLimits(limitOverrides);
  const state: CollectionState = {
    annotationScopes: new Map(),
    limits,
    scopeCount: 1,
  };
  const rawRoot = createRawScope(module, "module", 0, undefined, new Set());
  collectStatements(rawRoot, module.body, state, 0);
  const classScopes = new Map<ClassDefinition, ScopeInfo>();
  const functionScopes = new Map<FunctionScopeNode, ScopeInfo>();
  const annotationScopes = new Map<AnnotationScopeOwner, ScopeInfo>();
  const root = resolveScope(
    rawRoot,
    [],
    classScopes,
    functionScopes,
    annotationScopes,
  ).info;
  return { annotationScopes, classScopes, functionScopes, root };
}

function resolveScopeAnalysisLimits(
  overrides: Partial<ScopeAnalysisLimits>,
): ScopeAnalysisLimits {
  const limits = Object.freeze({ ...defaultScopeAnalysisLimits, ...overrides });
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError(`${name} must be a positive safe integer`);
    }
  }
  return limits;
}

function createRawScope(
  node: AnnotationScopeOwner | ScopeNode,
  kind: ScopeKind,
  nesting: number,
  parent: RawScope | undefined,
  comprehensionTargets: ReadonlySet<string>,
): RawScope {
  return {
    assigned: new Map(),
    children: [],
    globalDeclarations: new Map(),
    kind,
    nesting,
    names: new Set(),
    node,
    nonlocalDeclarations: new Map(),
    parameters: new Set(),
    parent,
    referenced: new Map(),
    typeParameters: new Set(),
    comprehensionTargets,
    directYield: false,
    implicitClassCell: false,
  };
}

function collectStatements(
  scope: RawScope,
  statements: readonly Statement[],
  state: CollectionState,
  nesting: number,
): void {
  for (const statement of statements) {
    switch (statement.kind) {
      case "AnnotatedAssignmentStatement":
        if (statement.value !== undefined) {
          collectExpression(scope, statement.value, state);
        }
        collectAssignmentTarget(scope, statement.target, state);
        if (
          statement.simpleTarget &&
          (scope.kind === "module" || scope.kind === "class")
        ) {
          collectExpression(
            ensureAnnotationScope(
              scope,
              scope.node as Module | ClassDefinition,
              state,
            ),
            statement.annotation,
            state,
          );
        }
        break;
      case "AssertStatement":
        collectExpression(scope, statement.test, state);
        if (statement.message !== undefined) {
          collectExpression(scope, statement.message, state);
        }
        break;
      case "AssignmentStatement":
        collectExpression(scope, statement.value, state);
        for (const target of statement.targets) {
          collectAssignmentTarget(scope, target, state);
        }
        break;
      case "AugmentedAssignmentStatement":
        if (statement.target.kind === "IdentifierExpression") {
          referenceName(
            scope,
            statement.target.name,
            statement.target.span,
            state,
          );
          assignName(
            scope,
            statement.target.name,
            statement.target.span,
            state,
          );
        } else {
          collectAssignmentTarget(scope, statement.target, state);
        }
        collectExpression(scope, statement.value, state);
        break;
      case "BreakStatement":
      case "ContinueStatement":
      case "PassStatement":
        break;
      case "DeleteStatement":
        collectAssignmentTarget(scope, statement.target, state);
        break;
      case "ClassDefinition": {
        for (const decorator of statement.decorators) {
          collectExpression(scope, decorator, state);
        }
        const classDefinitionScope =
          statement.typeParameters.length > 0
            ? ensureAnnotationScope(scope, statement, state)
            : scope;
        collectTypeParameters(
          classDefinitionScope,
          statement.typeParameters,
          state,
        );
        for (const base of statement.bases) {
          collectExpression(classDefinitionScope, base, state);
        }
        assignName(scope, statement.name, statement.span, state);
        collectClassScope(classDefinitionScope, statement, state);
        break;
      }
      case "ExpressionStatement":
        collectExpression(scope, statement.expression, state);
        break;
      case "ForStatement":
        if (statement.asynchronous && !isCoroutineContext(scope)) {
          throw new LanguageSyntaxError(
            "async for outside async function",
            statement.span,
          );
        }
        collectExpression(scope, statement.iterable, state);
        assignName(scope, statement.target.name, statement.target.span, state);
        collectStatements(scope, statement.body, state, nesting);
        break;
      case "FunctionDefinition": {
        for (const decorator of statement.decorators) {
          collectExpression(scope, decorator, state);
        }
        for (const parameter of statement.parameters) {
          if (parameter.defaultValue !== undefined) {
            collectExpression(scope, parameter.defaultValue, state);
          }
        }
        const annotatedParameters = statement.parameters.filter(
          ({ annotation }) => annotation !== undefined,
        );
        const needsAnnotationScope =
          statement.typeParameters.length > 0 ||
          annotatedParameters.length > 0 ||
          statement.returnAnnotation !== undefined;
        const definitionScope = needsAnnotationScope
          ? ensureAnnotationScope(scope, statement, state)
          : scope;
        collectTypeParameters(definitionScope, statement.typeParameters, state);
        if (
          annotatedParameters.length > 0 ||
          statement.returnAnnotation !== undefined
        ) {
          for (const parameter of annotatedParameters) {
            collectExpression(definitionScope, parameter.annotation!, state);
          }
          if (statement.returnAnnotation !== undefined) {
            collectExpression(
              definitionScope,
              statement.returnAnnotation,
              state,
            );
          }
        }
        assignName(scope, statement.name, statement.span, state);
        collectFunctionScope(definitionScope, statement, state);
        break;
      }
      case "GlobalStatement":
        declareNames(scope, statement.names, "global", state);
        break;
      case "IfStatement":
        for (const branch of statement.branches) {
          collectExpression(scope, branch.test, state);
          collectStatements(scope, branch.body, state, nesting);
        }
        collectStatements(scope, statement.elseBody ?? [], state, nesting);
        break;
      case "ImportStatement":
        for (const imported of statement.imports) {
          assignName(
            scope,
            imported.alias ?? imported.module.split(".")[0]!,
            imported.span,
            state,
          );
        }
        break;
      case "MatchStatement":
        collectExpression(scope, statement.subject, state);
        for (const matchCase of statement.cases) {
          collectPattern(scope, matchCase.pattern, state);
          if (matchCase.guard !== undefined) {
            collectExpression(scope, matchCase.guard, state);
          }
          collectStatements(scope, matchCase.body, state, nesting);
        }
        break;
      case "FromImportStatement":
        if (statement.wildcard) {
          if (scope.kind !== "module") {
            throw new LanguageSyntaxError(
              "import * is only allowed at module level",
              statement.span,
            );
          }
          break;
        }
        for (const imported of statement.imports) {
          assignName(
            scope,
            imported.alias ?? imported.name,
            imported.span,
            state,
          );
        }
        break;
      case "NonlocalStatement":
        declareNames(scope, statement.names, "nonlocal", state);
        break;
      case "RaiseStatement":
      case "ReturnStatement":
      case "YieldStatement":
        if (statement.kind === "YieldStatement") scope.directYield = true;
        if (
          statement.kind === "ReturnStatement" &&
          statement.value !== undefined
        ) {
          scope.valuedReturnSpan ??= statement.span;
        }
        if (
          statement.kind === "YieldStatement" &&
          statement.delegate &&
          isDirectAsyncFunctionScope(scope)
        ) {
          throw new LanguageSyntaxError(
            "yield from inside async function is not allowed",
            statement.span,
          );
        }
        if (statement.value !== undefined) {
          collectExpression(scope, statement.value, state);
        }
        break;
      case "TryStatement":
        collectStatements(scope, statement.body, state, nesting);
        for (const handler of statement.handlers) {
          if (handler.type !== undefined) {
            collectExpression(scope, handler.type, state);
          }
          if (handler.name !== undefined) {
            assignName(scope, handler.name, handler.span, state);
          }
          collectStatements(scope, handler.body, state, nesting);
        }
        collectStatements(scope, statement.elseBody ?? [], state, nesting);
        collectStatements(scope, statement.finallyBody ?? [], state, nesting);
        break;
      case "TypeAliasStatement": {
        assignName(scope, statement.name, statement.span, state);
        const aliasScope = ensureAnnotationScope(scope, statement, state);
        collectTypeParameters(aliasScope, statement.typeParameters, state);
        collectExpression(aliasScope, statement.value, state);
        break;
      }
      case "WithStatement":
        if (statement.asynchronous && !isCoroutineContext(scope)) {
          throw new LanguageSyntaxError(
            "async with outside async function",
            statement.span,
          );
        }
        for (const item of statement.items) {
          collectExpression(scope, item.context, state);
          if (item.target !== undefined) {
            collectAssignmentTarget(scope, item.target, state);
          }
        }
        collectStatements(scope, statement.body, state, nesting);
        break;
      case "WhileStatement":
        collectExpression(scope, statement.test, state);
        collectStatements(scope, statement.body, state, nesting);
        break;
    }
  }
}

function collectTypeParameters(
  scope: RawScope,
  parameters: readonly TypeParameter[],
  state: CollectionState,
): void {
  for (const parameter of parameters) {
    assignName(scope, parameter.name, parameter.span, state);
    scope.typeParameters.add(parameter.name);
    if (parameter.kind === "TypeVariable" && parameter.bound !== undefined) {
      collectExpression(scope, parameter.bound, state);
    }
    if (parameter.defaultValue !== undefined) {
      collectExpression(scope, parameter.defaultValue, state);
    }
  }
}

function ensureAnnotationScope(
  parent: RawScope,
  owner: AnnotationScopeOwner,
  state: CollectionState,
): RawScope {
  const existing = state.annotationScopes.get(owner);
  if (existing !== undefined) return existing;
  assertScopeCapacity(parent, owner, state);
  const annotation = createRawScope(
    owner,
    "annotation",
    parent.nesting + 1,
    parent,
    new Set(),
  );
  parent.children.push(annotation);
  state.annotationScopes.set(owner, annotation);
  return annotation;
}

function collectPattern(
  scope: RawScope,
  pattern: Pattern,
  state: CollectionState,
): void {
  switch (pattern.kind) {
    case "CapturePattern":
      assignName(scope, pattern.name, pattern.span, state);
      break;
    case "StarPattern":
      if (pattern.name !== undefined) {
        assignName(scope, pattern.name, pattern.span, state);
      }
      break;
    case "AsPattern":
      collectPattern(scope, pattern.pattern, state);
      assignName(scope, pattern.name, pattern.span, state);
      break;
    case "ClassPattern":
      collectExpression(scope, pattern.className, state);
      for (const positional of pattern.positional) {
        collectPattern(scope, positional, state);
      }
      for (const keyword of pattern.keywords) {
        collectPattern(scope, keyword.pattern, state);
      }
      break;
    case "MappingPattern":
      for (const entry of pattern.entries) {
        collectExpression(scope, entry.key, state);
        collectPattern(scope, entry.pattern, state);
      }
      if (pattern.rest !== undefined) {
        assignName(scope, pattern.rest, pattern.span, state);
      }
      break;
    case "OrPattern":
      for (const alternative of pattern.alternatives) {
        collectPattern(scope, alternative, state);
      }
      break;
    case "SequencePattern":
      for (const element of pattern.elements) {
        collectPattern(scope, element, state);
      }
      break;
    case "ValuePattern":
      collectExpression(scope, pattern.value, state);
      break;
    case "LiteralPattern":
    case "WildcardPattern":
      break;
  }
}

function collectFunctionScope(
  parent: RawScope,
  node: FunctionScopeNode,
  state: CollectionState,
): void {
  assertScopeCapacity(parent, node, state);
  if (node.kind === "ComprehensionExpression") {
    collectComprehensionScope(parent, node, state);
    return;
  }
  const child = createRawScope(
    node,
    "function",
    parent.nesting + 1,
    parent,
    new Set(),
  );
  for (const parameter of node.parameters) {
    assignName(child, parameter.name, parameter.span, state);
    child.parameters.add(parameter.name);
  }
  if (node.kind === "FunctionDefinition") {
    collectStatements(child, node.body, state, child.nesting);
    if (
      node.asynchronous &&
      child.directYield &&
      child.valuedReturnSpan !== undefined
    ) {
      throw new LanguageSyntaxError(
        "return with value in async generator",
        child.valuedReturnSpan,
      );
    }
  } else {
    collectExpression(child, node.body, state);
  }
  if (child.referenced.has("super") && !child.assigned.has("super")) {
    child.implicitClassCell = true;
  }
  parent.children.push(child);
}

function collectClassScope(
  parent: RawScope,
  node: ClassDefinition,
  state: CollectionState,
): void {
  assertScopeCapacity(parent, node, state);
  const child = createRawScope(
    node,
    "class",
    parent.nesting + 1,
    parent,
    new Set(),
  );
  collectStatements(child, node.body, state, child.nesting);
  parent.children.push(child);
}

function assertScopeCapacity(
  parent: RawScope,
  node: AnnotationScopeOwner | ScopeNode,
  state: CollectionState,
): void {
  if (parent.nesting >= state.limits.maxScopeNesting) {
    throw new LanguageSyntaxError(
      `Scope nesting limit exceeded (max ${state.limits.maxScopeNesting})`,
      node.span,
    );
  }
  if (state.scopeCount >= state.limits.maxScopes) {
    throw new LanguageSyntaxError(
      `Scope count limit exceeded (max ${state.limits.maxScopes})`,
      node.span,
    );
  }
  state.scopeCount += 1;
}

function collectComprehensionScope(
  parent: RawScope,
  node: Extract<FunctionScopeNode, { kind: "ComprehensionExpression" }>,
  state: CollectionState,
): void {
  const firstClause = node.clauses[0];
  if (firstClause?.clauseKind !== "for") {
    throw new LanguageSyntaxError(
      "Comprehension requires a for clause",
      node.span,
    );
  }
  if (
    isAsynchronousComprehension(node) &&
    node.containerKind !== "generator" &&
    !isCoroutineContext(parent)
  ) {
    throw new LanguageSyntaxError(
      "asynchronous comprehension outside async function",
      node.span,
    );
  }
  assertNoNamedExpression(firstClause.iterable);
  collectExpression(parent, firstClause.iterable, state);

  const targets = new Set(parent.comprehensionTargets);
  for (const clause of node.clauses) {
    if (clause.clauseKind === "for") {
      collectTargetNames(clause.target, targets);
    }
  }
  const child = createRawScope(
    node,
    "function",
    parent.nesting + 1,
    parent,
    targets,
  );
  assignName(child, comprehensionIteratorName, node.span, state);
  child.parameters.add(comprehensionIteratorName);
  assignName(child, comprehensionResultName, node.span, state);
  for (const clause of node.clauses) {
    if (clause.clauseKind === "for") {
      collectAssignmentTarget(child, clause.target, state);
    }
  }
  for (const [index, clause] of node.clauses.entries()) {
    if (clause.clauseKind === "for") {
      if (index === 0) continue;
      assertNoNamedExpression(clause.iterable);
      collectExpression(child, clause.iterable, state);
    } else {
      collectExpression(child, clause.condition, state);
    }
  }
  if (node.containerKind === "dictionary") {
    collectExpression(child, node.key!, state);
    collectExpression(child, node.value!, state);
  } else {
    collectExpression(child, node.element!, state);
  }
  parent.children.push(child);
}

function collectTargetNames(
  target: AssignmentTarget,
  names: Set<string>,
): void {
  if (target.kind === "IdentifierExpression") {
    names.add(target.name);
  } else if (
    target.kind === "ListExpression" ||
    target.kind === "TupleExpression"
  ) {
    for (const element of target.elements) collectTargetNames(element, names);
  } else if (target.kind === "StarredExpression") {
    collectTargetNames(target.value, names);
  }
}

function assertNoNamedExpression(expression: Expression): void {
  const pending: unknown[] = [expression];
  const seen = new Set<object>();
  while (pending.length > 0) {
    const value = pending.pop();
    if (typeof value !== "object" || value === null || seen.has(value))
      continue;
    seen.add(value);
    if (
      "kind" in value &&
      value.kind === "NamedExpression" &&
      "span" in value
    ) {
      throw new LanguageSyntaxError(
        "Assignment expressions are not allowed in comprehension iterables",
        value.span as SourceSpan,
      );
    }
    if (Array.isArray(value)) {
      const values = value as readonly unknown[];
      pending.push(...values);
    } else {
      pending.push(...Object.values(value as Record<string, unknown>));
    }
  }
}

function declareNames(
  scope: RawScope,
  declarations: readonly { readonly name: string; readonly span: SourceSpan }[],
  kind: "global" | "nonlocal",
  state: CollectionState,
): void {
  for (const declaration of declarations) {
    const { name, span } = declaration;
    trackName(scope, name, span, state);
    if (kind === "nonlocal" && scope.kind === "module") {
      throw new LanguageSyntaxError(
        "nonlocal declaration is not allowed at module scope",
        span,
      );
    }
    const sameDeclarations =
      kind === "global" ? scope.globalDeclarations : scope.nonlocalDeclarations;
    const otherDeclarations =
      kind === "global" ? scope.nonlocalDeclarations : scope.globalDeclarations;
    if (otherDeclarations.has(name)) {
      throw new LanguageSyntaxError(
        `${name} is declared as both global and nonlocal`,
        span,
      );
    }
    if (scope.parameters.has(name)) {
      throw new LanguageSyntaxError(`${name} is a parameter and ${kind}`, span);
    }
    if (scope.assigned.has(name)) {
      throw new LanguageSyntaxError(
        `${name} is assigned prior to ${kind} declaration`,
        span,
      );
    }
    if (scope.referenced.has(name)) {
      throw new LanguageSyntaxError(
        `${name} is used prior to ${kind} declaration`,
        span,
      );
    }
    sameDeclarations.set(name, span);
  }
}

function collectAssignmentTarget(
  scope: RawScope,
  target: AssignmentTarget,
  state: CollectionState,
): void {
  switch (target.kind) {
    case "IdentifierExpression":
      assignName(scope, target.name, target.span, state);
      break;
    case "AttributeExpression":
      collectExpression(scope, target.object, state);
      break;
    case "SubscriptExpression":
      collectExpression(scope, target.object, state);
      collectExpression(scope, target.index, state);
      break;
    case "SliceExpression":
      collectExpression(scope, target.object, state);
      if (target.start !== undefined)
        collectExpression(scope, target.start, state);
      if (target.stop !== undefined)
        collectExpression(scope, target.stop, state);
      if (target.step !== undefined)
        collectExpression(scope, target.step, state);
      break;
    case "ListExpression":
    case "TupleExpression":
      for (const element of target.elements) {
        collectAssignmentTarget(scope, element, state);
      }
      break;
    case "StarredExpression":
      collectAssignmentTarget(scope, target.value, state);
      break;
  }
}

function collectExpression(
  scope: RawScope,
  expression: Expression,
  state: CollectionState,
): void {
  switch (expression.kind) {
    case "AttributeExpression":
      collectExpression(scope, expression.object, state);
      break;
    case "AwaitExpression":
      if (!isCoroutineContext(scope)) {
        throw new LanguageSyntaxError(
          "await outside async function",
          expression.span,
        );
      }
      collectExpression(scope, expression.value, state);
      break;
    case "BinaryExpression":
      collectExpression(scope, expression.left, state);
      collectExpression(scope, expression.right, state);
      break;
    case "BooleanExpression":
      for (const value of expression.values) {
        collectExpression(scope, value, state);
      }
      break;
    case "CallExpression":
      collectExpression(scope, expression.callee, state);
      for (const argument of expression.arguments) {
        collectExpression(scope, argument.value, state);
      }
      break;
    case "ComparisonExpression":
      collectExpression(scope, expression.left, state);
      for (const comparison of expression.comparisons) {
        collectExpression(scope, comparison.right, state);
      }
      break;
    case "ComprehensionExpression":
      collectFunctionScope(scope, expression, state);
      break;
    case "ConditionalExpression":
      collectExpression(scope, expression.condition, state);
      collectExpression(scope, expression.whenTrue, state);
      collectExpression(scope, expression.whenFalse, state);
      break;
    case "DictionaryExpression":
      for (const entry of expression.entries) {
        if (entry.entryKind === "pair") {
          collectExpression(scope, entry.key, state);
        }
        collectExpression(scope, entry.value, state);
      }
      break;
    case "FormattedStringExpression":
    case "TemplateStringExpression":
      for (const interpolation of expression.interpolations) {
        collectFormattedInterpolation(scope, interpolation, state);
      }
      break;
    case "IdentifierExpression":
      referenceName(scope, expression.name, expression.span, state);
      break;
    case "ListExpression":
    case "TupleExpression":
      for (const element of expression.elements) {
        collectExpression(scope, element, state);
      }
      break;
    case "LambdaExpression":
      for (const parameter of expression.parameters) {
        if (parameter.defaultValue !== undefined) {
          collectExpression(scope, parameter.defaultValue, state);
        }
      }
      collectFunctionScope(scope, expression, state);
      break;
    case "LiteralExpression":
      break;
    case "NamedExpression":
      collectExpression(scope, expression.value, state);
      if (scope.node.kind === "ComprehensionExpression") {
        if (scope.comprehensionTargets.has(expression.target.name)) {
          throw new LanguageSyntaxError(
            `Assignment expression cannot rebind comprehension target ${expression.target.name}`,
            expression.target.span,
          );
        }
        const owner = comprehensionBindingOwner(scope);
        assignName(
          owner,
          expression.target.name,
          expression.target.span,
          state,
        );
        referenceName(
          scope,
          expression.target.name,
          expression.target.span,
          state,
        );
      } else {
        assignName(
          scope,
          expression.target.name,
          expression.target.span,
          state,
        );
      }
      break;
    case "SetExpression":
      for (const element of expression.elements) {
        collectExpression(scope, element, state);
      }
      break;
    case "SubscriptExpression":
      collectExpression(scope, expression.object, state);
      collectExpression(scope, expression.index, state);
      break;
    case "SliceExpression":
      collectExpression(scope, expression.object, state);
      if (expression.start !== undefined) {
        collectExpression(scope, expression.start, state);
      }
      if (expression.stop !== undefined) {
        collectExpression(scope, expression.stop, state);
      }
      if (expression.step !== undefined) {
        collectExpression(scope, expression.step, state);
      }
      break;
    case "StarredExpression":
      collectExpression(scope, expression.value, state);
      break;
    case "UnaryExpression":
      collectExpression(scope, expression.operand, state);
      break;
    case "YieldExpression":
      if (scope.node.kind === "ComprehensionExpression") {
        throw new LanguageSyntaxError(
          "yield inside a comprehension is not allowed",
          expression.span,
        );
      }
      scope.directYield = true;
      if (expression.value !== undefined) {
        collectExpression(scope, expression.value, state);
      }
      if (expression.delegate && isDirectAsyncFunctionScope(scope)) {
        throw new LanguageSyntaxError(
          "yield from inside async function is not allowed",
          expression.span,
        );
      }
      break;
  }
}

function collectFormattedInterpolation(
  scope: RawScope,
  interpolation: FormattedStringInterpolation,
  state: CollectionState,
): void {
  collectExpression(scope, interpolation.value, state);
  for (const part of interpolation.formatSpec) {
    if (typeof part !== "string") {
      collectFormattedInterpolation(scope, part, state);
    }
  }
}

function isDirectAsyncFunctionScope(scope: RawScope): boolean {
  return (
    scope.kind === "function" &&
    scope.node.kind === "FunctionDefinition" &&
    scope.node.asynchronous
  );
}

function isCoroutineContext(scope: RawScope): boolean {
  let current: RawScope | undefined = scope;
  while (current !== undefined) {
    if (current.kind === "annotation" || current.kind === "class") return false;
    if (current.kind === "module") return false;
    if (
      current.node.kind === "ComprehensionExpression" &&
      isAsynchronousComprehension(current.node)
    ) {
      return true;
    }
    if (current.node.kind === "FunctionDefinition") {
      return current.node.asynchronous;
    }
    if (current.node.kind === "LambdaExpression") return false;
    current = current.parent;
  }
  return false;
}

export function isAsynchronousComprehension(
  node: Extract<FunctionScopeNode, { kind: "ComprehensionExpression" }>,
): boolean {
  if (
    node.clauses.some(
      (clause) => clause.clauseKind === "for" && clause.asynchronous,
    )
  ) {
    return true;
  }
  const expressions: Expression[] = [];
  for (const [index, clause] of node.clauses.entries()) {
    if (clause.clauseKind === "if") expressions.push(clause.condition);
    else if (index > 0) expressions.push(clause.iterable);
  }
  if (node.containerKind === "dictionary") {
    expressions.push(node.key!, node.value!);
  } else {
    expressions.push(node.element!);
  }
  return expressions.some(expressionContainsDirectAwait);
}

function expressionContainsDirectAwait(expression: Expression): boolean {
  const pending: unknown[] = [expression];
  const seen = new Set<object>();
  while (pending.length > 0) {
    const value = pending.pop();
    if (typeof value !== "object" || value === null || seen.has(value))
      continue;
    seen.add(value);
    if (!("kind" in value) || typeof value.kind !== "string") continue;
    if (value.kind === "AwaitExpression") return true;
    if (
      value !== expression &&
      (value.kind === "ComprehensionExpression" ||
        value.kind === "LambdaExpression")
    ) {
      continue;
    }
    for (const child of Object.values(value)) pending.push(child);
  }
  return false;
}

function comprehensionBindingOwner(scope: RawScope): RawScope {
  let owner = scope;
  while (owner.node.kind === "ComprehensionExpression") {
    if (owner.parent === undefined) {
      throw new Error("Comprehension scope has no containing scope");
    }
    owner = owner.parent;
  }
  return owner;
}

function assignName(
  scope: RawScope,
  name: string,
  span: SourceSpan,
  state: CollectionState,
): void {
  if (name === "__debug__") {
    throw new LanguageSyntaxError("cannot assign to __debug__", span);
  }
  trackName(scope, name, span, state);
  if (!scope.assigned.has(name)) scope.assigned.set(name, span);
}

function referenceName(
  scope: RawScope,
  name: string,
  span: SourceSpan,
  state: CollectionState,
): void {
  trackName(scope, name, span, state);
  if (!scope.referenced.has(name)) scope.referenced.set(name, span);
}

function trackName(
  scope: RawScope,
  name: string,
  span: SourceSpan,
  state: CollectionState,
): void {
  if (scope.names.has(name)) return;
  if (scope.names.size >= state.limits.maxSymbolsPerScope) {
    throw new LanguageSyntaxError(
      `Symbol limit exceeded (max ${state.limits.maxSymbolsPerScope})`,
      span,
    );
  }
  scope.names.add(name);
}

function resolveScope(
  raw: RawScope,
  ancestorFunctionLocals: readonly AncestorBindingScope[],
  classScopes: Map<ClassDefinition, ScopeInfo>,
  functionScopes: Map<FunctionScopeNode, ScopeInfo>,
  annotationScopes: Map<AnnotationScopeOwner, ScopeInfo>,
): ResolvedScope {
  const localNames = new Set<string>();
  if (raw.kind !== "module") {
    for (const name of raw.assigned.keys()) {
      if (
        !raw.globalDeclarations.has(name) &&
        !raw.nonlocalDeclarations.has(name)
      ) {
        localNames.add(name);
      }
    }
  }
  const bindings = new Map<string, ScopeBinding>();
  const freeNames = new Set<string>();

  for (const name of raw.names) {
    if (raw.kind === "module") {
      bindings.set(name, "global");
    } else if (raw.kind === "annotation" && raw.typeParameters.has(name)) {
      bindings.set(name, "cell");
    } else if (
      raw.kind === "annotation" &&
      raw.parent?.kind === "class" &&
      raw.parent.assigned.has(name) &&
      !raw.parent.globalDeclarations.has(name) &&
      !raw.parent.nonlocalDeclarations.has(name)
    ) {
      bindings.set(name, "local");
    } else if (raw.globalDeclarations.has(name)) {
      bindings.set(name, "global");
    } else if (raw.nonlocalDeclarations.has(name)) {
      const ancestor = findAncestorBinding(name, ancestorFunctionLocals);
      if (ancestor === undefined) {
        throw new LanguageSyntaxError(
          `no binding for nonlocal ${name} found`,
          raw.nonlocalDeclarations.get(name)!,
        );
      }
      if (ancestor.typeParameters.has(name)) {
        throw new LanguageSyntaxError(
          `nonlocal binding not allowed for type parameter ${name}`,
          raw.nonlocalDeclarations.get(name)!,
        );
      }
      bindings.set(name, "free");
      freeNames.add(name);
    } else if (localNames.has(name)) {
      bindings.set(name, "local");
    } else if (hasAncestorBinding(name, ancestorFunctionLocals)) {
      bindings.set(name, "free");
      freeNames.add(name);
    } else {
      bindings.set(name, "global");
    }
  }

  if (raw.kind === "function" && raw.implicitClassCell) {
    freeNames.add("__class__");
  }
  const childAncestors =
    raw.kind === "function" || raw.kind === "annotation"
      ? [
          ...ancestorFunctionLocals,
          { locals: localNames, typeParameters: raw.typeParameters },
        ]
      : raw.kind === "class"
        ? [
            ...ancestorFunctionLocals,
            {
              locals: new Set(["__class__"]),
              typeParameters: new Set<string>(),
            },
          ]
        : ancestorFunctionLocals;
  const resolvedChildren = raw.children.map((child) =>
    resolveScope(
      child,
      childAncestors,
      classScopes,
      functionScopes,
      annotationScopes,
    ),
  );

  let needsClassCell = false;
  if (raw.kind === "function") {
    for (const child of resolvedChildren) {
      for (const name of child.freeNames) {
        if (localNames.has(name)) {
          bindings.set(name, "cell");
        } else if (hasAncestorBinding(name, ancestorFunctionLocals)) {
          bindings.set(name, "free");
          freeNames.add(name);
        }
      }
    }
  } else if (raw.kind === "class") {
    for (const name of localNames) {
      if (
        raw.referenced.has(name) &&
        hasAncestorBinding(name, ancestorFunctionLocals)
      ) {
        freeNames.add(name);
      }
    }
    for (const child of resolvedChildren) {
      for (const name of child.freeNames) {
        if (name === "__class__") {
          needsClassCell = true;
        } else if (hasAncestorBinding(name, ancestorFunctionLocals)) {
          freeNames.add(name);
        }
      }
    }
  } else if (raw.kind === "annotation") {
    for (const child of resolvedChildren) {
      for (const name of child.freeNames) {
        if (localNames.has(name)) {
          bindings.set(name, "cell");
        } else if (hasAncestorBinding(name, ancestorFunctionLocals)) {
          freeNames.add(name);
        }
      }
    }
  }

  const symbols = [...bindings].map(([name, binding]): ScopeSymbol => ({
    assigned: raw.assigned.has(name),
    binding,
    declaredGlobal: raw.globalDeclarations.has(name),
    declaredNonlocal: raw.nonlocalDeclarations.has(name),
    name,
    parameter: raw.parameters.has(name),
    referenced: raw.referenced.has(name),
  }));
  symbols.sort(({ name: left }, { name: right }) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  const info: ScopeInfo = Object.freeze({
    children: Object.freeze(resolvedChildren.map(({ info: child }) => child)),
    freeNames: Object.freeze([...freeNames].sort()),
    kind: raw.kind,
    name:
      raw.kind === "annotation"
        ? `<annotations of ${
            raw.node.kind === "Module"
              ? "module"
              : raw.node.kind === "ClassDefinition" ||
                  raw.node.kind === "FunctionDefinition" ||
                  raw.node.kind === "TypeAliasStatement"
                ? raw.node.name
                : "scope"
          }>`
        : raw.node.kind === "Module"
          ? "<module>"
          : raw.node.kind === "FunctionDefinition"
            ? raw.node.name
            : raw.node.kind === "ClassDefinition"
              ? raw.node.name
              : raw.node.kind === "LambdaExpression"
                ? "<lambda>"
                : raw.node.kind === "TypeAliasStatement"
                  ? raw.node.name
                  : `<${raw.node.containerKind}comp>`,
    needsClassCell,
    span: raw.node.span,
    symbols: Object.freeze(symbols),
  });
  if (raw.kind === "function") {
    functionScopes.set(raw.node as FunctionScopeNode, info);
  } else if (raw.kind === "class") {
    classScopes.set(raw.node as ClassDefinition, info);
  } else if (raw.kind === "annotation") {
    annotationScopes.set(raw.node as AnnotationScopeOwner, info);
  }
  return { freeNames, info };
}

function hasAncestorBinding(
  name: string,
  ancestorFunctionLocals: readonly AncestorBindingScope[],
): boolean {
  return findAncestorBinding(name, ancestorFunctionLocals) !== undefined;
}

function findAncestorBinding(
  name: string,
  ancestorFunctionLocals: readonly AncestorBindingScope[],
): AncestorBindingScope | undefined {
  for (let index = ancestorFunctionLocals.length - 1; index >= 0; index -= 1) {
    const scope = ancestorFunctionLocals[index]!;
    if (scope.locals.has(name)) return scope;
  }
  return undefined;
}
