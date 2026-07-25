import { describe, expect, it } from "vitest";

import { ShellSession } from "../../src/application/os/shellSession.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";

function createLinuxShell(): {
  readonly filesystem: InMemoryFilesystem;
  readonly shell: ShellSession;
} {
  const filesystem = new InMemoryFilesystem();
  const shell = new ShellSession(filesystem, { osProfile: "linux" });
  filesystem.makeDirectory("/work");
  return { filesystem, shell };
}

function compileHosted(
  shell: ShellSession,
  filesystem: InMemoryFilesystem,
  name: string,
  source: readonly string[],
): void {
  filesystem.writeFile(`/work/${name}.c`, `${source.join("\n")}\n`);
  expect(shell.submit(`cc /work/${name}.c -o /work/${name}`)).toMatchObject({
    exitCode: 0,
    stderr: "",
  });
}

/**
 * A shell that hands guest execution to `ComputerRuntime` instead of running it
 * in place, which is how the interactive session admits a foreground process.
 * Compilation is deferred the same way, so the program is built through an
 * ordinary session over the same filesystem first.
 */
function createDeferredLinuxShell(
  name: string,
  source: readonly string[],
): {
  readonly filesystem: InMemoryFilesystem;
  readonly shell: ShellSession;
} {
  const { filesystem, shell } = createLinuxShell();
  compileHosted(shell, filesystem, name, source);
  return {
    filesystem,
    shell: new ShellSession(filesystem, {
      deferGuestExecution: true,
      osProfile: "linux",
    }),
  };
}

