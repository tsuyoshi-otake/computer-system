export const cs486RegisterNames = [
  "eax",
  "ebx",
  "ecx",
  "edx",
  "esi",
  "edi",
  "esp",
  "ebp",
] as const;

export type Cs486Register = (typeof cs486RegisterNames)[number];

export type Cs486Operand =
  | { readonly kind: "immediate"; readonly value: number }
  | { readonly kind: "register"; readonly register: Cs486Register };

export type Cs486Instruction =
  | {
      readonly op: "mov";
      readonly destination: Cs486Register;
      readonly source: Cs486Operand;
    }
  | {
      readonly op: "load" | "load8s" | "load8u" | "load16s" | "load16u";
      readonly destination: Cs486Register;
      readonly address: Cs486Operand;
    }
  | {
      readonly op: "store" | "store8" | "store16";
      readonly address: Cs486Operand;
      readonly source: Cs486Register;
    }
  | {
      readonly op:
        | "add"
        | "sub"
        | "mul"
        | "div"
        | "udiv"
        | "mod"
        | "umod"
        | "and"
        | "or"
        | "xor";
      readonly destination: Cs486Register;
      readonly source: Cs486Operand;
    }
  | {
      readonly op: "shl" | "shr" | "ushr";
      readonly destination: Cs486Register;
      readonly source: Cs486Operand;
    }
  | {
      readonly op: "cmp";
      readonly left: Cs486Register;
      readonly right: Cs486Operand;
    }
  | {
      readonly op: "jmp" | "je" | "jne" | "jl" | "jle" | "jg" | "jge";
      readonly target: number;
    }
  | { readonly op: "push"; readonly source: Cs486Operand }
  | { readonly op: "pop"; readonly destination: Cs486Register }
  | { readonly op: "call"; readonly target: number }
  | {
      readonly op: "call_indirect";
      readonly source: Cs486Operand;
      readonly functionSignature: string;
    }
  | { readonly op: "ret" | "halt" }
  | { readonly op: "syscall"; readonly name: string }
  | { readonly op: "print"; readonly source: Cs486Operand | string };
