import type { SourceSpan } from "./source.js";

export interface Module {
  readonly kind: "Module";
  readonly body: readonly Statement[];
  readonly span: SourceSpan;
}

export type Statement =
  | AnnotatedAssignmentStatement
  | AssertStatement
  | AssignmentStatement
  | AugmentedAssignmentStatement
  | BreakStatement
  | ClassDefinition
  | ContinueStatement
  | DeleteStatement
  | ExpressionStatement
  | ForStatement
  | FunctionDefinition
  | FromImportStatement
  | GlobalStatement
  | IfStatement
  | ImportStatement
  | MatchStatement
  | NonlocalStatement
  | PassStatement
  | RaiseStatement
  | ReturnStatement
  | TryStatement
  | TypeAliasStatement
  | WithStatement
  | WhileStatement
  | YieldStatement;

export type Expression =
  | AttributeExpression
  | AwaitExpression
  | BinaryExpression
  | BooleanExpression
  | CallExpression
  | ComparisonExpression
  | ComprehensionExpression
  | ConditionalExpression
  | DictionaryExpression
  | FormattedStringExpression
  | IdentifierExpression
  | ListExpression
  | LambdaExpression
  | LiteralExpression
  | NamedExpression
  | SliceExpression
  | SetExpression
  | SubscriptExpression
  | StarredExpression
  | TemplateStringExpression
  | TupleExpression
  | UnaryExpression
  | YieldExpression;

export interface NodeBase {
  readonly span: SourceSpan;
}

export interface AssignmentStatement extends NodeBase {
  readonly kind: "AssignmentStatement";
  readonly targets: readonly AssignmentTarget[];
  readonly value: Expression;
}

export interface AnnotatedAssignmentStatement extends NodeBase {
  readonly annotation: Expression;
  readonly kind: "AnnotatedAssignmentStatement";
  readonly simpleTarget: boolean;
  readonly target: AssignmentTarget;
  readonly value?: Expression;
}

export interface AssertStatement extends NodeBase {
  readonly kind: "AssertStatement";
  readonly test: Expression;
  readonly message?: Expression;
}

export interface AugmentedAssignmentStatement extends NodeBase {
  readonly kind: "AugmentedAssignmentStatement";
  readonly target: AssignmentTarget;
  readonly operator: BinaryExpression["operator"];
  readonly value: Expression;
}

export type AssignmentTarget =
  | AttributeExpression
  | IdentifierExpression
  | SequenceAssignmentTarget
  | SliceExpression
  | StarredAssignmentTarget
  | SubscriptExpression;

export type SequenceAssignmentTarget =
  | (ListExpression & { readonly elements: readonly AssignmentTarget[] })
  | (TupleExpression & { readonly elements: readonly AssignmentTarget[] });

export type StarredAssignmentTarget = StarredExpression & {
  readonly value: AssignmentTarget;
};

export type DeletionTarget =
  | AttributeExpression
  | IdentifierExpression
  | SliceExpression
  | SubscriptExpression
  | DeletionSequenceTarget;

export type DeletionSequenceTarget =
  | (ListExpression & { readonly elements: readonly DeletionTarget[] })
  | (TupleExpression & { readonly elements: readonly DeletionTarget[] });

export interface DeleteStatement extends NodeBase {
  readonly kind: "DeleteStatement";
  readonly target: DeletionTarget;
}

export interface BreakStatement extends NodeBase {
  readonly kind: "BreakStatement";
}

export interface ContinueStatement extends NodeBase {
  readonly kind: "ContinueStatement";
}

export interface ClassDefinition extends NodeBase {
  readonly bases: readonly Expression[];
  readonly body: readonly Statement[];
  readonly decorators: readonly Expression[];
  readonly kind: "ClassDefinition";
  readonly name: string;
  readonly typeParameters: readonly TypeParameter[];
}

export interface ExpressionStatement extends NodeBase {
  readonly kind: "ExpressionStatement";
  readonly expression: Expression;
}

export interface ForStatement extends NodeBase {
  readonly asynchronous: boolean;
  readonly kind: "ForStatement";
  readonly target: IdentifierExpression;
  readonly iterable: Expression;
  readonly body: readonly Statement[];
}

