import { describe, expect, it } from "vitest";

import {
  ComputerRuntime,
  type DebugShellCommandCompletion,
} from "../../src/application/computer/computerRuntime.js";
import {
  RemoteCs486ProcessFactory,
  stableWorkerIndexForComputer,
  type Cs486WorkerCommand,
  type Cs486WorkerCommandResult,
  type Cs486WorkerProcessView,
  type Cs486WorkerTransport,
} from "../../src/application/runtime/remoteCs486Process.js";
import { ComputerRecord } from "../../src/domain/computer/computer.js";

describe("ComputerRuntime run --batch routing", (): void => {
  it("runs a batch process locally with the isolated policy and its own exit status", (): void => {
    const record = new ComputerRecord("c-000951", "standard");
    const runtime = poweredRuntime(record);
    compileHosted(runtime, record, "sum", [
      "#include <stdio.h>",
      "int main(void) {",
      "  int total = 0;",
      "  int index = 1;",
      "  while (index <= 10) {",
      "    total = total + index;",
      "    index = index + 1;",
      "  }",
      '  printf("total=%d\\n", total);',
      "  return 3;",
      "}",
    ]);

    submitLine(runtime, record, "run --batch /tmp/sum");
    expect(terminalRows(record)).toContain("total=55");
    submitLine(runtime, record, "echo status=$?");
    expect(terminalRows(record)).toContain("status=3");

    submitLine(runtime, record, "run /tmp/sum");
    submitLine(runtime, record, "echo ordinary=$?");
    expect(terminalRows(record)).toContain("ordinary=3");
  });

  it("fails a batch process that reaches for an OS service with guest wording only", (): void => {
    const record = new ComputerRecord("c-000952", "standard");
    const runtime = poweredRuntime(record);
    compileHosted(runtime, record, "reader", [
      "#include <stdio.h>",
      "int main(void) {",
      '  FILE *file = fopen("/tmp/reader.c", "r");',
      "  return file == NULL ? 1 : 0;",
      "}",
    ]);

    submitLine(runtime, record, "run --batch /tmp/reader");
    const flow = terminalFlow(record);
    expect(flow).toContain(
      "UnsupportedOperationError: batch process cannot use CS ABI operation 8; " +
        "re-run this program without batch mode",
    );
    expect(flow).not.toContain(".ts");
    expect(flow).not.toContain("src/application");
    submitLine(runtime, record, "echo status=$?");
    expect(terminalRows(record)).toContain("status=1");

    // The refusal is the whole effect: the same program still runs without the
    // declaration, so nothing about the file or the OS service was disturbed.
    submitLine(runtime, record, "run /tmp/reader");
    submitLine(runtime, record, "echo ordinary=$?");
    expect(terminalRows(record)).toContain("ordinary=0");
  });

  it("hands a batch process to the compute plane with its startup image and heap placement", async (): Promise<void> => {
    const record = new ComputerRecord("c-000953", "standard");
    const transport = new RecordingWorkerTransport(2, {
      output: "remote batch\n",
      value: 7,
    });
    const runtime = poweredRuntime(record, {
      remoteCs486ProcessFactory: new RemoteCs486ProcessFactory(transport),
    });
    compileHosted(runtime, record, "remote", [
      "#include <stdio.h>",
      'int main(void) { printf("local\\n"); return 0; }',
    ]);

    // A hosted process that made no declaration keeps its `CsAbiRuntime`, which
    // only the Bedrock VM can own, so it must never reach the compute plane.
    submitLine(runtime, record, "run /tmp/remote");
    expect(transport.commands).toEqual([]);
    expect(terminalRows(record)).toContain("local");

    await submitRemoteLine(runtime, record, "run --batch /tmp/remote");

    const created = transport.commands[0];
    expect(created).toMatchObject({
      command: "create",
      computerId: record.computerId,
      options: {
        collectMicroarchitectureStats: false,
        cpuModel: "cs486dx",
      },
    });
    if (created?.command !== "create")
      throw new Error("the batch process was not created on a worker");
    const { csAbi, processImage } = created.options;
    if (csAbi === undefined)
      throw new Error("the batch process was created without a heap placement");
    // The placement is the whole reason a worker may service a CS ABI call, so
    // an extra field would be an unvalidated widening of that boundary.
    expect(Object.keys(csAbi).sort()).toEqual([
      "heapBaseBytes",
      "heapWords",
      "startupAddress",
    ]);
    expect(csAbi.heapBaseBytes).toBeGreaterThan(0);
    expect(csAbi.heapWords).toBeGreaterThan(0);
    expect(csAbi.startupAddress).toBeGreaterThan(0);
    expect(processImage?.segments.length).toBeGreaterThan(0);
    // argv, environment, and the startup block are the only stack arguments the
    // hosted entry point takes, so an empty image would be a silent regression.
    expect(processImage?.stackArguments.length).toBeGreaterThan(0);
    expect(transport.commands.map(({ command }) => command)).toEqual([
      "create",
      "slice",
      "dispose",
    ]);

    expect(terminalRows(record)).toContain("remote batch");
    await submitRemoteLine(runtime, record, "echo status=$?");
    expect(terminalRows(record)).toContain("status=7");
  });

  it("refuses a batch declaration in the queued debug path", (): void => {
    const record = new ComputerRecord("c-000954", "standard");
    const runtime = poweredRuntime(record);
    compileHosted(runtime, record, "queued", ["int main(void) { return 0; }"]);

    expect(enqueue(runtime, record, "run --batch /tmp/queued")).toMatchObject({
      exitCode: 1,
      outcome: "completed",
      stderr: "run: --batch is unavailable for queued debug execution\n",
      stdout: "",
    });
    expect(enqueue(runtime, record, "run /tmp/queued")).toMatchObject({
      exitCode: 0,
      outcome: "completed",
    });
  });

  it("keeps the isolated policy on the synchronous MCP path", (): void => {
    const record = new ComputerRecord("c-000955", "standard");
    const runtime = poweredRuntime(record);
    compileHosted(runtime, record, "sync", [
      "#include <stdio.h>",
      'int main(void) { fputs("out", stdout); fputs("err", stderr); return 0; }',
    ]);
    compileHosted(runtime, record, "opener", [
      "#include <stdio.h>",
      "int main(void) {",
      '  FILE *file = fopen("/tmp/opener.c", "r");',
      "  return file == NULL ? 1 : 0;",
      "}",
    ]);

    // fd 1 and fd 2 interleave into one ordered stream, which is exactly the
    // documented difference between a batch process and `CsAbiRuntime`.
    expect(
      runtime.executeDebugShellCommand(
        record.computerId,
        "run --batch /tmp/sync",
      ),
    ).toMatchObject({ exitCode: 0, outcome: "completed", stdout: "outerr" });

    const refused = runtime.executeDebugShellCommand(
      record.computerId,
      "run --batch /tmp/opener",
    );
    expect(refused).toMatchObject({ outcome: "failed" });
    if (refused.outcome !== "failed")
      throw new Error("the synchronous batch path serviced an OS operation");
    expect(refused.error.name).toBe("UnsupportedOperationError");
    expect(refused.error.message).toBe(
      "batch process cannot use CS ABI operation 8; re-run this program without batch mode",
    );
    // Running it without the declaration proves the refusal came from the
    // policy rather than from a broken program or a missing file.
    expect(
      runtime.executeDebugShellCommand(record.computerId, "run /tmp/opener"),
    ).toMatchObject({ exitCode: 0, outcome: "completed" });
  });
});

