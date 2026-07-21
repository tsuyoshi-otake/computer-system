import { describe, expect, it } from "vitest";

import { ShellSession } from "../../src/application/os/shellSession.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";

describe("CS-Linux bounded process utilities", (): void => {
  it("captures nice values on scheduler-owned process admission", (): void => {
    const filesystem = new InMemoryFilesystem();
    const session = new ShellSession(filesystem, { osProfile: "linux" });
    filesystem.writeFile("/tmp/work.py", "print('ok')\n");

    const result = session.submit("nice -n 15 python /tmp/work.py");

    expect(result.exitCode).toBe(0);
    expect(result.foreground?.niceValue).toBe(15);
    const rejected = session.submit("nice -n -1 python /tmp/work.py");
    expect(rejected.exitCode).toBe(1);
    expect(rejected.stderr).toContain("requires root");
  });

  it("marks the supported nohup background subset as detached", (): void => {
    const session = new ShellSession(new InMemoryFilesystem(), {
      osProfile: "linux",
    });

    const result = session.submit("nohup sleep 2 &");

    expect(result.exitCode).toBe(0);
    expect(result.background).toMatchObject({
      command: "sleep",
      detached: true,
      sleepTicks: 40,
    });
  });

  it("refreshes watch only on guest ticks and reaches an explicit count terminal", (): void => {
    const session = new ShellSession(new InMemoryFilesystem(), {
      osProfile: "linux",
    });
    const admitted = session.submit("watch -n 1 -c 2 -- echo hello");
    const request = admitted.foreground;
    expect(request?.kind).toBe("debugger");
    if (request?.kind !== "debugger") throw new Error("watch was not admitted");
    const process = request.start();

    expect(process.advanceTick(1).kind).toBe("sleeping");
    expect(process.advanceTick(20).kind).toBe("sleeping");
    expect(process.advanceTick(21).kind).toBe("completed");
    const completed = request.complete();
    expect(completed.exitCode).toBe(0);
    expect(completed.stdout).toContain("hello\n");
  });

  it("rejects watch count beyond the production bound", (): void => {
    const session = new ShellSession(new InMemoryFilesystem(), {
      osProfile: "linux",
    });

    const rejected = session.submit("watch -c 3601 -- echo no");
    expect(rejected.exitCode).toBe(2);
    expect(rejected.stderr).toContain("Usage: watch");
  });
});
