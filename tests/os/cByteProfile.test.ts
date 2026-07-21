import { describe, expect, it } from "vitest";

import { ShellSession } from "../../src/application/os/shellSession.js";
import { validateCs486Executable } from "../../src/domain/cpu/cs486.js";
import {
  cs486Byte8DataModel,
  cs486Word32DataModel,
} from "../../src/domain/cpu/cs486Compatibility.js";
import { validateCs486Object } from "../../src/domain/cpu/cs486Object.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";

describe("CS-Linux C byte profile", (): void => {
  it("selects byte headers and libc and exposes the model in guest tools", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem);
    filesystem.makeDirectory("/work");
    filesystem.writeFile(
      "/work/byte.c",
      [
        "#include <limits.h>",
        "#include <stdint.h>",
        "int main(void) {",
        "  uint8_t value = 42;",
        "  return CHAR_BIT == 8 && sizeof(value) == 1 && value == 42 ? 0 : 1;",
        "}",
      ].join("\n"),
    );

    expect(shell.submit("cc -mbyte8 /work/byte.c -o /work/byte")).toMatchObject(
      { exitCode: 0, stderr: "" },
    );
    const encoded = filesystem.readFile("/work/byte");
    expect(encoded.startsWith("CS486\n")).toBe(true);
    const executable: unknown = JSON.parse(encoded.slice(6));
    validateCs486Executable(executable);
    expect(executable).toMatchObject({
      dataModel: cs486Byte8DataModel,
      version: 5,
    });
    expect(shell.submit("run /work/byte")).toMatchObject({
      exitCode: 0,
      stderr: "",
      stdout: "",
    });
    expect(shell.submit("nm /work/byte").stdout).toContain(
      "# data-model cs-byte8-v1",
    );
    expect(shell.submit("objdump /work/byte").stdout).toContain(
      "format cs486-executable v5 cs-byte8-v1",
    );
    expect(shell.submit("csdb /work/byte").stdout).toContain("cs-byte8-v1");
  });

  it("rejects mixed objects before creating an output file", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem);
    filesystem.makeDirectory("/work");
    filesystem.writeFile("/work/byte.c", "int byte_value(void){return 1;}\n");
    filesystem.writeFile("/work/word.c", "int main(void){return 0;}\n");
    expect(
      shell.submit("cc -mbyte8 -c /work/byte.c -o /work/byte.o").exitCode,
    ).toBe(0);
    expect(shell.submit("cc -c /work/word.c -o /work/word.o").exitCode).toBe(0);

    const result = shell.submit("ld /work/word.o /work/byte.o -o /work/mixed");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/mixed CS486 data models/u);
    expect(filesystem.exists("/work/mixed")).toBe(false);
  });

  it("rejects mismatched floating signatures before creating output", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem);
    filesystem.makeDirectory("/work");
    filesystem.writeFile(
      "/work/caller.c",
      "extern double transform(double); int main(void){return transform(1.0)==1.0?0:1;}\n",
    );
    filesystem.writeFile(
      "/work/definition.c",
      "float transform(float value){return value;}\n",
    );
    expect(
      shell.submit("cc -c /work/caller.c -o /work/caller.o").exitCode,
    ).toBe(0);
    expect(
      shell.submit("cc -c /work/definition.c -o /work/definition.o").exitCode,
    ).toBe(0);

    const result = shell.submit(
      "ld /work/caller.o /work/definition.o -o /work/bad-float",
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/function signature mismatch transform/u);
    expect(filesystem.exists("/work/bad-float")).toBe(false);
  });

  it.each([
    { dataModel: cs486Word32DataModel, option: "" },
    { dataModel: cs486Byte8DataModel, option: "-mbyte8 " },
  ])(
    "selects the matching installed libm archive for $dataModel",
    ({ dataModel, option }): void => {
      const filesystem = new InMemoryFilesystem();
      const shell = new ShellSession(filesystem);
      filesystem.makeDirectory("/work");
      filesystem.writeFile(
        "/work/math.c",
        [
          "#include <math.h>",
          "int main(void){",
          "  return sqrt(81.0) == 9.0 && fmod(17.5, 4.0) == 1.5 ? 0 : 1;",
          "}",
        ].join("\n"),
      );

      expect(
        shell.submit(`cc ${option}/work/math.c -lm -o /work/math`),
      ).toMatchObject({ exitCode: 0, stderr: "" });
      const encoded = filesystem.readFile("/work/math");
      const executable: unknown = JSON.parse(encoded.slice(6));
      validateCs486Executable(executable);
      expect(executable.dataModel).toBe(dataModel);
      expect(shell.submit("run /work/math")).toMatchObject({
        exitCode: 0,
        stderr: "",
        stdout: "",
      });
    },
  );

  it("accepts explicit DOS slash options without changing the model identity", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem, { osProfile: "dos" });
    filesystem.writeFile(
      "/drives/c/byte.c",
      "int main(void){unsigned char value=255; return value==255?0:1;}\r\n",
    );

    expect(shell.submit("CC /MBYTE8 /C BYTE.C /OUT:BYTE.OBJ")).toMatchObject({
      exitCode: 0,
      stderr: "",
    });
    const encoded = filesystem.readFile("/drives/c/byte.obj");
    expect(encoded.startsWith("CS486OBJ\n")).toBe(true);
    const object: unknown = JSON.parse(encoded.slice(9));
    validateCs486Object(object);
    expect(object).toMatchObject({
      dataModel: cs486Byte8DataModel,
      version: 4,
    });
  });
});
