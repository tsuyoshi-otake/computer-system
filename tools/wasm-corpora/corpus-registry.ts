import type { Cs486Executable } from "../../src/domain/cpu/cs486.js";
import {
  cs486AluBranchCorpusExecutable,
  cs486AluBranchCorpusMemoryBytes,
} from "./alu-branch-corpus.js";
import {
  cs486HostedMidCorpusExecutable,
  cs486HostedMidCorpusMemoryBytes,
} from "./hosted-mid-corpus.js";
import {
  cs486MemStackCorpusExecutable,
  cs486MemStackCorpusMemoryBytes,
} from "./mem-stack-corpus.js";

/**
 * Engine-independent benchmark corpus registry for the Issue #106 wasm
 * batch-executor A/B harness. Every engine adapter (TS reference and Rust
 * wasm) resolves corpora through this single map so the A/B comparison always
 * measures the identical executable and RAM admission.
 */
export type Cs486BenchmarkCorpusName =
  "alu-branch" | "hosted-c-mid" | "mem-stack";

export const cs486BenchmarkCorpusNames: readonly Cs486BenchmarkCorpusName[] =
  Object.freeze(["alu-branch", "mem-stack", "hosted-c-mid"]);

export interface Cs486BenchmarkCorpus {
  /** Builds (or returns the memoized) deterministic corpus executable. */
  readonly executable: () => Cs486Executable;
  /** RAM admitted to the process, mirroring the legacy benchmark default. */
  readonly memoryBytes: number;
  readonly name: Cs486BenchmarkCorpusName;
}

const corpusByName: ReadonlyMap<
  Cs486BenchmarkCorpusName,
  Cs486BenchmarkCorpus
> = new Map<Cs486BenchmarkCorpusName, Cs486BenchmarkCorpus>([
  [
    "alu-branch",
    {
      executable: () => cs486AluBranchCorpusExecutable,
      memoryBytes: cs486AluBranchCorpusMemoryBytes,
      name: "alu-branch",
    },
  ],
  [
    "mem-stack",
    {
      executable: cs486MemStackCorpusExecutable,
      memoryBytes: cs486MemStackCorpusMemoryBytes,
      name: "mem-stack",
    },
  ],
  [
    "hosted-c-mid",
    {
      executable: cs486HostedMidCorpusExecutable,
      memoryBytes: cs486HostedMidCorpusMemoryBytes,
      name: "hosted-c-mid",
    },
  ],
]);

export function resolveCs486BenchmarkCorpus(
  name: string,
): Cs486BenchmarkCorpus {
  const corpus = corpusByName.get(name as Cs486BenchmarkCorpusName);
  if (corpus === undefined)
    throw new Error(
      `unknown benchmark corpus ${name}; expected one of ${cs486BenchmarkCorpusNames.join(", ")}`,
    );
  return corpus;
}
