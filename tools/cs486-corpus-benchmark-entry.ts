import type {
  Cs486BenchmarkExecutionMode,
  Cs486BenchmarkInstrumentationMode,
  Cs486InterpreterSample,
} from "./cs486-interpreter-benchmark-entry.js";
import { measureCs486ExecutableSample } from "./cs486-interpreter-benchmark-entry.js";
import { resolveCs486BenchmarkCorpus } from "./cs486-corpora/corpus-registry.js";
import type { CpuModel } from "../src/domain/cpu/models.js";

/**
 * Corpus-parameterized benchmark entry. It runs the production `Cs486Process`
 * interpreter on a registry corpus and returns the shared
 * `Cs486InterpreterSample` shape, so every corpus is measured through one
 * adapter and samples stay comparable field-for-field.
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
