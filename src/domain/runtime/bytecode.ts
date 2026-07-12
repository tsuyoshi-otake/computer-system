import type {
  BinaryExpression,
  ComparisonPart,
  UnaryExpression,
} from "../language/ast.js";
import type { SourceSpan } from "../language/source.js";

export interface CodeObject {
  readonly name: string;
  readonly kind: "block" | "function" | "module";
  readonly instructions: readonly Instruction[];
}

export interface FunctionPrototype {
  readonly name: string;
  readonly parameters: readonly string[];
  readonly requiredParameters: number;
  readonly code: CodeObject;
}

export interface ExceptionHandlerCode {
  readonly typeName?: string;
  readonly name?: string;
  readonly code: CodeObject;
}

export interface LoopTarget {
  readonly continueTarget: number;
  breakTarget: number;
}

export type Instruction =
  | SimpleInstruction
  | {
      readonly op: "BINARY";
      readonly operator: BinaryExpression["operator"];
      readonly span: SourceSpan;
    }
  | {
      readonly op: "BUILD_DICT" | "BUILD_LIST" | "BUILD_TUPLE" | "FORMAT";
      readonly count: number;
      readonly span: SourceSpan;
    }
  | {
      readonly op: "CALL";
      readonly argumentNames: readonly (string | undefined)[];
      readonly span: SourceSpan;
    }
  | {
      readonly op: "COMPARE_CHAIN";
      readonly operators: readonly ComparisonPart["operator"][];
      readonly span: SourceSpan;
    }
  | {
      readonly op:
        | "FOR_ITER"
        | "JUMP"
        | "JUMP_IF_FALSE"
        | "JUMP_IF_FALSE_OR_POP"
        | "JUMP_IF_TRUE_OR_POP";
      target: number;
      readonly span: SourceSpan;
    }
  | {
      readonly op: "IMPORT";
      readonly module: string;
      readonly alias: string;
      readonly span: SourceSpan;
    }
  | {
      readonly op: "LOAD_ATTRIBUTE" | "STORE_ATTRIBUTE";
      readonly name: string;
      readonly span: SourceSpan;
    }
  | {
      readonly op: "LOAD_CONST";
      readonly value: boolean | null | number | string;
      readonly span: SourceSpan;
    }
  | {
      readonly op: "LOAD_NAME" | "STORE_NAME";
      readonly name: string;
      readonly span: SourceSpan;
    }
  | {
      readonly op: "LOOP_CONTROL";
      readonly action: "break" | "continue";
      readonly target: LoopTarget;
      readonly span: SourceSpan;
    }
  | {
      readonly op: "MAKE_FUNCTION";
      readonly prototype: FunctionPrototype;
      readonly defaultCount: number;
      readonly span: SourceSpan;
    }
  | {
      readonly op: "TRY";
      readonly body: CodeObject;
      readonly handlers: readonly ExceptionHandlerCode[];
      readonly elseCode?: CodeObject;
      readonly finallyCode?: CodeObject;
      readonly span: SourceSpan;
    }
  | {
      readonly op: "UNARY";
      readonly operator: UnaryExpression["operator"];
      readonly span: SourceSpan;
    };

export interface SimpleInstruction {
  readonly op:
    | "BREAKPOINT"
    | "END_BLOCK"
    | "GET_ITER"
    | "LOAD_SUBSCRIPT"
    | "POP_TOP"
    | "RAISE"
    | "RETURN"
    | "STORE_SUBSCRIPT";
  readonly span: SourceSpan;
}
