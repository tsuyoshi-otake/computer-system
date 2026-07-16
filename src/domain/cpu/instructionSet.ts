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
      readonly op: "load";
      readonly destination: Cs486Register;
      readonly address: Cs486Operand;
    }
  | {
      readonly op: "store";
      readonly address: Cs486Operand;
      readonly source: Cs486Register;
    }
  | {
      readonly op: "add" | "sub" | "mul" | "div" | "mod" | "and" | "or" | "xor";
      readonly destination: Cs486Register;
      readonly source: Cs486Operand;
    }
  | {
      readonly op: "shl" | "shr";
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
  | { readonly op: "ret" | "halt" }
  | { readonly op: "syscall"; readonly name: string }
  | { readonly op: "print"; readonly source: Cs486Operand | string };
