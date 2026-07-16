import { describe, expect, it } from "vitest";

import {
  DosBatchEngine,
  type DosBatchCallbacks,
  type DosBatchCommandResult,
} from "../../src/application/os/dosBatch.js";

describe("bounded DOS batch control", (): void => {
  it("indexes labels once and supports GOTO, SHIFT, and IF ERRORLEVEL", (): void => {
    const engine = new DosBatchEngine();
    const result = engine.execute(
      {
        arguments: ["first", "second"],
        name: "C:\\TEST.BAT",
        source: [
          "@ECHO OFF",
          "FAIL",
          "IF ERRORLEVEL 3 GOTO FAILED",
          "ECHO WRONG",
          ":FAILED",
          "ECHO LEVEL-%ERRORLEVEL%",
          "SHIFT",
          "ECHO %1",
        ].join("\r\n"),
      },
      createCallbacks(),
    );

    expect(result).toMatchObject({
      exitCode: 0,
      jumps: 1,
      kind: "completed",
      loadedPrograms: 1,
      stdout: "LEVEL-3\r\nsecond\r\n",
    });
    expect(result.steps).toBeGreaterThanOrEqual(7);
  });

  it("supports bounded label/external CALL and IF NOT EXIST", (): void => {
    const engine = new DosBatchEngine();
    const result = engine.execute(
      {
        name: "C:\\PARENT.BAT",
        source: [
          "@ECHO OFF",
          "CALL :SUB first second",
          "CALL CHILD.BAT gamma",
          "IF NOT EXIST C:\\MISSING.TXT ECHO ABSENT",
          "GOTO :EOF",
          ":SUB",
          "SHIFT",
          "ECHO LOCAL-%1",
          "GOTO :EOF",
        ].join("\r\n"),
      },
      createCallbacks({
        loadBatch: (path) =>
          path.toUpperCase() === "CHILD.BAT"
            ? {
                name: "C:\\CHILD.BAT",
                source: "@ECHO OFF\r\nECHO CHILD-%1",
              }
            : undefined,
      }),
    );

    expect(result).toMatchObject({
      calls: 2,
      exitCode: 0,
      kind: "completed",
      loadedPrograms: 2,
      stdout: "LOCAL-second\r\nCHILD-gamma\r\nABSENT\r\n",
    });
  });

  it("implements COMMAND /C as one bounded callback command", (): void => {
    const commands: string[] = [];
    const engine = new DosBatchEngine();
    const result = engine.executeCommand(
      "ECHO NESTED",
      createCallbacks({
        execute: (commandLine, context) => {
          commands.push(commandLine);
          expect(context.programName).toBe("COMMAND.COM");
          return echoCommand(commandLine);
        },
      }),
    );

    expect(commands).toEqual(["ECHO NESTED"]);
    expect(result).toMatchObject({
      exitCode: 0,
      kind: "completed",
      stdout: "NESTED\r\n",
    });

    const rooted = engine.execute(
      {
        name: "C:\\ROOTED.BAT",
        source: "@C:\\COMMAND.COM /C ECHO ROOTED",
      },
      createCallbacks(),
    );
    expect(rooted).toMatchObject({
      exitCode: 0,
      kind: "completed",
      stdout: "ROOTED\r\n",
    });

    const kept = engine.execute(
      {
        name: "C:\\KEPT.BAT",
        source: "@COMMAND.COM /K ECHO KEPT",
      },
      createCallbacks(),
    );
    expect(kept).toMatchObject({
      exitCode: 0,
      kind: "completed",
      stdout: "KEPT\r\n",
    });
  });

  it("terminates infinite jumps, recursive calls, arguments, and output", (): void => {
    const jump = new DosBatchEngine({
      maximumJumps: 3,
      maximumSteps: 100,
    }).execute(
      {
        name: "LOOP.BAT",
        source: "@ECHO OFF\r\n:LOOP\r\nGOTO LOOP",
      },
      createCallbacks(),
    );
    expect(jump).toMatchObject({
      failure: { code: "jump_limit" },
      kind: "failed",
    });

    const call = new DosBatchEngine({ maximumCallDepth: 2 }).execute(
      {
        name: "CALL.BAT",
        source: "@ECHO OFF\r\n:LOOP\r\nCALL :LOOP",
      },
      createCallbacks(),
    );
    expect(call).toMatchObject({
      failure: { code: "call_depth_limit" },
      kind: "failed",
    });

    const arguments_ = new DosBatchEngine().execute(
      {
        arguments: Array.from({ length: 10 }, (_, index) => String(index)),
        name: "ARGS.BAT",
        source: "@ECHO OFF",
      },
      createCallbacks(),
    );
    expect(arguments_).toMatchObject({
      failure: { code: "argument_limit" },
      kind: "failed",
    });

    const output = new DosBatchEngine({ maximumOutputCharacters: 5 }).execute(
      { name: "LOUD.BAT", source: "@ECHO OFF\r\nLOUD" },
      createCallbacks({
        execute: () => ({ exitCode: 0, stdout: "123456" }),
      }),
    );
    expect(output).toMatchObject({
      failure: { code: "output_limit" },
      kind: "failed",
      stdout: "",
    });
    expect(output.stdout.length + output.stderr.length).toBeLessThanOrEqual(5);
  });

  it("reports duplicate/missing labels, batches, and callback failures explicitly", (): void => {
    const engine = new DosBatchEngine();
    const duplicate = engine.execute(
      { name: "DUP.BAT", source: ":ONE\r\n:one" },
      createCallbacks(),
    );
    expect(duplicate).toMatchObject({
      failure: { code: "duplicate_label", lineNumber: 2 },
      kind: "failed",
    });

    const missingLabel = engine.execute(
      { name: "MISS.BAT", source: "@ECHO OFF\r\nGOTO ABSENT" },
      createCallbacks(),
    );
    expect(missingLabel).toMatchObject({
      failure: { code: "label_not_found" },
      kind: "failed",
    });

    const missingBatch = engine.execute(
      { name: "MISS.BAT", source: "@ECHO OFF\r\nCALL ABSENT.BAT" },
      createCallbacks(),
    );
    expect(missingBatch).toMatchObject({
      failure: { code: "batch_not_found" },
      kind: "failed",
    });

    const callback = engine.execute(
      {
        name: "EXIST.BAT",
        source: "@ECHO OFF\r\nIF EXIST C:\\FILE.TXT ECHO YES",
      },
      createCallbacks({
        exists: () => {
          throw new Error("device unavailable");
        },
      }),
    );
    expect(callback).toMatchObject({
      failure: { code: "callback_error", detail: "device unavailable" },
      kind: "failed",
    });
  });
});

function createCallbacks(
  overrides: Partial<DosBatchCallbacks> = {},
): DosBatchCallbacks {
  return {
    execute: (commandLine): DosBatchCommandResult => {
      if (commandLine.toUpperCase() === "FAIL") return { exitCode: 3 };
      return echoCommand(commandLine);
    },
    exists: (path): boolean => path.toUpperCase() === "C:\\PRESENT.TXT",
    getEnvironment: (name): string | undefined =>
      name === "MODE" ? "PORTABLE" : undefined,
    ...overrides,
  };
}

function echoCommand(commandLine: string): DosBatchCommandResult {
  const echo = /^ECHO(?:\s+(.*))?$/iu.exec(commandLine);
  return echo === null
    ? { exitCode: 0 }
    : { exitCode: 0, stdout: `${echo[1] ?? ""}\r\n` };
}
