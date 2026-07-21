import { describe, expect, it } from "vitest";

import { ShellSession } from "../../src/application/os/shellSession.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";

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

  it("rejects more/less in a pipeline or redirect", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem);
    filesystem.writeFile("/home/cs/demo.txt", "content");

    expect(shell.submit("cat demo.txt | more")).toMatchObject({ exitCode: 1 });
    expect(shell.submit("cat demo.txt | more").stderr).toContain(
      "cannot run in a pipeline or redirect",
    );
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
