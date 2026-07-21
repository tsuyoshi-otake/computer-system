import { describe, expect, it, vi } from "vitest";

import { ShellSession } from "../../src/application/os/shellSession.js";
import { parseCs486Archive } from "../../src/application/toolchain/cs486Archive.js";
import { ComputerRecord } from "../../src/domain/computer/computer.js";

describe("CS-Linux static archive compiler workflow", (): void => {
  it("creates, indexes, lists, extracts, and demand-links CS486AR libraries", (): void => {
    const record = new ComputerRecord("c-007101", "advanced");
    const shell = new ShellSession(record.filesystem, { osProfile: "linux" });
    record.filesystem.makeDirectory("/work");
    record.filesystem.writeFile(
      "/work/answer.c",
      "int unused(){return 7;}\nint answer(){return 42;}\n",
    );
    record.filesystem.writeFile(
      "/work/main.c",
      "int answer();\nint main(){return answer();}\n",
    );

    expect(
      shell.submit("cc -c /work/answer.c -o /work/answer.o"),
    ).toMatchObject({ exitCode: 0 });
    expect(shell.submit("cc -c /work/main.c -o /work/main.o")).toMatchObject({
      exitCode: 0,
    });
    expect(
      shell.submit("ar rcs /work/libanswer.csa /work/answer.o"),
    ).toMatchObject({ exitCode: 0 });
    expect(shell.submit("ranlib /work/libanswer.csa")).toMatchObject({
      exitCode: 0,
    });
    expect(shell.submit("ar t /work/libanswer.csa").stdout).toBe("answer.o\n");
    expect(
      parseCs486Archive(record.filesystem.readFile("/work/libanswer.csa"))
        .symbols,
    ).toEqual([
      { member: "answer.o", name: "answer" },
      { member: "answer.o", name: "unused" },
    ]);

    expect(
      shell.submit("ld /work/main.o -L/work -lanswer -o /work/linked"),
    ).toMatchObject({ exitCode: 0 });
    expect(
      shell.submit("ld -L/work -lanswer /work/main.o -o /work/wrong-order"),
    ).toMatchObject({ exitCode: 1 });
    expect(
      shell.submit("cc /work/main.c -L/work -lanswer -o /work/driver-linked"),
    ).toMatchObject({ exitCode: 0 });
    expect(
      shell.submit("cc -L/work -lanswer /work/main.c -o /work/driver-wrong"),
    ).toMatchObject({ exitCode: 1 });

    record.filesystem.delete("/work/answer.o");
    expect(shell.submit("cd /work")).toMatchObject({ exitCode: 0 });
    expect(shell.submit("ar x libanswer.csa answer.o")).toMatchObject({
      exitCode: 0,
    });
    expect(record.filesystem.readFile("/work/answer.o")).toMatch(
      /^CS486OBJ\n/u,
    );
    expect(shell.submit("ar d /work/libanswer.csa answer.o")).toMatchObject({
      exitCode: 0,
    });
    expect(shell.submit("ar t /work/libanswer.csa").stdout).toBe("");
  });

  it("accepts bounded compatibility flags and writes atomic MMD dependencies", (): void => {
    const record = new ComputerRecord("c-007102", "advanced");
    const shell = new ShellSession(record.filesystem, { osProfile: "linux" });
    record.filesystem.makeDirectory("/work");
    record.filesystem.writeFile("/work/value.h", "#define VALUE 42\n");
    record.filesystem.writeFile(
      "/work/main.c",
      '#include "value.h"\nint main(){return VALUE;}\n',
    );

    expect(
      shell.submit(
        "cc -std=c11 -O0 -g -Wall -Werror -I/work -MMD -MF /work/main.d -c /work/main.c -o /work/main.o",
      ),
    ).toMatchObject({ exitCode: 0 });
    expect(record.filesystem.readFile("/work/main.d")).toBe(
      "/work/main.o: /work/main.c /work/value.h\n",
    );
    const priorObject = record.filesystem.readFile("/work/main.o");
    record.filesystem.writeFile("/work/main.d", "previous dependencies\n");
    record.filesystem.writeFile("/work/main.c", "int main( {\n");
    expect(
      shell.submit(
        "cc -std=c11 -O0 -I/work -MMD -MF /work/main.d -c /work/main.c -o /work/main.o",
      ),
    ).toMatchObject({ exitCode: 1 });
    expect(record.filesystem.readFile("/work/main.o")).toBe(priorObject);
    expect(record.filesystem.readFile("/work/main.d")).toBe(
      "previous dependencies\n",
    );
    expect(shell.submit("cc -O2 -c /work/main.c").stderr).toContain(
      "unsupported optimization option",
    );
    expect(shell.submit("cc -std=gnu11 -c /work/main.c").stderr).toContain(
      "unsupported language standard",
    );
  });

  it("preserves an existing archive when its atomic replacement write fails", (): void => {
    const record = new ComputerRecord("c-007104", "advanced");
    const shell = new ShellSession(record.filesystem, { osProfile: "linux" });
    record.filesystem.makeDirectory("/work");
    record.filesystem.writeFile("/work/one.c", "int one(){return 1;}\n");
    record.filesystem.writeFile("/work/two.c", "int two(){return 2;}\n");
    expect(shell.submit("cc -c /work/one.c -o /work/one.o")).toMatchObject({
      exitCode: 0,
    });
    expect(shell.submit("cc -c /work/two.c -o /work/two.o")).toMatchObject({
      exitCode: 0,
    });
    expect(shell.submit("ar rcs /work/libkept.csa /work/one.o")).toMatchObject({
      exitCode: 0,
    });
    const before = record.filesystem.readFile("/work/libkept.csa");
    const originalWrite = record.filesystem.writeFile.bind(record.filesystem);
    const write = vi
      .spyOn(record.filesystem, "writeFile")
      .mockImplementation((path, contents): void => {
        if (record.filesystem.normalize(path) === "/work/libkept.csa")
          throw new Error("injected archive write failure");
        originalWrite(path, contents);
      });
    try {
      expect(
        shell.submit("ar rcs /work/libkept.csa /work/two.o"),
      ).toMatchObject({ exitCode: 1 });
    } finally {
      write.mockRestore();
    }
    expect(record.filesystem.readFile("/work/libkept.csa")).toBe(before);
  });
});