export interface FunctionDefinition extends NodeBase {
  readonly asynchronous: boolean;
  readonly decorators: readonly Expression[];
  readonly kind: "FunctionDefinition";
  readonly name: string;
  readonly parameters: readonly Parameter[];
  readonly returnAnnotation?: Expression;
  readonly typeParameters: readonly TypeParameter[];
  readonly body: readonly Statement[];
}

export type FunctionScopeNode =
  ComprehensionExpression | FunctionDefinition | LambdaExpression;

export type ScopeNode = ClassDefinition | FunctionScopeNode;

export type AnnotationScopeOwner =
  ClassDefinition | FunctionDefinition | Module | TypeAliasStatement;

export type TypeParameter =
  ParameterSpecification | TypeVariable | TypeVariableTuple;

interface TypeParameterBase extends NodeBase {
  readonly defaultValue?: Expression;
  readonly name: string;
}

export interface TypeVariable extends TypeParameterBase {
  readonly bound?: Expression;
  readonly kind: "TypeVariable";
}

export interface TypeVariableTuple extends TypeParameterBase {
  readonly kind: "TypeVariableTuple";
}

export interface ParameterSpecification extends TypeParameterBase {
  readonly kind: "ParameterSpecification";
}

export interface TypeAliasStatement extends NodeBase {
  readonly kind: "TypeAliasStatement";
  readonly name: string;
  readonly typeParameters: readonly TypeParameter[];
  readonly value: Expression;
}

export interface Parameter extends NodeBase {
  readonly annotation?: Expression;
  readonly parameterKind: ParameterKind;
  readonly name: string;
  readonly defaultValue?: Expression;
}

export type ParameterKind =
  | "keyword_only"
  | "positional_only"
  | "positional_or_keyword"
  | "variadic_keyword"
  | "variadic_positional";

export interface IfBranch extends NodeBase {
  readonly test: Expression;
  readonly body: readonly Statement[];
}

export interface IfStatement extends NodeBase {
  readonly kind: "IfStatement";
  readonly branches: readonly IfBranch[];
  readonly elseBody?: readonly Statement[];
}

export interface MatchStatement extends NodeBase {
  readonly cases: readonly MatchCase[];
  readonly kind: "MatchStatement";
  readonly subject: Expression;
}

export interface MatchCase extends NodeBase {
  readonly body: readonly Statement[];
  readonly guard?: Expression;
  readonly pattern: Pattern;
}

export type Pattern =
  | AsPattern
  | CapturePattern
  | ClassPattern
  | LiteralPattern
  | MappingPattern
  | OrPattern
  | SequencePattern
  | StarPattern
  | ValuePattern
  | WildcardPattern;

export interface AsPattern extends NodeBase {
  readonly kind: "AsPattern";
  readonly name: string;
  readonly pattern: Pattern;
}

export interface CapturePattern extends NodeBase {
  readonly kind: "CapturePattern";
  readonly name: string;
}

export interface ClassPatternKeyword extends NodeBase {
  readonly attribute: string;
  readonly pattern: Pattern;
}

export interface ClassPattern extends NodeBase {
  readonly className: Expression;
  readonly kind: "ClassPattern";
  readonly keywords: readonly ClassPatternKeyword[];
  readonly positional: readonly Pattern[];
}

export interface LiteralPattern extends NodeBase {
  readonly kind: "LiteralPattern";
  readonly value: bigint | boolean | null | number | string;
}

export interface MappingPatternEntry extends NodeBase {
  readonly key: Expression;
  readonly pattern: Pattern;
}

export interface MappingPattern extends NodeBase {
  readonly entries: readonly MappingPatternEntry[];
  readonly kind: "MappingPattern";
  readonly rest?: string;
}

export interface OrPattern extends NodeBase {
  readonly alternatives: readonly Pattern[];
  readonly kind: "OrPattern";
}

export interface SequencePattern extends NodeBase {
  readonly elements: readonly Pattern[];
  readonly kind: "SequencePattern";
}

