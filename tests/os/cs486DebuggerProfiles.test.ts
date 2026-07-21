import { describe, expect, it } from "vitest";

import { ShellSession } from "../../src/application/os/shellSession.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";

describe("CS486 debugger shell profiles", (): void => {
  it("debugs a C executable with Linux csdb commands", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem);
    filesystem.makeDirectory("/work");
    filesystem.writeFile(
      "/work/debug.c",
      [
        "int main() {",
        "int answer = 6 * 7;",
        'printf("%d\\n", answer);',
        "return answer;",
        "}",
      ].join("\n"),
    );

    expect(shell.submit("cc /work/debug.c -o /work/debug")).toMatchObject({
      exitCode: 0,
      stderr: "",
    });
    expect(shell.submit("csdb /work/debug")).toMatchObject({
      exitCode: 0,
      stderr: "",
    });
    expect(shell.submit("csdb break main").stdout).toMatch(
      /^breakpoint set at 0x[0-9a-f]{8}\n$/u,
    );
    expect(shell.submit("csdb continue 100").stdout).toMatch(
      /paused at 0x[0-9a-f]{8} \(breakpoint; \d+ instruction\(s\), \d+ cycles\)\n$/u,
    );
    expect(shell.submit("csdb regs").stdout).toContain("ip 0x");
    expect(shell.submit("csdb disasm main 2").stdout).toContain("main:");
    expect(shell.submit("csdb memory 0 16").stdout).toMatch(
      /^0x00000000 {2}(?:[0-9a-f]{2} ?){16}\n$/u,
    );
    expect(shell.submit("csdb step").stdout).toContain("(step;");
    const completed = shell.submit("csdb continue 1000");
    expect(completed).toMatchObject({ exitCode: 0, stderr: "" });
    expect(completed.stdout).toContain("42\n");
    expect(completed.stdout).toMatch(/halted at 0x[0-9a-f]{8}/u);
    expect(shell.submit("csdb quit").stdout).toBe("debugger closed\n");
    expect(shell.submit("csdb status")).toMatchObject({
      exitCode: 1,
      stderr: "csdb: no program loaded\n",
    });
  });

  it("exposes the same bounded core through DOS DEBUG syntax and CRLF", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem, { osProfile: "dos" });
    filesystem.writeFile(
      "/drives/c/debug.c",
      [
        "int main() {",
        "int answer = 40 + 2;",
        'printf("%d\\n", answer);',
        "return answer;",
        "}",
      ].join("\n"),
    );

    expect(shell.submit("CC C:\\DEBUG.C /OUT:C:\\DEBUGCS")).toMatchObject({
      exitCode: 0,
      stderr: "",
    });
    expect(shell.submit("DEBUG C:\\DEBUGCS").stdout).toMatch(
      /^Loaded C:\\DEBUGCS: \d+ instructions, cs-word32-v1\r\n[0-9A-F]{8} {2}/u,
    );
    expect(shell.submit("DEBUG BP MAIN").stdout).toMatch(
      /^breakpoint set at [0-9A-F]{8}\r\n$/u,
    );
    expect(shell.submit("DEBUG G 100").stdout).toContain("Paused at ");
    expect(shell.submit("DEBUG R").stdout).toMatch(
      /^EIP=[0-9A-F]{8} EAX=[0-9A-F]{8}/u,
    );
    expect(shell.submit("DEBUG U MAIN 2").stdout).toContain("main:");
    expect(shell.submit("DEBUG D 0 16").stdout).toMatch(
      /^[0-9A-F]{8} {2}(?:[0-9a-f]{2} ?){16}\r\n$/u,
    );
    expect(shell.submit("DEBUG T").stdout).toContain("(step;");
    const completed = shell.submit("DEBUG G 1000");
    expect(completed).toMatchObject({ exitCode: 0, stderr: "" });
    expect(completed.stdout).toContain("42\r\n");
    expect(completed.stdout).toContain("Halted at ");
    expect(shell.submit("DEBUG Q").stdout).toBe("Program terminated.\r\n");
    expect(shell.submit("DEBUG STATUS")).toMatchObject({
      exitCode: 1,
      stderr: "DEBUG: No program loaded.\r\n",
    });
  });

  it("rejects debugger limits and clears retained state on disconnect", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem);
    filesystem.makeDirectory("/work");
    filesystem.writeFile("/work/one.asm", "global main\nmain:\nhalt\n");
    expect(shell.submit("as /work/one.asm -o /work/one").exitCode).toBe(0);
    expect(shell.submit("csdb /work/one").exitCode).toBe(0);
    const oversizedRead = shell.submit("csdb memory 0 4097");
    expect(oversizedRead.exitCode).toBe(1);
    expect(oversizedRead.stderr).toMatch(/memory read limit/u);
    const oversizedContinue = shell.submit("csdb continue 100001");
    expect(oversizedContinue.exitCode).toBe(1);
    expect(oversizedContinue.stderr).toMatch(/continue limit/u);
    shell.disconnect();
    expect(shell.submit("csdb status").exitCode).not.toBe(0);
  });
});
