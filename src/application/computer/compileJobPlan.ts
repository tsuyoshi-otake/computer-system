import {
  isCs486StructuredObject,
  objectSection,
  validateCs486Object,
  type Cs486Object,
} from "../../domain/cpu/cs486Object.js";
import type { ShellCompileTask } from "../os/shellTypes.js";
import { cs486AsmPreprocessorLimits } from "../toolchain/cs486AsmPreprocessor.js";
import { cs486CPreprocessorLimits } from "../toolchain/cs486CPreprocessor.js";

export type CompileJobPhase =
  | "source_admission"
  | "preprocessing"
  | "parsing"
  | "function_lowering"
  | "optimization"
  | "code_emission"
  | "object_validation"
  | "linking"
  | "atomic_installation";

interface CompilePhasePlan {
  readonly phase: CompileJobPhase;
  readonly sliceUnits: number;
  readonly totalUnits: number;
}

export interface CompileJobContinuation {
  completedUnits: number;
  phaseIndex: number;
  readonly phases: readonly CompilePhasePlan[];
  readonly singleTickEligible: boolean;
  slices: number;
}

export interface CompileJobProgress {
  readonly completedUnits: number;
  readonly memoryBytes: number;
  readonly phase: CompileJobPhase;
  readonly remainingUnits: number;
  readonly sliceUnits: number;
  readonly slices: number;
  readonly totalUnits: number;
}

const kibibyte = 1_024;
const compileMemoryTiers = Object.freeze([
  128 * kibibyte,
  256 * kibibyte,
  512 * kibibyte,
  1_024 * kibibyte,
  2_048 * kibibyte,
  4_096 * kibibyte,
] as const);

export const compileJobSliceLimits = Object.freeze({
  atomicInstallation: 1,
  codeEmission: 2_048,
  functionLowering: 4,
  linking: 4_096,
  objectValidation: 4_096,
  optimization: 2_048,
  parsing: 2_048,
  preprocessing: 2_048,
  sourceAdmission: 4_096,
});

/**
 * Validates capacities that can be known before a lease or PID exists and
 * returns the complete declared peak compile reservation.
 */
export function preflightCompileJob(task: ShellCompileTask): number {
  switch (task.kind) {
    case "make":
    case "program-list":
      return compileMemoryTiers[0];
    case "source": {
      const maximumSourceCharacters =
        task.language === "asm"
          ? cs486AsmPreprocessorLimits.sourceCharacters
          : task.language === "c" || task.language === "cpp"
            ? cs486CPreprocessorLimits.aggregateSourceCharacters
            : 512_000;
      if (task.source.length > maximumSourceCharacters) {
        throw new RangeError(
          `source character limit exceeded (${String(maximumSourceCharacters)})`,
        );
      }
      const languageMultiplier =
        task.language === "c" || task.language === "cpp"
          ? 3
          : task.language === "asm"
            ? 2
            : 1;
      return selectCompileMemoryTier(
        64 * kibibyte + task.source.length * languageMultiplier,
      );
    }
    case "link": {
      let declaredPeak = 64 * kibibyte;
      for (const object of task.objects) {
        validateCs486Object(object);
        declaredPeak += declaredObjectWorkingBytes(object);
      }
      return selectCompileMemoryTier(declaredPeak);
    }
  }
}