class RecordingWorkerTransport implements Cs486WorkerTransport {
  readonly commands: Cs486WorkerCommand[] = [];
  private readonly actors = new Map<
    string,
    {
      readonly collectMicroarchitectureStats: boolean;
      readonly computerId: string;
      readonly memoryBytes: number;
    }
  >();

  constructor(
    readonly workerCount: number,
    private readonly completion: {
      readonly output: string;
      readonly value: number;
    },
  ) {}

  request(command: Cs486WorkerCommand): Promise<Cs486WorkerCommandResult> {
    this.commands.push(command);
    switch (command.command) {
      case "create": {
        const actor = {
          collectMicroarchitectureStats:
            command.options.collectMicroarchitectureStats,
          computerId: command.computerId,
          memoryBytes: command.options.memoryBytes,
        };
        this.actors.set(command.processId, actor);
        return Promise.resolve({ command: "create", view: this.view(actor) });
      }
      case "slice": {
        const actor = this.requireActor(command.processId);
        return Promise.resolve({
          command: "slice",
          result: { cpuCycles: 96, executedInstructions: 12 },
          view: this.view(actor, {
            output: this.completion.output,
            state: { kind: "completed", value: this.completion.value },
          }),
        });
      }
      case "terminate": {
        const actor = this.requireActor(command.processId);
        return Promise.resolve({
          command: "terminate",
          view: this.view(actor, {
            state: { kind: "terminated", reason: command.reason },
          }),
        });
      }
      case "fail": {
        const actor = this.requireActor(command.processId);
        return Promise.resolve({
          command: "fail",
          view: this.view(actor, {
            state: { error: command.error, kind: "crashed" },
          }),
        });
      }
      case "dispose":
        this.actors.delete(command.processId);
        return Promise.resolve({ command: "dispose", disposed: true });
    }
  }

