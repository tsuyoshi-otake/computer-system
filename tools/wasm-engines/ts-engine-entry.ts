import type {
  Cs486BenchmarkExecutionMode,
  Cs486BenchmarkInstrumentationMode,
  Cs486InterpreterSample,
} from "../cs486-interpreter-benchmark-entry.js";
import { measureCs486ExecutableSample } from "../cs486-interpreter-benchmark-entry.js";
import { resolveCs486BenchmarkCorpus } from "../wasm-corpora/corpus-registry.js";
import type { CpuModel } from "../../src/domain/cpu/models.js";

/**
 * TS reference engine adapter for the Issue #106 wasm A/B harness. It runs
 * the production `Cs486Process` interpreter on a registry corpus and returns
 * the shared `Cs486InterpreterSample` shape, so wasm engine samples compare
 * field-for-field against the authoritative implementation.
 */
export function createCs486BenchmarkMeasure(
  corpusName: string,
): (
  cpuModel: CpuModel,
  instructionBudget: number,
  executionMode?: Cs486BenchmarkExecutionMode,
  instrumentation?: Cs486BenchmarkInstrumentationMode,
) => Cs486InterpreterSample {
  const corpus = resolveCs486BenchmarkCorpus(corpusName);
  const executable = corpus.executable();
  return (
    cpuModel,
    instructionBudget,
    executionMode = "instruction-slice",
    instrumentation = "enabled",
  ) =>
    measureCs486ExecutableSample(
      executable,
      corpus.memoryBytes,
      cpuModel,
      instructionBudget,
      executionMode,
      instrumentation,
    );
}
