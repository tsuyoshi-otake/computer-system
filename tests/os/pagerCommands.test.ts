import { describe, expect, it } from "vitest";

import { ShellSession } from "../../src/application/os/shellSession.js";
import {
  defaultFilesystemLimits,
  InMemoryFilesystem,
} from "../../src/domain/filesystem/inMemoryFilesystem.js";

describe("CS-Linux more/less pager commands", (): void => {
  it("opens more, pages forward with Space, and quits back to the prompt", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem);
    const lines = Array.from(
      { length: 40 },
      (_, index) => `line ${String(index + 1)}`,
    );
    filesystem.writeFile("/home/cs/demo.txt", lines.join("\n"));

    const opened = shell.submit("more demo.txt");
    expect(opened.terminalScreen).toBeDefined();
    expect(topLine(opened)).toBe("line 1");
    expect(screenText(opened)).toContain("--More--");

    const paged = shell.keys(["Space"]);
    expect(topLine(paged)).not.toBe("line 1");

    const quit = shell.keys(["q"]);
    expect(quit.resetTerminal).toBe(true);
    expect(shell.prompt()).not.toBe("");
  });

  it("opens less and supports backward scrolling and g/G jumps", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem);
    const lines = Array.from(
      { length: 40 },
      (_, index) => `line ${String(index + 1)}`,
    );
    filesystem.writeFile("/home/cs/demo.txt", lines.join("\n"));

    shell.submit("less demo.txt");
    const bottom = shell.keys(["G"]);
    expect(screenText(bottom)).toContain("(Bot)");
    const top = shell.keys(["g"]);
    expect(topLine(top)).toBe("line 1");
    expect(screenText(top)).toContain("(Top)");
    const closed = shell.keys(["q"]);
    expect(closed.resetTerminal).toBe(true);
  });

  it("fails explicitly for a missing file, a directory, and the wrong argument count", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem);

    expect(shell.submit("more missing.txt")).toMatchObject({ exitCode: 1 });
    expect(shell.submit("more missing.txt").stderr).toContain(
      "No such file or directory",
    );
    expect(shell.submit("less /home/cs")).toMatchObject({ exitCode: 1 });
    expect(shell.submit("less /home/cs").stderr).toContain("Is a directory");
    expect(shell.submit("more")).toMatchObject({ exitCode: 2 });
    expect(shell.submit("less a b")).toMatchObject({ exitCode: 2 });
  });

  it("opens more/less from a Linux pipe and rejects redirected display", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem);
    filesystem.writeFile("/home/cs/demo.txt", "content");

    const more = shell.submit("cat demo.txt | more");
    expect(more.terminalScreen).toBeDefined();
    expect(topLine(more)).toBe("content");
    expect(shell.keys(["q"]).resetTerminal).toBe(true);

    const less = shell.submit("dmesg | less");
    expect(less.terminalScreen).toBeDefined();
    expect(screenText(less)).toContain("CS-Linux");
    expect(shell.keys(["q"]).resetTerminal).toBe(true);

    expect(
      shell.submit("dmesg | less && echo done").terminalScreen,
    ).toBeDefined();
    const resumed = shell.keys(["q"]);
    expect(resumed.resetTerminal).toBe(true);
    expect(resumed.lines).toEqual(["done"]);
    expect(shell.submit("less demo.txt > out.txt")).toMatchObject({
      exitCode: 1,
    });
  });

  it("keeps a deleted or removed command explicitly unavailable", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem);
    filesystem.writeFile("/home/cs/demo.txt", "content");
    filesystem.delete("/usr/bin/less");

    expect(shell.submit("less demo.txt")).toMatchObject({ exitCode: 127 });
  });
});

describe("CS-DOS MORE", (): void => {
  it("pages files, redirected input, and guest-spooled pipelines", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem, { osProfile: "dos" });
    filesystem.writeFile(
      "/drives/c/temp/demo.txt",
      Array.from({ length: 40 }, (_, index) => `DOS ${String(index + 1)}`).join(
        "\r\n",
      ),
    );
    filesystem.writeFile("/drives/c/temp/p000001.tmp", "user-owned");

    const file = shell.submit("MORE C:\\TEMP\\DEMO.TXT");
    expect(file.terminalScreen).toBeDefined();
    expect(topLine(file)).toBe("DOS 1");
    expect(shell.keys(["q"]).resetTerminal).toBe(true);

    const redirected = shell.submit("MORE < C:\\TEMP\\DEMO.TXT");
    expect(topLine(redirected)).toBe("DOS 1");
    expect(shell.keys(["q"]).resetTerminal).toBe(true);

    const piped = shell.submit("TYPE C:\\TEMP\\DEMO.TXT | MORE");
    expect(topLine(piped)).toBe("DOS 1");
    expect(shell.keys(["q"]).resetTerminal).toBe(true);
    expect(filesystem.readFile("/drives/c/temp/p000001.tmp")).toBe(
      "user-owned",
    );
    expect(
      filesystem
        .list("/drives/c/temp")
        .filter((name) => /^p\d{6}\.tmp$/u.test(name)),
    ).toEqual(["p000001.tmp"]);
  });

  it("does not expose LESS or Linux descriptor redirect syntax", (): void => {
    const shell = new ShellSession(new InMemoryFilesystem(), {
      osProfile: "dos",
    });
    expect(shell.submit("LESS C:\\AUTOEXEC.BAT").exitCode).toBe(127);
    expect(shell.submit("DIR 2>NUL").exitCode).toBe(2);
    expect(shell.submit("DIR |& MORE").exitCode).toBe(2);
  });

  it("rejects terminal-owned MORE from synchronous BAT execution", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem, { osProfile: "dos" });
    filesystem.writeFile(
      "/drives/c/page.bat",
      "@ECHO OFF\r\nMORE C:\\AUTOEXEC.BAT\r\n",
    );

    const result = shell.submit("PAGE");
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(
      "asynchronous or terminal-control commands are not supported",
    );
    expect(result.terminalScreen).toBeUndefined();
  });

  it("aborts and cleans its owned spool when guest disk capacity is exhausted", (): void => {
    const filesystem = new InMemoryFilesystem({
      ...defaultFilesystemLimits,
      capacityBytes: 2 * 1_024 * 1_024,
    });
    const shell = new ShellSession(filesystem, { osProfile: "dos" });
    filesystem.writeFile(
      "/drives/c/fill.bin",
      "x".repeat(filesystem.getFreeSpace() - 1),
    );

    const result = shell.submit("ECHO too-large | MORE");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/capacity|space|full/iu);
    expect(
      filesystem
        .list("/drives/c/temp")
        .filter((name) => /^p\d{6}\.tmp$/u.test(name)),
    ).toEqual([]);
    expect(result.terminalScreen).toBeUndefined();
  });
});

function topLine(result: ReturnType<ShellSession["submit"]>): string {
  return (
    result.terminalScreen?.rows[0]
      ?.map((cell) => cell.character)
      .join("")
      .trimEnd() ?? ""
  );
}

function screenText(result: ReturnType<ShellSession["submit"]>): string {
  return (
    result.terminalScreen?.rows
      .map((row) => row.map((cell) => cell.character).join(""))
      .join("\n") ?? ""
  );
}
