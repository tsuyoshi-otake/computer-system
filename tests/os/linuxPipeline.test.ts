import { describe, expect, it } from "vitest";

import {
  createStreamingLinuxPipeline,
  linuxPipelineLimits,
  type LinuxPipelineHost,
} from "../../src/application/os/linuxPipeline.js";
import type { ShellCommandNode } from "../../src/application/os/shellSyntax.js";

describe("scheduler-owned Linux pipelines", (): void => {
  it("tick-slices yes | head, closes the reader, and reports SIGPIPE status 141", (): void => {
    let reserved = 0;
    let releases = 0;
    const host: LinuxPipelineHost = {
      commandAvailable: (): boolean => true,
      execute: (): never => {
        throw new Error(
          "streaming stages must not use complete-string execute",
        );
      },
      openRedirect: (): void => undefined,
      readRedirectBytes: (): Uint8Array => new Uint8Array(),
      reserveMemory: (bytes) => {
        reserved += bytes;
        return {
          release: (): void => {
            releases += 1;
          },
        };
      },
      transaction: (operation): void => operation(),
      writeRedirectBytes: (): void => undefined,
    };
    const pipeline = createStreamingLinuxPipeline(
      [command("yes"), command("head", "-n", "10")],
      ["pipe-stdout"],
      host,
    );

    expect(
      pipeline.process.runCpuSlice(linuxPipelineLimits.cpuCyclesPerStep, 1)
        .state.kind,
    ).toBe("ready");
    for (let slice = 0; slice < 1_000; slice += 1) {
      if (pipeline.process.state.kind !== "ready") break;
      pipeline.process.runCpuSlice(64, 8);
    }

    expect(pipeline.process.state).toMatchObject({
      kind: "completed",
      value: 0,
    });
    expect(pipeline.stageExitCodes()).toEqual([141, 0]);
    expect(pipeline.result()).toMatchObject({
      exitCode: 0,
      stderr: "",
      stdout: "y\n".repeat(10),
    });
    expect(reserved).toBeGreaterThan(linuxPipelineLimits.pipeCapacityBytes);
    expect(releases).toBe(1);
    pipeline.process.terminate("late termination is idempotent");
    expect(releases).toBe(1);
  });

  it("implements head -n 0 without consuming a producer byte", (): void => {
    const pipeline = createStreamingLinuxPipeline(
      [command("yes"), command("head", "-n", "0")],
      ["pipe-stdout"],
      memoryOnlyHost(),
    );
    for (let slice = 0; slice < 20; slice += 1) {
      if (pipeline.process.state.kind !== "ready") break;
      pipeline.process.runCpuSlice(64, 8);
    }
    expect(pipeline.result()).toMatchObject({ exitCode: 0, stdout: "" });
    expect(pipeline.stageExitCodes()).toEqual([141, 0]);
  });

  it("preserves arbitrary redirected bytes without a UTF-8 round trip", (): void => {
    const source = Uint8Array.from([0, 0xff, 0xc3, 0x28, 0x0a]);
    let redirected = new Uint8Array();
    const host: LinuxPipelineHost = {
      ...memoryOnlyHost(),
      readRedirectBytes: ({ path }): Uint8Array =>
        path === "in" ? source : new Uint8Array(),
      writeRedirectBytes: (path, bytes): void => {
        expect(path).toBe("out");
        redirected = new Uint8Array(bytes);
      },
    };
    const pipeline = createStreamingLinuxPipeline(
      [
        {
          redirects: [
            { descriptor: 0, kind: "open", mode: "read", path: "in" },
          ],
          words: ["cat"],
        },
        {
          redirects: [
            { descriptor: 1, kind: "open", mode: "write", path: "out" },
          ],
          words: ["cat"],
        },
      ],
      ["pipe-stdout"],
      host,
    );
    for (let slice = 0; slice < 1_000; slice += 1) {
      if (pipeline.process.state.kind !== "ready") break;
      pipeline.process.runCpuSlice(64, 8);
    }

    expect(pipeline.process.state).toMatchObject({
      kind: "completed",
      value: 0,
    });
    expect(redirected).toEqual(source);
  });
});

function command(...words: readonly string[]): ShellCommandNode {
  return { redirects: [], words };
}

function memoryOnlyHost(): LinuxPipelineHost {
  return {
    commandAvailable: (): boolean => true,
    execute: (): never => {
      throw new Error("unexpected generic execution");
    },
    openRedirect: (): void => undefined,
    readRedirectBytes: (): Uint8Array => new Uint8Array(),
    reserveMemory: () => ({ release: (): void => undefined }),
    transaction: (operation): void => operation(),
    writeRedirectBytes: (): void => undefined,
  };
}