export interface StarPattern extends NodeBase {
  readonly kind: "StarPattern";
  readonly name?: string;
}

export interface ValuePattern extends NodeBase {
  readonly kind: "ValuePattern";
  readonly value: Expression;
}

export interface WildcardPattern extends NodeBase {
  readonly kind: "WildcardPattern";
}

export interface ImportAlias extends NodeBase {
  readonly module: string;
  readonly alias?: string;
}

export interface ImportStatement extends NodeBase {
  readonly kind: "ImportStatement";
  readonly imports: readonly ImportAlias[];
}

export interface FromImportAlias extends NodeBase {
  readonly alias?: string;
  readonly name: string;
}

export interface FromImportStatement extends NodeBase {
  readonly imports: readonly FromImportAlias[];
  readonly kind: "FromImportStatement";
  readonly level: number;
  readonly module?: string;
  readonly wildcard: boolean;
}

export interface NameDeclaration extends NodeBase {
  readonly name: string;
}

export interface GlobalStatement extends NodeBase {
  readonly kind: "GlobalStatement";
  readonly names: readonly NameDeclaration[];
}

export interface NonlocalStatement extends NodeBase {
  readonly kind: "NonlocalStatement";
  readonly names: readonly NameDeclaration[];
}

export interface PassStatement extends NodeBase {
  readonly kind: "PassStatement";
}

export interface RaiseStatement extends NodeBase {
  readonly kind: "RaiseStatement";
  readonly value?: Expression;
}

export interface ReturnStatement extends NodeBase {
  readonly kind: "ReturnStatement";
  readonly value?: Expression;
}

export interface ExceptHandler extends NodeBase {
  readonly type?: Expression;
  readonly name?: string;
  readonly body: readonly Statement[];
  readonly starred: boolean;
}

export interface TryStatement extends NodeBase {
  readonly kind: "TryStatement";
  readonly body: readonly Statement[];
  readonly handlers: readonly ExceptHandler[];
  readonly elseBody?: readonly Statement[];
  readonly finallyBody?: readonly Statement[];
}

export interface WithItem extends NodeBase {
  readonly context: Expression;
  readonly target?: AssignmentTarget;
}

export interface WithStatement extends NodeBase {
  readonly asynchronous: boolean;
  readonly body: readonly Statement[];
  readonly items: readonly WithItem[];
  readonly kind: "WithStatement";
}

export interface WhileStatement extends NodeBase {
  readonly kind: "WhileStatement";
  readonly test: Expression;
  readonly body: readonly Statement[];
}

export interface YieldStatement extends NodeBase {
  readonly delegate: boolean;
  readonly kind: "YieldStatement";
  readonly value?: Expression;
}

export interface YieldExpression extends NodeBase {
  readonly delegate: boolean;
  readonly kind: "YieldExpression";
  readonly value?: Expression;
}

export interface AwaitExpression extends NodeBase {
  readonly kind: "AwaitExpression";
  readonly value: Expression;
}

export interface AttributeExpression extends NodeBase {
  readonly kind: "AttributeExpression";
  readonly object: Expression;
  readonly attribute: string;
}

export interface BinaryExpression extends NodeBase {
  readonly kind: "BinaryExpression";
  readonly operator:
    "+" | "-" | "*" | "/" | "//" | "%" | "**" | "<<" | ">>" | "&" | "^" | "|";
  readonly left: Expression;
  readonly right: Expression;
}

export interface BooleanExpression extends NodeBase {
  readonly kind: "BooleanExpression";
  readonly operator: "and" | "or";
  readonly values: readonly Expression[];
}

export interface CallArgument extends NodeBase {
  readonly argumentKind: CallArgumentKind;
  readonly name?: string;
  readonly value: Expression;
}

export type CallArgumentKind =
  "keyword" | "mapping_unpack" | "positional" | "iterable_unpack";

export interface CallExpression extends NodeBase {
  readonly kind: "CallExpression";
  readonly callee: Expression;
  readonly arguments: readonly CallArgument[];
}

export interface ComparisonPart extends NodeBase {
  readonly operator:
    "==" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "is" | "is not" | "not in";
  readonly right: Expression;
}