  private requireActor(processId: string): {
    readonly collectMicroarchitectureStats: boolean;
    readonly computerId: string;
    readonly memoryBytes: number;
  } {
    const actor = this.actors.get(processId);
    if (actor === undefined) throw new Error(`unknown process ${processId}`);
    return actor;
  }

  private view(
    actor: {
      readonly collectMicroarchitectureStats: boolean;
      readonly computerId: string;
      readonly memoryBytes: number;
    },
    overrides: Partial<Cs486WorkerProcessView> = {},
  ): Cs486WorkerProcessView {
    return {
      hasPendingCpuCycles: false,
      memoryLimitBytes: actor.memoryBytes,
      memoryUsageBytes: 256,
      microarchitectureStats: {
        busTransfers: 0,
        instructionFetches: 0,
        l1Hits: 0,
        l1Misses: 0,
        l2Hits: 0,
        l2Misses: 0,
        pipelineFlushes: 0,
        unalignedAccesses: 0,
      },
      microarchitectureStatsEnabled: actor.collectMicroarchitectureStats,
      output: "",
      state: { kind: "ready" },
      workerCount: this.workerCount,
      workerIndex: stableWorkerIndexForComputer(
        actor.computerId,
        this.workerCount,
      ),
      ...overrides,
    };
  }
}

function poweredRuntime(
  record: ComputerRecord,
  options: ConstructorParameters<typeof ComputerRuntime>[0] = {},
): ComputerRuntime {
  const runtime = new ComputerRuntime(options);
  expect(runtime.register(record).outcome).toBe("accepted");
  expect(runtime.powerOn(record.computerId).outcome).toBe("accepted");
  runUntil(runtime, () => shellAcceptsInput(runtime, record));
  return runtime;
}

function compileHosted(
  runtime: ComputerRuntime,
  record: ComputerRecord,
  name: string,
  source: readonly string[],
): void {
  record.filesystem.writeFile(`/tmp/${name}.c`, `${source.join("\n")}\n`);
  expect(
    enqueue(runtime, record, `cc /tmp/${name}.c -o /tmp/${name}`),
  ).toMatchObject({ exitCode: 0, outcome: "completed" });
}

function enqueue(
  runtime: ComputerRuntime,
  record: ComputerRecord,
  line: string,
): DebugShellCommandCompletion {
  let completion: DebugShellCommandCompletion | undefined;
  runtime.enqueueDebugShellCommand(record.computerId, line, (result) => {
    completion = result;
  });
  for (let tick = 0; tick < 1_000 && completion === undefined; tick += 1) {
    runtime.runTick();
  }
  if (completion === undefined)
    throw new Error(`queued debug command did not complete: ${line}`);
  return completion;
}

function submitLine(
  runtime: ComputerRuntime,
  record: ComputerRecord,
  line: string,
): void {
  runUntil(runtime, () => shellAcceptsInput(runtime, record));
  expect(
    runtime.queueEvent(record.computerId, "terminal_line", line),
  ).toMatchObject({ outcome: "accepted" });
  runtime.runTick();
  runUntil(runtime, () => shellAcceptsInput(runtime, record));
}

/**
 * The same submission for a Computer whose processes live in the compute plane.
 * Remote slices settle through promises, so the host loop has to yield between
 * ticks; an interactive session reaches the same state one host tick later.
 */
async function submitRemoteLine(
  runtime: ComputerRuntime,
  record: ComputerRecord,
  line: string,
): Promise<void> {
  await runUntilAsync(runtime, () => shellAcceptsInput(runtime, record));
  expect(
    runtime.queueEvent(record.computerId, "terminal_line", line),
  ).toMatchObject({ outcome: "accepted" });
  runtime.runTick();
  await runUntilAsync(runtime, () => shellAcceptsInput(runtime, record));
}

function shellAcceptsInput(
  runtime: ComputerRuntime,
  record: ComputerRecord,
): boolean {
  const state = runtime.vmState(record.computerId);
  return state?.kind === "waiting_event" && state.filter === undefined;
}

function terminalRows(record: ComputerRecord): readonly string[] {
  return record.terminal.snapshot().rows.map((row) => row.trimEnd());
}

function terminalFlow(record: ComputerRecord): string {
  return record.terminal.snapshot().rows.join("");
}

function runUntil(runtime: ComputerRuntime, predicate: () => boolean): void {
  for (let tick = 0; tick < 1_000; tick += 1) {
    if (predicate()) return;
    runtime.runTick();
  }
  throw new Error("runtime did not reach the expected state");
}

async function runUntilAsync(
  runtime: ComputerRuntime,
  predicate: () => boolean,
): Promise<void> {
  for (let tick = 0; tick < 1_000; tick += 1) {
    await settlePromises();
    if (predicate()) return;
    runtime.runTick();
    await settlePromises();
  }
  throw new Error("remote runtime did not reach the expected state");
}

async function settlePromises(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}
