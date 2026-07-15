import { describe, expect, it } from "vitest";

import { ShellSession } from "../../src/application/os/shellSession.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";

describe("DOS shell syntax boundary", (): void => {
  it("keeps the documented bounded pipeline and control extensions", (): void => {
    const shell = new ShellSession(new InMemoryFilesystem(), {
      osProfile: "dos",
    });

    expect(shell.submit("ECHO A && ECHO B").lines).toEqual(["A", "B"]);
    expect(shell.submit("ECHO A || ECHO B").lines).toEqual(["A"]);
    expect(shell.submit("ECHO VALUE | TYPE").lines).toEqual(["VALUE"]);
  });

  it("rejects Bash-only syntax with a DOS terminal result", (): void => {
    const shell = new ShellSession(new InMemoryFilesystem(), {
      osProfile: "dos",
    });

    for (const line of ["ECHO A; ECHO B", "ECHO $OS", "ECHO 'VALUE'"]) {
      const result = shell.submit(line);
      expect(result.exitCode, line).toBe(2);
      expect(result.stderr, line).toMatch(/^Syntax error: /u);
      expect(result.stderr, line).toMatch(/\r\n$/u);
      expect(result.stderr, line).not.toContain("bash:");
    }
  });
});
