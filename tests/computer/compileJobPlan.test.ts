import { describe, expect, it } from "vitest";

import {
  advanceCompileJobContinuation,
  compileJobProgress,
  createCompileJobContinuation,
  preflightCompileJob,
  type CompileJobPhase,
} from "../../src/application/computer/compileJobPlan.js";
import { ComputerRuntime } from "../../src/application/computer/computerRuntime.js";
import type { ShellCompileTask } from "../../src/application/os/shellTypes.js";
import { cs486CPreprocessorLimits } from "../../src/application/toolchain/cs486CPreprocessor.js";
import { ComputerWorkMonitor } from "../../src/application/runtime/computerWorkMonitor.js";
import { ComputerRecord } from "../../src/domain/computer/computer.js";

describe("compile job capacity and continuations", (): void => {
  it("uses a bounded source-proportional RAM ladder", (): void => {
    expect(preflightCompileJob(sourceTask("int main(){return 0;}"))).toBe(
      128 * 1_024,
    );
    expect(preflightCompileJob(sourceTask(" ".repeat(30_000)))).toBe(
      256 * 1_024,
    );
    expect(() =>
      preflightCompileJob(
        sourceTask(
          " ".repeat(cs486CPreprocessorLimits.aggregateSourceCharacters + 1),
        ),
      ),
    ).toThrow("source character limit exceeded");
  });

  it("advances one bounded unit slice and exposes deterministic remaining work", (): void => {
    const continuation = createCompileJobContinuation(
      sourceTask(" ".repeat(10_000)),
    );
    expect(continuation).toBeDefined();
    expect(compileJobProgress(continuation!, 128 * 1_024)).toMatchObject({
      completedUnits: 0,
      phase: "source_admission",
      remainingUnits: 10_000,
      sliceUnits: 4_096,
      slices: 0,
    });

    expect(advanceCompileJobContinuation(continuation!)).toBe("blocked");
    expect(compileJobProgress(continuation!, 128 * 1_024)).toMatchObject({
      completedUnits: 4_096,
      phase: "source_admission",
      remainingUnits: 5_904,
      slices: 1,
    });
  });

  it("does not install a large compile from its first callback", (): void => {
    const runtime = new ComputerRuntime();
    const record = new ComputerRecord("c-006201", "standard");
    runtime.register(record);
    runtime.powerOn(record.computerId);
    completeBoot(runtime, record);
    const largeSource = `${" ".repeat(10_000)}int main(){return 0;}\n`;
    record.filesystem.writeFile("/tmp/large.c", largeSource);
    const completions: number[] = [];

    runtime.enqueueDebugShellCommand(
      record.computerId,
      "cc /tmp/large.c -o /tmp/large",
      (result) =>
        completions.push(result.outcome === "completed" ? result.exitCode : -1),
    );
    expect(runtime.compileJobStatus(record.computerId)).toMatchObject({
      phase: "source_admission",
      remainingUnits: largeSource.length,
    });

    runtime.runTick();
    expect(record.filesystem.exists("/tmp/large")).toBe(false);
    expect(completions).toEqual([]);
    expect(runtime.compileJobStatus(record.computerId)).toMatchObject({
      completedUnits: 4_096,
      phase: "source_admission",
      slices: 1,
    });

    for (let tick = 0; tick < 100 && completions.length === 0; tick += 1) {
      runtime.runTick();
    }
    expect(completions).toEqual([0]);
    expect(record.filesystem.exists("/tmp/large")).toBe(true);
    expect(runtime.compileJobStatus(record.computerId)).toBeUndefined();
  });

  it("cancels exactly once from every observable phase without replacing output", (): void => {
    const phases: readonly CompileJobPhase[] = [
      "source_admission",
      "preprocessing",
      "parsing",
      "function_lowering",
      "optimization",
      "code_emission",
      "object_validation",
      "linking",
      "atomic_installation",
    ];
    const runtime = new ComputerRuntime();
    const record = new ComputerRecord("c-006204", "standard");
    runtime.register(record);
    runtime.powerOn(record.computerId);
    completeBoot(runtime, record);
    record.filesystem.writeFile(
      "/tmp/phases.c",
      `${" ".repeat(10_000)}int main(){return 0;}\n`,
    );
    record.filesystem.writeFile("/tmp/phases", "previous-output");
    const baselineMemory = runtime.guestMemoryStatus(record.computerId);

    for (const phase of phases) {
      const completions: number[] = [];
      runtime.enqueueDebugShellCommand(
        record.computerId,
        "cc /tmp/phases.c -o /tmp/phases",
        (result) =>
          completions.push(
            result.outcome === "completed" ? result.exitCode : -1,
          ),
      );
      for (let tick = 0; tick < 100; tick += 1) {
        if (runtime.compileJobStatus(record.computerId)?.phase === phase) break;
        runtime.runTick();
      }
      expect(runtime.compileJobStatus(record.computerId)?.phase).toBe(phase);
      expect(runtime.interrupt(record.computerId)).toMatchObject({
        outcome: "accepted",
        state: "compile_interrupted",
      });
      expect(completions).toEqual([130]);
      expect(record.filesystem.readFile("/tmp/phases")).toBe("previous-output");
      expect(runtime.compileJobStatus(record.computerId)).toBeUndefined();
      expect(runtime.guestMemoryStatus(record.computerId)).toEqual(
        baselineMemory,
      );
      runtime.runTick();
      expect(completions).toEqual([130]);
    }
  }, 60_000);

  it("round-robins a fixed global batch across five Computers", (): void => {
    const runtime = new ComputerRuntime();
    const records = Array.from(
      { length: 5 },
      (_, index) => new ComputerRecord(`c-00621${String(index)}`, "standard"),
    );
    for (const record of records) {
      runtime.register(record);
      runtime.powerOn(record.computerId);
    }
    for (const record of records) completeBoot(runtime, record);
    const source = `${" ".repeat(10_000)}int main(){return 0;}\n`;
    for (const record of records) {
      record.filesystem.writeFile("/tmp/fair.c", source);
      runtime.enqueueDebugShellCommand(
        record.computerId,
        "cc /tmp/fair.c -o /tmp/fair",
        () => undefined,
      );
    }

    for (let tick = 0; tick < 5; tick += 1) runtime.runTick();
    const slices = records.map(
      (record) => runtime.compileJobStatus(record.computerId)?.slices,
    );
    expect(slices).toEqual([4, 4, 4, 4, 4]);
  });

  it("fairly completes four concurrent guest archive builds under WorkMonitor admission", (): void => {
    const runtime = new ComputerRuntime();
    const records = Array.from(
      { length: 4 },
      (_, index) => new ComputerRecord(`c-00711${String(index)}`, "advanced"),
    );
    records[0]!.filesystem.writeFile("/startup.py", "while True:\n    pass\n");
    for (const [index, record] of records.entries()) {
      runtime.register(record);
      runtime.powerOn(record.computerId);
      record.filesystem.makeDirectory("/work");
      record.filesystem.writeFile(
        "/work/answer.c",
        `int answer(){return ${String(40 + index)};}\n`,
      );
      record.filesystem.writeFile(
        "/work/main.c",
        "int answer(); int main(){return answer();}\n",
      );
      record.filesystem.writeFile(
        "/work/Makefile",
        [
          "app: main.o libanswer.csa",
          "\tld main.o -L. -lanswer -o app",
          "libanswer.csa: answer.o",
          "\tar rcs $@ $^",
          "\tranlib $@",
          "%.o: %.c",
          "\tcc -c $< -o $@",
        ].join("\n"),
      );
    }
    completeBoot(runtime, records[0]!);
    let activeTick = 0;
    const completionTicks: number[] = [];
    for (const record of records) {
      runtime.enqueueDebugShellCommand(
        record.computerId,
        "make -C /work",
        (result) => {
          expect(result).toMatchObject({ outcome: "completed", exitCode: 0 });
          completionTicks.push(activeTick);
        },
      );
    }

    let clock = 0;
    const monitor = new ComputerWorkMonitor({
      nowMicroseconds: (): number => ++clock,
    });
    for (activeTick = 1; activeTick <= 100; activeTick += 1) {
      const scope = monitor.beginTick(activeTick);
      runtime.runTick(scope);
      scope.finish();
      if (completionTicks.length === records.length) break;
    }

    expect(completionTicks).toHaveLength(records.length);
    const firstCompletion = Math.min(...completionTicks);
    expect(
      [...completionTicks]
        .sort((left, right) => left - right)
        .map((tick) => tick - firstCompletion),
    ).toEqual([0, 1, 2, 3]);
    expect(
      records.every((record) => record.filesystem.exists("/work/app")),
    ).toBe(true);
    const snapshot = monitor.snapshot();
    expect(snapshot.lanes.guest_compile.admitted).toBeGreaterThanOrEqual(40);
    expect(snapshot.lanes.guest_compile.deferred).toBe(0);
    expect(snapshot.lanes.guest_cpu.admitted).toBeGreaterThan(0);
  });

  it("rejects an over-ladder working set before a lease, continuation, or output mutation", (): void => {
    const runtime = new ComputerRuntime();
    const record = new ComputerRecord("c-006220", "standard");
    runtime.register(record);
    runtime.powerOn(record.computerId);
    completeBoot(runtime, record);
    record.filesystem.writeFile(
      "/tmp/too-large.c",
      " ".repeat(cs486CPreprocessorLimits.rootSourceCharacters),
    );
    record.filesystem.writeFile("/tmp/kept", "previous-output");
    const baselineMemory = runtime.guestMemoryStatus(record.computerId);
    const completions: number[] = [];

    runtime.enqueueDebugShellCommand(
      record.computerId,
      "cc /tmp/too-large.c -o /tmp/kept",
      (result) =>
        completions.push(result.outcome === "completed" ? result.exitCode : -1),
    );

    expect(completions).toEqual([1]);
    expect(record.filesystem.readFile("/tmp/kept")).toBe("previous-output");
    expect(runtime.compileJobStatus(record.computerId)).toBeUndefined();
    expect(runtime.guestMemoryStatus(record.computerId)).toEqual(
      baselineMemory,
    );
  });
});

function sourceTask(source: string): ShellCompileTask {
  return {
    compileOnly: false,
    kind: "source",
    language: "c",
    outputPath: "/tmp/a.out",
    runAfterCompile: false,
    source,
    sourceName: "/tmp/main.c",
  };
}

function completeBoot(runtime: ComputerRuntime, record: ComputerRecord): void {
  for (let tick = 0; tick < 200; tick += 1) {
    if (
      record.lifecycle.state.kind !== "booting" &&
      record.display.state.kind !== "post"
    ) {
      return;
    }
    runtime.runTick();
  }
  throw new Error("runtime did not complete CSBIOS");
}
