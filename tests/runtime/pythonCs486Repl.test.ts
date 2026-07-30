import { describe, expect, it } from "vitest";

import {
  createPythonCs486Repl,
  type PythonCs486Repl,
} from "../../src/application/runtime/pythonCs486.js";
import { createNativeEnvironment } from "../../src/application/runtime/nativeModules.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";
import { TerminalBuffer } from "../../src/domain/terminal/terminalBuffer.js";

describe("persistent Computer System Python REPL", (): void => {
  it("continues one completed CS486 process with globals, closures, classes, and generators", (): void => {
    const repl = createRepl();
    const process = repl.program.process;
    run(repl);
    expect(process.state.kind).toBe("completed");

    expect(repl.submit("x = 2\n")).toEqual({ kind: "complete" });
    run(repl);
    expect(repl.lastResult).toEqual({ kind: "complete" });
    expect(repl.submit("x + 3\n")).toEqual({ kind: "complete" });
    run(repl);
    expect(repl.lastResult).toEqual({ display: "5", kind: "complete" });
    expect(repl.submit('["text", 1]\n')).toEqual({ kind: "complete" });
    run(repl);
    expect(repl.lastResult).toEqual({
      display: "['text', 1]",
      kind: "complete",
    });

    expect(
      repl.submit(
        "def make_adder(base):\n    return lambda value: base + value\n\nadd2 = make_adder(2)\n",
      ),
    ).toEqual({ kind: "complete" });
    run(repl);
    expect(repl.submit("add2(5)\n")).toEqual({ kind: "complete" });
    run(repl);
    expect(repl.lastResult).toEqual({ display: "7", kind: "complete" });

    expect(
      repl.submit(
        "class Box:\n    def __init__(self, value):\n        self.value = value\n\nbox = Box(9)\n",
      ),
    ).toEqual({ kind: "complete" });
    run(repl);
    expect(repl.submit("box.value\n")).toEqual({ kind: "complete" });
    run(repl);
    expect(repl.lastResult).toEqual({ display: "9", kind: "complete" });

    expect(
      repl.submit(
        "def values():\n    yield 4\n    yield 6\n\ngenerator = values()\n",
      ),
    ).toEqual({ kind: "complete" });
    run(repl);
    expect(repl.submit("next(generator)\n")).toEqual({ kind: "complete" });
    run(repl);
    expect(repl.lastResult).toEqual({ display: "4", kind: "complete" });
    expect(repl.submit("next(generator)\n")).toEqual({ kind: "complete" });
    run(repl);
    expect(repl.lastResult).toEqual({ display: "6", kind: "complete" });

    expect(repl.program.process).toBe(process);
  });

  it("rejects non-quiescent submission and rolls back invalid source and oversized code", (): void => {
    const repl = createRepl();
    run(repl);
    const process = repl.program.process;
    const initialCount = process.instructionCount;

    expect(repl.submit("value = 1\n")).toEqual({ kind: "complete" });
    const admittedCount = process.instructionCount;
    const nonQuiescent = repl.submit("value = 2\n");
    expect(nonQuiescent.kind).toBe("error");
    if (nonQuiescent.kind !== "error")
      throw new Error("non-quiescent submission was not rejected");
    expect(nonQuiescent.diagnostic).toContain("quiescent");
    expect(process.instructionCount).toBe(admittedCount);
    run(repl);

    expect(repl.submit("value = )\n")).toMatchObject({ kind: "error" });
    expect(process.instructionCount).toBe(admittedCount);
    expect(repl.program.runtime.globals.get("value")).toBe(1);

    expect(repl.submit("def unfinished():\n")).toEqual({ kind: "incomplete" });
    expect(process.instructionCount).toBe(admittedCount);

    const oversized = Array.from({ length: 3_000 }, () => "value = 1").join(
      "\n",
    );
    expect(repl.submit(oversized)).toMatchObject({ kind: "error" });
    expect(process.instructionCount).toBe(admittedCount);
    expect(process.instructionCount).toBeGreaterThan(initialCount);
  });

  it("turns an unhandled cell runtime error into a recoverable cell outcome", (): void => {
    const repl = createRepl();
    run(repl);

    expect(repl.submit("1 / 0\n")).toEqual({ kind: "complete" });
    run(repl);
    const divisionFailure = repl.lastResult;
    expect(divisionFailure?.kind).toBe("error");
    if (divisionFailure?.kind !== "error")
      throw new Error("division failure did not reach the REPL boundary");
    expect(divisionFailure.diagnostic).toMatch(/ZeroDivisionError/u);
    expect(repl.program.process.state.kind).toBe("completed");

    expect(repl.submit("40 + 2\n")).toEqual({ kind: "complete" });
    run(repl);
    expect(repl.lastResult).toEqual({ display: "42", kind: "complete" });

    expect(
      repl.submit("committed = 7\n[value for value in [1, 2] if 1 / 0]\n"),
    ).toEqual({ kind: "complete" });
    run(repl);
    const materializationFailure = repl.lastResult;
    expect(materializationFailure?.kind).toBe("error");
    if (materializationFailure?.kind !== "error")
      throw new Error(
        "materialization failure did not reach the REPL boundary",
      );
    expect(materializationFailure.diagnostic).toMatch(/ZeroDivisionError/u);
    expect(repl.submit("committed\n")).toEqual({ kind: "complete" });
    run(repl);
    expect(repl.lastResult).toEqual({ display: "7", kind: "complete" });
  });

  it("keeps imported Python modules available to later cells", (): void => {
    const filesystem = new InMemoryFilesystem();
    filesystem.writeFile("/helper.py", "answer = 7\n");
    const repl = createRepl(filesystem);
    run(repl);

    expect(repl.submit("import helper\n")).toEqual({ kind: "complete" });
    run(repl);
    expect(repl.submit("first_helper = helper\n")).toEqual({
      kind: "complete",
    });
    run(repl);
    filesystem.writeFile("/helper.py", "answer = 99\n");
    expect(repl.submit("import helper\nhelper is first_helper\n")).toEqual({
      kind: "complete",
    });
    run(repl);
    expect(repl.lastResult).toEqual({ display: "True", kind: "complete" });
    expect(repl.submit("helper.answer\n")).toEqual({ kind: "complete" });
    run(repl);
    expect(repl.lastResult).toEqual({ display: "7", kind: "complete" });
  });

  it("collects lines with explicit prompt, completion, and EOF boundaries", (): void => {
    const repl = createRepl();
    expect(repl.promptKind).toBe("running");
    run(repl);
    expect(repl.promptKind).toBe("primary");

    expect(repl.submitLine("def answer():")).toEqual({ kind: "incomplete" });
    expect(repl.promptKind).toBe("continuation");
    expect(repl.bounds.pendingSourceBytes).toBeGreaterThan(0);
    expect(repl.cancelPendingInput()).toBe(true);
    expect(repl.promptKind).toBe("primary");
    expect(repl.bounds.pendingSourceBytes).toBe(0);
    expect(repl.submitLine("def answer():")).toEqual({ kind: "incomplete" });
    expect(repl.submitLine("    return 42")).toEqual({ kind: "incomplete" });
    expect(repl.submitLine("")).toEqual({ kind: "cell-ready" });
    expect(repl.promptKind).toBe("running");
    run(repl);
    expect(repl.promptKind).toBe("running");
    expect(repl.takeCellCompletion()).toEqual({ kind: "ready" });
    expect(repl.promptKind).toBe("primary");

    expect(repl.submitLine("answer()")).toEqual({ kind: "cell-ready" });
    run(repl);
    expect(repl.takeCellCompletion()).toEqual({ display: "42", kind: "ready" });

    expect(repl.submitLine("total = (")).toEqual({ kind: "incomplete" });
    expect(repl.submitLine("20 + 22")).toEqual({ kind: "incomplete" });
    expect(repl.submitLine(")")).toEqual({ kind: "cell-ready" });
    run(repl);
    expect(repl.takeCellCompletion()).toEqual({ kind: "ready" });
    expect(repl.submitLine("total")).toEqual({ kind: "cell-ready" });
    run(repl);
    expect(repl.takeCellCompletion()).toEqual({ display: "42", kind: "ready" });

    expect(repl.submitLine('message = """hello')).toEqual({
      kind: "incomplete",
    });
    expect(repl.submitLine('world"""')).toEqual({ kind: "cell-ready" });
    run(repl);
    expect(repl.takeCellCompletion()).toEqual({ kind: "ready" });
    expect(repl.submitLine("message")).toEqual({ kind: "cell-ready" });
    run(repl);
    expect(repl.takeCellCompletion()).toEqual({
      display: "'hello\\nworld'",
      kind: "ready",
    });
    expect(repl.submitLine("broken = 'text")).toMatchObject({
      kind: "syntax-error",
    });
    expect(repl.promptKind).toBe("primary");
    expect(repl.eof()).toEqual({ kind: "closed" });
    expect(repl.promptKind).toBe("closed");
    expect(repl.submitLine("1 + 1")).toMatchObject({ kind: "syntax-error" });
  });

  it("accepts the exact cumulative source bound, rejects plus one atomically, and completes under one-cycle slices", (): void => {
    const repl = createRepl();
    run(repl, 1, 20_000);
    const process = repl.program.process;
    const maximum = repl.bounds.maximumSourceBytes;
    const exact = `#${"x".repeat(maximum - 2)}\n`;

    expect(new TextEncoder().encode(exact)).toHaveLength(maximum);
    expect(repl.submit(exact)).toEqual({ kind: "complete" });
    const admittedInstructionCount = process.instructionCount;
    run(repl, 1, 20_000);
    expect(repl.lastResult).toEqual({ kind: "complete" });
    expect(repl.bounds.totalSourceBytes).toBe(maximum);
    expect(repl.submit("\n")).toEqual({
      diagnostic: "MemoryError: interactive source limit exceeded",
      kind: "error",
    });
    expect(process.instructionCount).toBe(admittedInstructionCount);
  });
});

function createRepl(filesystem = new InMemoryFilesystem()): PythonCs486Repl {
  const environment = createNativeEnvironment({
    computerId: 1,
    filesystem,
    terminal: new TerminalBuffer(40, 8),
  });
  return createPythonCs486Repl({
    environment,
    filesystem: environment.filesystem,
    memoryBytes: 1_048_576,
    path: "/main.py",
  });
}

function run(
  repl: PythonCs486Repl,
  cycleBudget = 100_000,
  maximumSlices = 1_000,
): void {
  const process = repl.program.process;
  for (
    let count = 0;
    count < maximumSlices &&
    (process.state.kind === "ready" || process.hasPendingCpuCycles);
    count += 1
  )
    process.runCpuSlice(cycleBudget);
  if (process.state.kind === "ready" || process.hasPendingCpuCycles)
    throw new Error("Python REPL did not reach a bounded cell boundary");
}
