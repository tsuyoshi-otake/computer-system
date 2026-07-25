import type { Cs486Executable } from "../../src/domain/cpu/cs486.js";

/**
 * ALU/branch benchmark corpus for the Issue #106 CS486 throughput
 * harness. This is the exact eight-instruction infinite loop the CS486
 * host-throughput benchmark has always used (extracted unchanged from
 * `tools/cs486-interpreter-benchmark-entry.ts`), so existing issue-16
 * evidence remains directly comparable.
 */
export const cs486AluBranchCorpusMemoryBytes = 65_536;

export const cs486AluBranchCorpusExecutable: Cs486Executable = Object.freeze({
  dataBytes: 0,
  format: "cs486-executable",
  instructions: Object.freeze([
    {
      destination: "eax",
      op: "mov",
      source: { kind: "immediate", value: 1 },
    },
    {
      destination: "ebx",
      op: "add",
      source: { kind: "register", register: "eax" },
    },
    {
      destination: "ecx",
      op: "xor",
      source: { kind: "register", register: "ebx" },
    },
    {
      left: "ecx",
      op: "cmp",
      right: { kind: "immediate", value: 0 },
    },
    { op: "jne", target: 6 },
    { op: "jmp", target: 1 },
    {
      destination: "edx",
      op: "add",
      source: { kind: "immediate", value: 1 },
    },
    { op: "jmp", target: 1 },
  ]),
  version: 2,
});
