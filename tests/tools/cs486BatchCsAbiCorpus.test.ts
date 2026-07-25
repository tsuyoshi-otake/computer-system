import { describe, expect, it } from "vitest";

import {
  createAttachableCsAbiBatchSyscallHandler,
  csAbiSelectors,
} from "../../src/application/runtime/csAbi.js";
import { Cs486Process } from "../../src/domain/cpu/cs486.js";
import type { CpuProcessState } from "../../src/domain/runtime/cpuProcess.js";
import {
  cs486BatchCsAbiForcedCases,
  cs486BatchCsAbiLayout,
} from "../../tools/cs486-corpora/batch-cs-abi-corpus.js";

/**
 * These expectations pin what each corpus program actually reaches on the
 * production `Cs486Process` implementation, so a program that stops exercising
 * the isolated CS ABI subset fails here instead of quietly turning the corpus
 * into vacuous evidence.
 */
interface CorpusOutcome {
  readonly output: string;
  readonly state: CpuProcessState;
}

function runOnReferenceProcess(name: string): CorpusOutcome {
  const program = cs486BatchCsAbiForcedCases().find(
    (candidate) => candidate.name === name,
  );
  if (program === undefined) throw new Error(`unknown corpus program ${name}`);
  const batch = createAttachableCsAbiBatchSyscallHandler(cs486BatchCsAbiLayout);
  const process = new Cs486Process(program.executable, {
    collectMicroarchitectureStats: false,
    cpuModel: "cs486dx2",
    memoryBytes: program.memoryBytes,
    syscallHandler: batch.handler,
  });
  batch.attach((text) => {
    process.appendOutput(text);
  });
  if (program.processImage !== undefined)
    process.initializeProcessImage(program.processImage);
  process.runCpuSlice(1_000_000, 10_000);
  return { output: process.output, state: process.state };
}

describe("batch CS ABI equivalence corpus", () => {
  it("covers every program the harness is expected to compare", () => {
    expect(cs486BatchCsAbiForcedCases().map((program) => program.name)).toEqual(
      [
        "batch-heap-write-exit",
        "batch-errno-paths",
        "batch-unsupported-operation",
        "batch-unsupported-descriptor",
        "batch-foreign-syscall-name",
      ],
    );
    for (const program of cs486BatchCsAbiForcedCases()) {
      expect(program.csAbi, program.name).toBe(cs486BatchCsAbiLayout);
      expect(program.processImage?.segments.length, program.name).toBe(2);
    }
  });

  it("writes fd 1 and fd 2 into one stream and normalizes the exit status", () => {
    // 300 normalizes to 44, so the status can only match by passing through the
    // shared exit contract rather than by being echoed.
    expect(runOnReferenceProcess("batch-heap-write-exit")).toEqual({
      output: "batch\nba",
      state: { kind: "completed", value: 44 },
    });
  });

  it("returns both errno paths through EAX without emitting output", () => {
    // 234 is EINVAL (-22) truncated to a status byte.
    expect(runOnReferenceProcess("batch-errno-paths")).toEqual({
      output: "",
      state: { kind: "completed", value: 234 },
    });
  });

  it("retains serviced output when a later operation is rejected", () => {
    const outcome = runOnReferenceProcess("batch-unsupported-operation");
    expect(outcome.output).toBe("bat");
    expect(outcome.state).toMatchObject({
      error: {
        message: `batch process cannot use CS ABI operation ${String(csAbiSelectors.termSize)}; re-run this program without batch mode`,
        name: "UnsupportedOperationError",
      },
      kind: "crashed",
    });
  });

  it("rejects a descriptor the batch policy cannot own", () => {
    const outcome = runOnReferenceProcess("batch-unsupported-descriptor");
    expect(outcome.output).toBe("");
    expect(outcome.state).toMatchObject({
      error: {
        message:
          "batch process cannot use file descriptor 3; re-run this program without batch mode",
        name: "UnsupportedOperationError",
      },
      kind: "crashed",
    });
  });

  it("reports EPERM instead of a fault for a syscall outside the CS ABI name", () => {
    expect(runOnReferenceProcess("batch-foreign-syscall-name")).toEqual({
      output: "",
      state: { kind: "completed", value: -1 },
    });
  });
});
