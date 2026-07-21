import { describe, expect, it } from "vitest";

import { unrestrictedGuestFilesystem } from "../../src/application/os/guestFilesystem.js";
import { initialUserCredentials } from "../../src/application/os/linuxCredentials.js";
import { linuxFilesystemImage } from "../../src/application/os/osFilesystemImages.js";
import {
  CsAbiRuntime,
  csAbiErrno,
  prepareCsAbiStartup,
} from "../../src/application/runtime/csAbi.js";
import {
  compileCs486Object,
  compileCs486Source,
} from "../../src/application/toolchain/highLevelCompilers.js";
import { linkCs486Objects } from "../../src/application/toolchain/cs486Linker.js";
import {
  Cs486Process,
  cs486ExecutableMemoryRequirements,
} from "../../src/domain/cpu/cs486.js";
import { cs486Byte8DataModel } from "../../src/domain/cpu/cs486Compatibility.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";
import { TerminalBuffer } from "../../src/domain/terminal/terminalBuffer.js";

describe("CS ABI byte-profile I/O", (): void => {
  it("round-trips every byte through the guest filesystem and a cold restore", (): void => {
    const executable = compileCs486Source(
      "c",
      [
        "int __cs_syscall(int selector, int a0, int a1, int a2);",
        "int main(int argc, char **argv) {",
        "  unsigned char source[256];",
        "  unsigned char copy[256];",
        '  char path[15] = "/all-bytes.bin";',
        '  char rejected[14] = "/rejected.bin";',
        "  int index;",
        "  if (argc != 2 || argv[1][0] != 'o' || argv[1][1] != 'k' || argv[1][2] != 0) return 10;",
        "  for (index = 0; index < 256; index++) source[index] = index;",
        "  int descriptor = __cs_syscall(8, (int)path, 15, 438);",
        "  if (descriptor < 3) return 11;",
        "  if (__cs_syscall(10, descriptor, (int)source, 256) != 256) return 12;",
        "  if (__cs_syscall(11, descriptor, 0, 0) != 0) return 13;",
        "  if (__cs_syscall(9, descriptor, (int)copy, 256) != 256) return 14;",
        "  if (__cs_syscall(13, descriptor, 0, 0) != 0) return 15;",
        "  for (index = 0; index < 256; index++) if (copy[index] != source[index]) return 16;",
        "  descriptor = __cs_syscall(8, (int)rejected, 14, 438);",
        "  if (descriptor < 3) return 17;",
        `  if (__cs_syscall(10, descriptor, 16777215, 2) != -${String(csAbiErrno.efault)}) return 18;`,
        "  if (__cs_syscall(13, descriptor, 0, 0) != 0) return 19;",
        "  return 0;",
        "}",
      ].join("\n"),
      { dataModel: cs486Byte8DataModel },
    );
    const startup = prepareCsAbiStartup(
      executable,
      { argv: ["/tmp/byte-io", "ok"], cwd: "/", environment: [] },
      initialUserCredentials,
    );
    const requirements = cs486ExecutableMemoryRequirements(executable);
    if (requirements.kind !== "declared")
      throw new Error("byte-profile executable must declare memory");
    const storage = new InMemoryFilesystem();
    const filesystem = unrestrictedGuestFilesystem(storage);
    const runtime = new CsAbiRuntime({
      computerId: "byte-io",
      credentials: initialUserCredentials,
      currentTick: (): number => 0,
      currentWallTimeMilliseconds: (): number => 0,
      cwd: "/",
      filesystem,
      heapBaseBytes: startup.heapBaseBytes,
      heapWords: startup.heapWords,
      runHostWork: (_lane, _units, action): boolean => {
        action();
        return true;
      },
      startupAddress: startup.startupAddress,
      terminal: new TerminalBuffer(80, 25),
    });
    const process = new Cs486Process(executable, {
      memoryBytes: requirements.linearAddressSpaceBytes,
      syscallHandler: runtime.syscallHandler,
    });
    process.initializeProcessImage(startup.image);

    const result = process.runCpuSlice(100_000_000, 1_000_000);

    expect(result.state).toEqual({ kind: "completed", value: 0 });
    expect([...filesystem.readFileBytes("/all-bytes.bin")]).toEqual(
      Array.from({ length: 256 }, (_, value) => value),
    );
    expect([...filesystem.readFileBytes("/rejected.bin")]).toEqual([]);
    const restored = new InMemoryFilesystem();
    restored.restore(storage.snapshot());
    expect([...restored.readFileBytes("/all-bytes.bin")]).toEqual(
      Array.from({ length: 256 }, (_, value) => value),
    );
  });

  it("rejects non-byte startup strings without constructing an image", (): void => {
    const executable = compileCs486Source("c", "int main(void){return 0;}", {
      dataModel: cs486Byte8DataModel,
    });

    expect(() =>
      prepareCsAbiStartup(
        executable,
        { argv: ["/tmp/program", "\u{100}"], cwd: "/", environment: [] },
        initialUserCredentials,
      ),
    ).toThrow(/single-byte characters/u);
  });

  it("runs the byte-profile libc stdio path without text conversion", (): void => {
    const files = new Map(
      linuxFilesystemImage.files.map((file) => [file.path, file.contents]),
    );
    const include = ({
      path,
    }: {
      readonly path: string;
    }):
      { readonly source: string; readonly sourceName: string } | undefined => {
      const sourceName = `/usr/include/${path}`;
      const source = files.get(sourceName);
      return source === undefined ? undefined : { source, sourceName };
    };
    const libc = compileCs486Object(
      "c",
      files.get("/usr/src/cs-libc/libc.c")!,
      {
        dataModel: cs486Byte8DataModel,
        include,
        sourceName: "/usr/src/cs-libc/libc.c",
      },
    );
    const application = compileCs486Object(
      "c",
      [
        "#include <stdint.h>",
        "#include <stdio.h>",
        "uint8_t source[256];",
        "uint8_t copy[256];",
        "int main(void) {",
        "  int index; FILE *file;",
        "  for (index = 0; index < 256; index++) source[index] = index;",
        '  file = fopen("/libc-bytes.bin", "w+");',
        "  if (file == (FILE *)0) return 10;",
        "  if (fwrite(source, 1, 256, file) != 256) return 11;",
        "  rewind(file);",
        "  if (fread(copy, 1, 256, file) != 256) return 12;",
        "  if (fclose(file) != 0) return 13;",
        "  for (index = 0; index < 256; index++) if (copy[index] != source[index]) return 14;",
        "  return 0;",
        "}",
      ].join("\n"),
      {
        dataModel: cs486Byte8DataModel,
        include,
        sourceName: "/tmp/libc-byte-io.c",
      },
    );
    const executable = linkCs486Objects([application, libc], { entry: "main" });
    const startup = prepareCsAbiStartup(
      executable,
      { argv: ["/tmp/libc-byte-io"], cwd: "/", environment: [] },
      initialUserCredentials,
    );
    const requirements = cs486ExecutableMemoryRequirements(executable);
    if (requirements.kind !== "declared")
      throw new Error("byte libc executable must declare memory");
    const storage = new InMemoryFilesystem();
    const filesystem = unrestrictedGuestFilesystem(storage);
    const runtime = new CsAbiRuntime({
      computerId: "byte-libc-io",
      credentials: initialUserCredentials,
      currentTick: (): number => 0,
      currentWallTimeMilliseconds: (): number => 0,
      cwd: "/",
      filesystem,
      heapBaseBytes: startup.heapBaseBytes,
      heapWords: startup.heapWords,
      runHostWork: (_lane, _units, action): boolean => {
        action();
        return true;
      },
      startupAddress: startup.startupAddress,
      terminal: new TerminalBuffer(80, 25),
    });
    const process = new Cs486Process(executable, {
      memoryBytes: requirements.linearAddressSpaceBytes,
      syscallHandler: runtime.syscallHandler,
    });
    process.initializeProcessImage(startup.image);

    const result = process.runCpuSlice(100_000_000, 1_000_000);

    expect(result.state).toEqual({ kind: "completed", value: 0 });
    expect([...filesystem.readFileBytes("/libc-bytes.bin")]).toEqual(
      Array.from({ length: 256 }, (_, value) => value),
    );
  });
});
