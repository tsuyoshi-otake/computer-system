import type { SourceSpan } from "../language/source.js";
import type { RuntimeValue } from "./value.js";

export class VmRuntimeError extends Error {
  constructor(
    readonly typeName: string,
    message: string,
    readonly span?: SourceSpan,
    readonly value?: RuntimeValue,
  ) {
    super(message);
    this.name = typeName;
  }
}

export class VmLimitError extends VmRuntimeError {
  constructor(limit: string, span?: SourceSpan) {
    super("ResourceLimitError", `${limit} limit exceeded`, span);
  }
}

export class VmMemoryError extends VmRuntimeError {
  constructor(span?: SourceSpan) {
    super("MemoryError", "memory limit exceeded", span);
  }
}
