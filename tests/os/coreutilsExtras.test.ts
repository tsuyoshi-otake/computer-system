import { describe, expect, it } from "vitest";

import { ShellSession } from "../../src/application/os/shellSession.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";

describe("CS-Linux md5sum, base64, and nl", (): void => {
  it("prints the md5 digest of a file and of stdin", (): void => {
    const shell = new ShellSession(new InMemoryFilesystem());

    expect(shell.submit("printf abc | tee /tmp/value").stdout).toBe("abc");
    expect(shell.submit("md5sum /tmp/value").stdout).toBe(
      "900150983cd24fb0d6963f7d28e17f72  /tmp/value\n",
    );
    expect(shell.submit("printf abc | md5sum").stdout).toBe(
      "900150983cd24fb0d6963f7d28e17f72  -\n",
    );
  });

  it("fails explicitly for a missing file and too many operands", (): void => {
    const shell = new ShellSession(new InMemoryFilesystem());

    const missing = shell.submit("md5sum /tmp/missing");
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toContain("md5sum:");
    const many = shell.submit(
      `md5sum ${Array.from({ length: 33 }, (_, index) => `/tmp/f${String(index)}`).join(" ")}`,
    );
    expect(many).toMatchObject({ exitCode: 1 });
    expect(many.stderr).toContain("too many files");
  });

  it("encodes and decodes base64, round-tripping through a file", (): void => {
    const shell = new ShellSession(new InMemoryFilesystem());

    expect(shell.submit("printf hello | tee /tmp/value").stdout).toBe("hello");
    expect(shell.submit("base64 /tmp/value").stdout).toBe("aGVsbG8=\n");
    expect(shell.submit("base64 /tmp/value | base64 -d").stdout).toBe("hello");
  });

  it("rejects malformed base64 input explicitly", (): void => {
    const shell = new ShellSession(new InMemoryFilesystem());

    const decoded = shell.submit("printf 'not base64!!' | base64 -d");
    expect(decoded.exitCode).toBe(1);
    expect(decoded.stderr).toContain("base64: invalid base64 input");
  });

  it("wraps long base64 output at 76 columns like traditional base64", (): void => {
    const shell = new ShellSession(new InMemoryFilesystem());

    shell.submit(`printf ${"x".repeat(80)} | tee /tmp/long`);
    const lines = shell.submit("base64 /tmp/long").stdout.trimEnd().split("\n");
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0]!.length).toBe(76);
  });

  it("numbers non-blank lines and leaves blank lines unnumbered", (): void => {
    const shell = new ShellSession(new InMemoryFilesystem());
    shell.submit("printf 'first\\n\\nsecond\\n' | tee /tmp/lines");

    expect(shell.submit("nl /tmp/lines").stdout).toBe(
      "     1\tfirst\n      \t\n     2\tsecond\n",
    );
  });

  it("numbers stdin when no file is given and rejects too many files", (): void => {
    const shell = new ShellSession(new InMemoryFilesystem());

    expect(shell.submit("printf 'a\\nb\\n' | nl").stdout).toBe(
      "     1\ta\n     2\tb\n",
    );
    const many = shell.submit(
      `nl ${Array.from({ length: 33 }, (_, index) => `/tmp/f${String(index)}`).join(" ")}`,
    );
    expect(many).toMatchObject({ exitCode: 1 });
    expect(many.stderr).toContain("too many files");
  });
});