export interface ComparisonExpression extends NodeBase {
  readonly kind: "ComparisonExpression";
  readonly left: Expression;
  readonly comparisons: readonly ComparisonPart[];
}

export interface ConditionalExpression extends NodeBase {
  readonly kind: "ConditionalExpression";
  readonly condition: Expression;
  readonly whenTrue: Expression;
  readonly whenFalse: Expression;
}

export type ComprehensionClause =
  ComprehensionForClause | ComprehensionIfClause;

export interface ComprehensionForClause extends NodeBase {
  readonly asynchronous: boolean;
  readonly clauseKind: "for";
  readonly iterable: Expression;
  readonly target: AssignmentTarget;
}

export interface ComprehensionIfClause extends NodeBase {
  readonly clauseKind: "if";
  readonly condition: Expression;
}

export interface ComprehensionExpression extends NodeBase {
  readonly clauses: readonly ComprehensionClause[];
  readonly containerKind: "dictionary" | "generator" | "list" | "set";
  readonly element?: Expression;
  readonly key?: Expression;
  readonly kind: "ComprehensionExpression";
  readonly value?: Expression;
}

export type DictionaryEntry = DictionaryPairEntry | DictionaryUnpackEntry;

export interface DictionaryPairEntry extends NodeBase {
  readonly entryKind: "pair";
  readonly key: Expression;
  readonly value: Expression;
}

export interface DictionaryUnpackEntry extends NodeBase {
  readonly entryKind: "mapping_unpack";
  readonly value: Expression;
}

export interface DictionaryExpression extends NodeBase {
  readonly kind: "DictionaryExpression";
  readonly entries: readonly DictionaryEntry[];
}

export type FormattedStringPart = string | FormattedStringInterpolation;

export interface FormattedStringInterpolation {
  readonly conversion: "a" | "r" | "s" | null;
  readonly expression: string;
  readonly formatSpec: readonly FormattedStringPart[];
  readonly value: Expression;
}

export interface FormattedStringExpression extends NodeBase {
  readonly interpolations: readonly FormattedStringInterpolation[];
  readonly kind: "FormattedStringExpression";
  readonly strings: readonly string[];
}

export type TemplateStringInterpolation = FormattedStringInterpolation;

export interface TemplateStringExpression extends NodeBase {
  readonly interpolations: readonly TemplateStringInterpolation[];
  readonly kind: "TemplateStringExpression";
  readonly strings: readonly string[];
}

export interface IdentifierExpression extends NodeBase {
  readonly kind: "IdentifierExpression";
  readonly name: string;
}

export interface ListExpression extends NodeBase {
  readonly kind: "ListExpression";
  readonly elements: readonly Expression[];
}

export interface LambdaExpression extends NodeBase {
  readonly kind: "LambdaExpression";
  readonly parameters: readonly Parameter[];
  readonly body: Expression;
}

export interface LiteralExpression extends NodeBase {
  readonly kind: "LiteralExpression";
  readonly value: bigint | boolean | null | number | string;
}

export interface NamedExpression extends NodeBase {
  readonly kind: "NamedExpression";
  readonly target: IdentifierExpression;
  readonly value: Expression;
}

export interface SubscriptExpression extends NodeBase {
  readonly kind: "SubscriptExpression";
  readonly object: Expression;
  readonly index: Expression;
}

export interface SliceExpression extends NodeBase {
  readonly kind: "SliceExpression";
  readonly object: Expression;
  readonly start?: Expression;
  readonly stop?: Expression;
  readonly step?: Expression;
}

export interface SetExpression extends NodeBase {
  readonly elements: readonly Expression[];
  readonly kind: "SetExpression";
}

export interface StarredExpression extends NodeBase {
  readonly kind: "StarredExpression";
  readonly value: Expression;
}

export interface TupleExpression extends NodeBase {
  readonly kind: "TupleExpression";
  readonly elements: readonly Expression[];
}

export interface UnaryExpression extends NodeBase {
  readonly kind: "UnaryExpression";
  readonly operator: "+" | "-" | "not" | "~";
  readonly operand: Expression;
}
