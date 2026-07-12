import type { SourceSpan } from "./source.js";

export interface Module {
  readonly kind: "Module";
  readonly body: readonly Statement[];
  readonly span: SourceSpan;
}

export type Statement =
  | AssignmentStatement
  | BreakStatement
  | ContinueStatement
  | ExpressionStatement
  | ForStatement
  | FunctionDefinition
  | IfStatement
  | ImportStatement
  | PassStatement
  | RaiseStatement
  | ReturnStatement
  | TryStatement
  | WhileStatement;

export type Expression =
  | AttributeExpression
  | BinaryExpression
  | BooleanExpression
  | CallExpression
  | ComparisonExpression
  | DictionaryExpression
  | FormattedStringExpression
  | IdentifierExpression
  | ListExpression
  | LiteralExpression
  | SubscriptExpression
  | TupleExpression
  | UnaryExpression;

export interface NodeBase {
  readonly span: SourceSpan;
}

export interface AssignmentStatement extends NodeBase {
  readonly kind: "AssignmentStatement";
  readonly target: AssignmentTarget;
  readonly value: Expression;
}

export type AssignmentTarget =
  AttributeExpression | IdentifierExpression | SubscriptExpression;

export interface BreakStatement extends NodeBase {
  readonly kind: "BreakStatement";
}

export interface ContinueStatement extends NodeBase {
  readonly kind: "ContinueStatement";
}

export interface ExpressionStatement extends NodeBase {
  readonly kind: "ExpressionStatement";
  readonly expression: Expression;
}

export interface ForStatement extends NodeBase {
  readonly kind: "ForStatement";
  readonly target: IdentifierExpression;
  readonly iterable: Expression;
  readonly body: readonly Statement[];
}

export interface FunctionDefinition extends NodeBase {
  readonly kind: "FunctionDefinition";
  readonly name: string;
  readonly parameters: readonly Parameter[];
  readonly body: readonly Statement[];
}

export interface Parameter extends NodeBase {
  readonly name: string;
  readonly defaultValue?: Expression;
}

export interface IfBranch extends NodeBase {
  readonly test: Expression;
  readonly body: readonly Statement[];
}

export interface IfStatement extends NodeBase {
  readonly kind: "IfStatement";
  readonly branches: readonly IfBranch[];
  readonly elseBody?: readonly Statement[];
}

export interface ImportAlias extends NodeBase {
  readonly module: string;
  readonly alias?: string;
}

export interface ImportStatement extends NodeBase {
  readonly kind: "ImportStatement";
  readonly imports: readonly ImportAlias[];
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
}

export interface TryStatement extends NodeBase {
  readonly kind: "TryStatement";
  readonly body: readonly Statement[];
  readonly handlers: readonly ExceptHandler[];
  readonly elseBody?: readonly Statement[];
  readonly finallyBody?: readonly Statement[];
}

export interface WhileStatement extends NodeBase {
  readonly kind: "WhileStatement";
  readonly test: Expression;
  readonly body: readonly Statement[];
}

export interface AttributeExpression extends NodeBase {
  readonly kind: "AttributeExpression";
  readonly object: Expression;
  readonly attribute: string;
}

export interface BinaryExpression extends NodeBase {
  readonly kind: "BinaryExpression";
  readonly operator: "+" | "-" | "*" | "/" | "//" | "%" | "**";
  readonly left: Expression;
  readonly right: Expression;
}

export interface BooleanExpression extends NodeBase {
  readonly kind: "BooleanExpression";
  readonly operator: "and" | "or";
  readonly values: readonly Expression[];
}

export interface CallArgument extends NodeBase {
  readonly name?: string;
  readonly value: Expression;
}

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

export interface DictionaryEntry extends NodeBase {
  readonly key: Expression;
  readonly value: Expression;
}

export interface DictionaryExpression extends NodeBase {
  readonly kind: "DictionaryExpression";
  readonly entries: readonly DictionaryEntry[];
}

export type FormattedStringPart = string | Expression;

export interface FormattedStringExpression extends NodeBase {
  readonly kind: "FormattedStringExpression";
  readonly parts: readonly FormattedStringPart[];
}

export interface IdentifierExpression extends NodeBase {
  readonly kind: "IdentifierExpression";
  readonly name: string;
}

export interface ListExpression extends NodeBase {
  readonly kind: "ListExpression";
  readonly elements: readonly Expression[];
}

export interface LiteralExpression extends NodeBase {
  readonly kind: "LiteralExpression";
  readonly value: boolean | null | number | string;
}

export interface SubscriptExpression extends NodeBase {
  readonly kind: "SubscriptExpression";
  readonly object: Expression;
  readonly index: Expression;
}

export interface TupleExpression extends NodeBase {
  readonly kind: "TupleExpression";
  readonly elements: readonly Expression[];
}

export interface UnaryExpression extends NodeBase {
  readonly kind: "UnaryExpression";
  readonly operator: "+" | "-" | "not";
  readonly operand: Expression;
}