export function createCompileJobContinuation(
  task: ShellCompileTask,
): CompileJobContinuation | undefined {
  if (task.kind === "make" || task.kind === "program-list") return undefined;
  const phases: CompilePhasePlan[] = [];
  if (task.kind === "source") {
    const sourceUnits = Math.max(1, task.source.length);
    const tokenUnits = Math.max(1, Math.ceil(sourceUnits / 4));
    const functionUnits = Math.max(1, Math.ceil(sourceUnits / 128));
    const irUnits = Math.max(1, Math.ceil(sourceUnits / 2));
    phases.push(
      phase(
        "source_admission",
        sourceUnits,
        compileJobSliceLimits.sourceAdmission,
      ),
      phase("preprocessing", tokenUnits, compileJobSliceLimits.preprocessing),
      phase("parsing", tokenUnits, compileJobSliceLimits.parsing),
      phase(
        "function_lowering",
        functionUnits,
        compileJobSliceLimits.functionLowering,
      ),
      phase("optimization", irUnits, compileJobSliceLimits.optimization),
      phase("code_emission", irUnits, compileJobSliceLimits.codeEmission),
      phase(
        "object_validation",
        Math.max(1, Math.ceil(sourceUnits / 16)),
        compileJobSliceLimits.objectValidation,
      ),
    );
    if (!task.compileOnly) {
      phases.push(
        phase(
          "linking",
          Math.max(1, Math.ceil(sourceUnits / 16)),
          compileJobSliceLimits.linking,
        ),
      );
    }
  } else {
    const linkUnits = task.objects.reduce(
      (total, object) =>
        total +
        objectTextInstructions(object) +
        object.symbols.length +
        object.relocations.length,
      0,
    );
    phases.push(
      phase(
        "object_validation",
        linkUnits,
        compileJobSliceLimits.objectValidation,
      ),
      phase("linking", linkUnits, compileJobSliceLimits.linking),
    );
  }
  phases.push(
    phase(
      "atomic_installation",
      compileJobSliceLimits.atomicInstallation,
      compileJobSliceLimits.atomicInstallation,
    ),
  );
  return {
    completedUnits: 0,
    phaseIndex: 0,
    phases,
    singleTickEligible: phases.every(
      ({ sliceUnits, totalUnits }) => totalUnits <= sliceUnits,
    ),
    slices: 0,
  };
}

/** Advances exactly one bounded deterministic slice. */
export function advanceCompileJobContinuation(
  continuation: CompileJobContinuation,
): "blocked" | "execute" | "next" {
  const current = continuation.phases[continuation.phaseIndex];
  if (current === undefined) return "execute";
  continuation.completedUnits = Math.min(
    current.totalUnits,
    continuation.completedUnits + current.sliceUnits,
  );
  continuation.slices += 1;
  if (continuation.completedUnits < current.totalUnits) return "blocked";
  continuation.phaseIndex += 1;
  continuation.completedUnits = 0;
  return continuation.phaseIndex >= continuation.phases.length
    ? "execute"
    : "next";
}

export function compileJobProgress(
  continuation: CompileJobContinuation,
  memoryBytes: number,
): CompileJobProgress | undefined {
  const current = continuation.phases[continuation.phaseIndex];
  if (current === undefined) return undefined;
  return {
    completedUnits: continuation.completedUnits,
    memoryBytes,
    phase: current.phase,
    remainingUnits: current.totalUnits - continuation.completedUnits,
    sliceUnits: current.sliceUnits,
    slices: continuation.slices,
    totalUnits: current.totalUnits,
  };
}

function phase(
  phaseName: CompileJobPhase,
  totalUnits: number,
  sliceUnits: number,
): CompilePhasePlan {
  return {
    phase: phaseName,
    sliceUnits,
    totalUnits: Math.max(1, totalUnits),
  };
}

function declaredObjectWorkingBytes(object: Cs486Object): number {
  const initializedBytes = isCs486StructuredObject(object)
    ? objectSection(object, "rodata").bytes.length +
      objectSection(object, "data").bytes.length
    : object.dataBytes;
  return (
    objectTextInstructions(object) * 16 +
    object.symbols.length * 48 +
    object.relocations.length * 32 +
    initializedBytes
  );
}

function objectTextInstructions(object: Cs486Object): number {
  return isCs486StructuredObject(object)
    ? objectSection(object, "text").instructions.length
    : Math.max(1, object.assembly.split("\n").length);
}

function selectCompileMemoryTier(declaredPeakBytes: number): number {
  for (const tier of compileMemoryTiers) {
    if (declaredPeakBytes <= tier) return tier;
  }
  throw new RangeError(
    `compile working-set limit exceeded (${String(compileMemoryTiers.at(-1))} bytes)`,
  );
}