describe("CS-Linux run --batch", (): void => {
  it("runs a hosted C program that uses only the isolated CS ABI subset", (): void => {
    const { filesystem, shell } = createLinuxShell();
    compileHosted(shell, filesystem, "sum", [
      "#include <stdio.h>",
      "int main(void) {",
      "  int total = 0;",
      "  int index = 1;",
      "  while (index <= 10) {",
      "    total = total + index;",
      "    index = index + 1;",
      "  }",
      '  printf("total=%d\\n", total);',
      "  return 0;",
      "}",
    ]);

    const batch = shell.submit("run --batch /work/sum");
    expect(batch).toMatchObject({ exitCode: 0, stderr: "" });
    expect(batch.stdout).toBe("total=55\n");
    expect(shell.submit("run /work/sum").stdout).toBe(batch.stdout);
  });

  it("keeps fd 1 and fd 2 writes in one ordered stream", (): void => {
    const { filesystem, shell } = createLinuxShell();
    compileHosted(shell, filesystem, "streams", [
      "#include <stdio.h>",
      "int main(void) {",
      '  fputs("one", stdout);',
      '  fputs("two", stderr);',
      '  fputs("three", stdout);',
      "  return 0;",
      "}",
    ]);

    const batch = shell.submit("run --batch /work/streams");
    expect(batch.exitCode).toBe(0);
    expect(batch.stdout).toBe("onetwothree");
    expect(batch.stderr).toBe("");
  });

  it("reports the modeled cost of a batch run just like an ordinary run", (): void => {
    const { filesystem, shell } = createLinuxShell();
    compileHosted(shell, filesystem, "stats", ["int main(void) { return 0; }"]);

    const measured = shell.submit("run --batch --stats /work/stats");
    expect(measured.exitCode).toBe(0);
    expect(measured.stderr).toMatch(
      /\d+ instructions, \d+ CPU cycles, \d+\.\d{3} us at 33 MHz, halted/u,
    );
    expect(shell.submit("run --stats --batch /work/stats").exitCode).toBe(0);
  });

  it("fails explicitly when a batch program reaches for an OS service", (): void => {
    const { filesystem, shell } = createLinuxShell();
    compileHosted(shell, filesystem, "reader", [
      "#include <stdio.h>",
      "int main(void) {",
      '  FILE *file = fopen("/work/reader.c", "r");',
      "  return file == NULL ? 1 : 0;",
      "}",
    ]);

    expect(shell.submit("run /work/reader")).toMatchObject({ exitCode: 0 });
    expect(shell.submit("run --batch /work/reader")).toMatchObject({
      exitCode: 1,
      stderr:
        "run: batch process cannot use CS ABI operation 8; re-run this program without batch mode\n",
      stdout: "",
    });
    expect(filesystem.exists("/work/reader.c")).toBe(true);
  });

  it("rejects --batch for an executable that reaches no CS ABI service", (): void => {
    const { filesystem, shell } = createLinuxShell();
    filesystem.writeFile("/work/answer.asm", "mov eax, 42\nprint eax\nhalt\n");
    expect(shell.submit("as /work/answer.asm -o /work/answer").exitCode).toBe(
      0,
    );

    expect(shell.submit("run --batch /work/answer")).toMatchObject({
      exitCode: 1,
      stderr: "/work/answer: --batch requires a hosted CS-Linux executable\n",
      stdout: "",
    });
    expect(shell.submit("run /work/answer").stdout).toBe("42");
  });

  it("rejects a repeated --batch option before reading the executable", (): void => {
    const { shell } = createLinuxShell();
    expect(shell.submit("run --batch --batch /work/missing")).toMatchObject({
      exitCode: 2,
      stderr: "Usage: run [--batch] [--stats] <executable> [arguments ...]\n",
    });
  });

  it("rejects --batch on CS-DOS, which has no such declaration", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem, { osProfile: "dos" });
    expect(shell.submit("RUN --batch C:\\ANSWER")).toMatchObject({
      exitCode: 2,
      stderr: "Usage: run [--stats] <executable>\r\n",
    });
    expect(shell.submit("RUN /BATCH C:\\ANSWER")).toMatchObject({
      exitCode: 2,
      stderr: "Usage: run [--stats] <executable>\r\n",
    });
  });

  it("admits the batch declaration into the deferred foreground request", (): void => {
    const { shell } = createDeferredLinuxShell("deferred", [
      "int main(void) { return 0; }",
    ]);

    expect(shell.submit("run --batch /work/deferred").foreground).toMatchObject(
      { batch: true, command: "run", kind: "cs486" },
    );
    const ordinary = shell.submit("run /work/deferred").foreground;
    expect(ordinary).toMatchObject({ command: "run", kind: "cs486" });
    expect(ordinary).not.toHaveProperty("batch");
  });

  it("rejects --batch with a pipeline or a redirect before the process starts", (): void => {
    const { filesystem, shell } = createDeferredLinuxShell("piped", [
      "int main(void) { return 0; }",
    ]);

    const piped = shell.submit("run --batch /work/piped | cat");
    expect(piped).toMatchObject({
      exitCode: 2,
      stderr: "run: --batch cannot be used with a pipeline or a redirect\n",
    });
    expect(piped.foreground).toBeUndefined();

    const redirected = shell.submit("run --batch /work/piped > /work/out");
    expect(redirected).toMatchObject({
      exitCode: 2,
      stderr: "run: --batch cannot be used with a pipeline or a redirect\n",
    });
    expect(redirected.foreground).toBeUndefined();
    expect(filesystem.exists("/work/out")).toBe(false);

    expect(shell.submit("run /work/piped | cat").exitCode).toBe(0);
  });

  it("rejects a redirect the same way when the session runs the program itself", (): void => {
    const { filesystem, shell } = createLinuxShell();
    compileHosted(shell, filesystem, "direct", [
      "#include <stdio.h>",
      'int main(void) { printf("direct\\n"); return 0; }',
    ]);

    expect(shell.submit("run --batch /work/direct > /work/out")).toMatchObject({
      exitCode: 2,
      stderr: "run: --batch cannot be used with a pipeline or a redirect\n",
      stdout: "",
    });
    expect(filesystem.exists("/work/out")).toBe(false);
    expect(shell.submit("run --batch /work/direct").stdout).toBe("direct\n");
    expect(shell.submit("run /work/direct > /work/out").exitCode).toBe(0);
    expect(filesystem.readFile("/work/out")).toBe("direct\n");
  });

  it("rejects --batch as a background job", (): void => {
    const { shell } = createDeferredLinuxShell("job", [
      "int main(void) { return 0; }",
    ]);

    const background = shell.submit("run --batch /work/job &");
    expect(background).toMatchObject({
      exitCode: 2,
      stderr: "run: --batch cannot become a background job\n",
    });
    expect(background.background).toBeUndefined();
    expect(shell.submit("run /work/job &").background).toMatchObject({
      command: "run",
      kind: "cs486",
    });
  });
});
