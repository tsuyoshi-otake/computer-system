import { describe, expect, it } from "vitest";

import {
  CsAbiRuntime,
  type CsAbiStandardIo,
  csAbiErrno,
  csAbiLimits,
  csAbiSelectors,
  csAbiStartupMagic,
  prepareCsAbiStartup,
} from "../../src/application/runtime/csAbi.js";
import { unrestrictedGuestFilesystem } from "../../src/application/os/guestFilesystem.js";
import { initialUserCredentials } from "../../src/application/os/linuxCredentials.js";
import { linuxFilesystemImage } from "../../src/application/os/osFilesystemImages.js";
import {
  compileCs486Object,
  compileCs486Source,
} from "../../src/application/toolchain/highLevelCompilers.js";
import { linkCs486Objects } from "../../src/application/toolchain/cs486Linker.js";
import {
  Cs486Process,
  cs486ExecutableMemoryRequirements,
  type Cs486Register,
  type Cs486SyscallContext,
} from "../../src/domain/cpu/cs486.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";
import { TerminalBuffer } from "../../src/domain/terminal/terminalBuffer.js";

describe("CS ABI 1.0", (): void => {
  it("lowers only the compiler-owned four-register syscall intrinsic", (): void => {
    const executable = compileCs486Source(
      "c",
      "int __cs_syscall(int selector, int a0, int a1, int a2);\n" +
        "int main(){return __cs_syscall(5, 0, 0, 0);}\n",
    );
    const harness = createHarness();
    const requirements = cs486ExecutableMemoryRequirements(executable);
    if (requirements.kind !== "declared")
      throw new Error("hosted C executable must declare memory");
    const process = new Cs486Process(executable, {
      memoryBytes: requirements.linearAddressSpaceBytes,
      syscallHandler: harness.runtime.syscallHandler,
    });
    const result = process.runCpuSlice(10_000_000, 100_000);
    expect(result.state).toEqual({ kind: "completed", value: 42 });

    expect(() =>
      compileCs486Source(
        "c",
        "int __cs_syscall(int selector, int a0, int a1, int a2){return 0;}\nint main(){return 0;}\n",
      ),
    ).toThrow("compiler-owned intrinsic");
    expect(() =>
      compileCs486Source("c", 'int main(){asm("syscall cs"); return 0;}\n'),
    ).toThrow("unsafe inline assembly instruction");
  });

  it("runs the guest-built libc across environment, heap, streams, and files", (): void => {
    const files = new Map(
      linuxFilesystemImage.files.map((file) => [file.path, file.contents]),
    );
    const options = {
      include: (request: {
        readonly path: string;
      }):
        | { readonly source: string; readonly sourceName: string }
        | undefined => {
        const sourceName = `/usr/include/${request.path}`;
        const source = files.get(sourceName);
        return source === undefined ? undefined : { source, sourceName };
      },
    };
    const libc = compileCs486Object(
      "c",
      files.get("/usr/src/cs-libc/libc.c")!,
      { ...options, sourceName: "/usr/src/cs-libc/libc.c" },
    );
    const application = compileCs486Object(
      "c",
      [
        "#include <stdlib.h>",
        "#include <string.h>",
        "#include <stdio.h>",
        "#include <errno.h>",
        "#include <limits.h>",
        "#include <stdarg.h>",
        "#include <cs/fs.h>",
        "int va_sum(int first, ...){va_list list; va_list copy; va_start(list, first); va_copy(copy, list); int result = first + va_arg(copy, int) + va_arg(copy, int); va_end(list); va_end(copy); return result;}",
        "int main(int argc, char **argv){",
        'if(argc != 2 || strcmp(argv[1], "two words") != 0) return 10;',
        'char *home = getenv("HOME");',
        'if(home == (char *)0 || strcmp(home, "/home/cs") != 0) return 11;',
        "char *end = (char *)0;",
        "errno = 0;",
        'char *number = "  -0x2a!";',
        "if(strtol(number, &end, 0) != -42 || *end != 33 || errno != 0) return 30;",
        "errno = 0;",
        'if(strtol("2147483648", &end, 10) != LONG_MAX || errno != ERANGE || *end != 0) return 31;',
        "errno = 0;",
        'char *invalid = "xyz";',
        "if(strtol(invalid, &end, 10) != 0 || end != invalid || errno != 0) return 32;",
        "errno = 0;",
        'if(strtol("10", &end, 1) != 0 || errno != EINVAL) return 33;',
        "errno = 0;",
        'if(strtol("077", &end, 0) != 63 || *end != 0 || errno != 0) return 34;',
        'if(strtol("z", &end, 36) != 35 || *end != 0) return 35;',
        'char *sample = "alpha-beta-alpha";',
        "if(strlen(sample) != 16 || strnlen(sample, 5) != 5) return 36;",
        'if(strncmp(sample, "alpha!", 5) != 0) return 37;',
        "if(strchr(sample, 45) != sample + 5 || strrchr(sample, 97) != sample + 15) return 38;",
        'if(strstr(sample, "beta") != sample + 6 || strstr(sample, "absent") != (char *)0) return 39;',
        "int numbers[3]; numbers[0] = 10; numbers[1] = 20; numbers[2] = 30;",
        "if(memchr(numbers, 20, 3) != numbers + 1) return 40;",
        "errno = 0; memset(numbers, 99, 65537);",
        "if(errno != EINVAL || numbers[0] != 10 || numbers[2] != 30) return 46;",
        "errno = 0; if(fwrite(numbers, 1, 4097, stdout) != 0 || errno != EINVAL || !ferror(stdout)) return 47; clearerr(stdout);",
        "errno = 0; if(fread(numbers, 1, 1, (FILE *)0) != 0 || errno != EBADF) return 48;",
        'if(atoi("-123") != -123 || abs(-7) != 7 || labs(-8) != 8) return 41;',
        "if(va_sum(10, 20, 12) != 42) return 49;",
        "char formatted[8];",
        'if(snprintf(formatted, 8, "%d:%c:%s:%%", -42, 65, "xy") != 10) return 50;',
        'if(strcmp(formatted, "-42:A:x") != 0) return 51;',
        'if(snprintf((char *)0, 0, "%d", 42) != 2) return 52;',
        "formatted[0] = 90; errno = 0;",
        'if(snprintf(formatted, 8, "%x", 1) != -1 || errno != EINVAL || formatted[0] != 90) return 53;',
        'if(printf("guest:%d:%c:%s:%%\\n", -42, 65, "ok") != 17) return 54;',
        "void *first = malloc(4);",
        "void *second = malloc(4);",
        "void *third = malloc(4);",
        "if(first == (void *)0 || second == (void *)0 || third == (void *)0) return 12;",
        "free(second); free(first);",
        "void *joined = malloc(8);",
        "if(joined != first) return 13;",
        "void *grown = realloc(third, 8);",
        "if(grown == (void *)0) return 14;",
        "free(joined); free(grown);",
        'FILE *scratch = fopen("/scratch", "w+");',
        "if(scratch == (FILE *)0) return 42;",
        'if(fputs("xy", scratch) != 2) return 43;',
        'if(fprintf(scratch, "%d:%s", -7, "ok") != 5) return 55;',
        "rewind(scratch); char readback[8];",
        'if(fread(readback, 1, 7, scratch) != 7) return 44; readback[7] = 0; if(strcmp(readback, "xy-7:ok") != 0) return 56;',
        'if(fclose(scratch) != 0 || remove("/scratch") != 0) return 45;',
        'FILE *save = fopen("/save.tmp", "w");',
        "if(save == (FILE *)0) return 15;",
        'if(fputs("CSNH", save) != 4 || fclose(save) != 0) return 16;',
        'if(rename("/save.tmp", "/save") != 0) return 17;',
        'fputs("out", stdout); if(fflush(stdout) != 0) return 57;',
        'fputs("err", stderr);',
        "return 0;",
        "}",
      ].join("\n"),
      { ...options, sourceName: "/tmp/libc-demo.c" },
    );
    const executable = linkCs486Objects([application, libc], { entry: "main" });
    const startup = prepareCsAbiStartup(
      executable,
      {
        argv: ["/tmp/libc-demo", "two words"],
        cwd: "/home/cs",
        environment: [["HOME", "/home/cs"]],
      },
      initialUserCredentials,
    );
    const requirements = cs486ExecutableMemoryRequirements(executable);
    if (requirements.kind !== "declared")
      throw new Error("hosted executable must declare memory");
    const filesystem = unrestrictedGuestFilesystem(new InMemoryFilesystem());
    filesystem.writeFile("/save", "previous");
    const terminal = new TerminalBuffer(80, 25);
    const runtime = new CsAbiRuntime({
      computerId: "c-libc",
      credentials: initialUserCredentials,
      currentTick: (): number => 77,
      currentWallTimeMilliseconds: (): number => Date.UTC(2026, 6, 20),
      cwd: "/home/cs",
      filesystem,
      heapBaseBytes: startup.heapBaseBytes,
      heapWords: startup.heapWords,
      runHostWork: (_lane, _units, action): boolean => {
        action();
        return true;
      },
      startupAddress: startup.startupAddress,
      terminal,
    });
    const process = new Cs486Process(executable, {
      memoryBytes: requirements.linearAddressSpaceBytes,
      syscallHandler: runtime.syscallHandler,
    });
    process.initializeProcessImage(startup.image);
    const result = process.runCpuSlice(100_000_000, 1_000_000);
    expect(result.state).toEqual({ kind: "completed", value: 0 });
    expect(filesystem.readFile("/save")).toBe("CSNH");
    expect(filesystem.exists("/save.tmp")).toBe(false);
    const terminalBeforeFinalize = Array.from({ length: 25 }, (_, row) =>
      terminal.line(row + 1),
    ).join("\n");
    expect(terminalBeforeFinalize).toContain("guest:-42:A:ok:%");
    expect(terminalBeforeFinalize).toContain("outerr");
    runtime.finalize();
    expect(
      Array.from({ length: 25 }, (_, row) => terminal.line(row + 1)).join("\n"),
    ).toContain("outerr");
  });

  it("terminates explicitly when va_arg reads beyond the actual frame", (): void => {
    const files = new Map(
      linuxFilesystemImage.files.map((file) => [file.path, file.contents]),
    );
    const include = (request: {
      readonly path: string;
    }):
      { readonly source: string; readonly sourceName: string } | undefined => {
      const sourceName = `/usr/include/${request.path}`;
      const source = files.get(sourceName);
      return source === undefined ? undefined : { source, sourceName };
    };
    const libc = compileCs486Object(
      "c",
      files.get("/usr/src/cs-libc/libc.c")!,
      { include, sourceName: "/usr/src/cs-libc/libc.c" },
    );
    const application = compileCs486Object(
      "c",
      [
        "#include <stdarg.h>",
        "int overread(int first, ...){",
        "  va_list list; va_start(list, first);",
        "  int provided = va_arg(list, int);",
        "  int missing = va_arg(list, int);",
        "  return first + provided + missing;",
        "}",
        "int main(void){return overread(1, 2);}",
      ].join("\n"),
      { include, sourceName: "/tmp/va-overread.c" },
    );
    const executable = linkCs486Objects([application, libc], { entry: "main" });
    const startup = prepareCsAbiStartup(
      executable,
      { argv: ["/tmp/va-overread"], cwd: "/", environment: [] },
      initialUserCredentials,
    );
    const requirements = cs486ExecutableMemoryRequirements(executable);
    if (requirements.kind !== "declared")
      throw new Error("hosted executable must declare memory");
    const terminal = new TerminalBuffer(80, 25);
    const runtime = new CsAbiRuntime({
      computerId: "va-overread",
      credentials: initialUserCredentials,
      currentTick: (): number => 0,
      currentWallTimeMilliseconds: (): number => Date.UTC(2026, 6, 20),
      cwd: "/",
      filesystem: unrestrictedGuestFilesystem(new InMemoryFilesystem()),
      heapBaseBytes: startup.heapBaseBytes,
      heapWords: startup.heapWords,
      runHostWork: (_lane, _units, action): boolean => {
        action();
        return true;
      },
      startupAddress: startup.startupAddress,
      terminal,
    });
    const process = new Cs486Process(executable, {
      memoryBytes: requirements.linearAddressSpaceBytes,
      syscallHandler: runtime.syscallHandler,
    });
    process.initializeProcessImage(startup.image);

    expect(process.runCpuSlice(100_000_000, 1_000_000).state).toEqual({
      kind: "completed",
      value: 134,
    });
    runtime.finalize();
  });

  it("builds an immutable word-string startup block and calls main(argc, argv)", (): void => {
    const executable = compileCs486Source(
      "c",
      "int main(int argc, char **argv){return argc;}\n",
    );
    const launch = {
      argv: ["/usr/bin/demo", "one", "two words"],
      cwd: "/home/cs",
      environment: [
        ["HOME", "/home/cs"],
        ["USER", "cs"],
      ] as const,
    };
    const prepared = prepareCsAbiStartup(
      executable,
      launch,
      initialUserCredentials,
    );
    launch.argv[1] = "mutated";
    const words = prepared.image.segments[0]!.words;
    expect(words.slice(0, 12)).toEqual([
      csAbiStartupMagic,
      1,
      3,
      prepared.startupAddress + 15 * 4,
      2,
      prepared.startupAddress + 19 * 4,
      expect.any(Number),
      expect.any(Number),
      1_000,
      1_000,
      prepared.heapBaseBytes,
      prepared.heapWords,
    ]);

    const requirements = cs486ExecutableMemoryRequirements(executable);
    expect(requirements.kind).toBe("declared");
    const process = new Cs486Process(executable, {
      memoryBytes:
        requirements.kind === "declared"
          ? requirements.linearAddressSpaceBytes
          : 65_536,
    });
    process.initializeProcessImage(prepared.image);
    const result = process.runCpuSlice(10_000_000, 100_000);
    expect(result.state).toEqual({ kind: "completed", value: 3 });
  });

  it("rejects a variadic main entry before constructing startup memory", (): void => {
    const executable = compileCs486Source(
      "c",
      "int main(int argc, ...){return argc;}\n",
    );
    expect(() =>
      prepareCsAbiStartup(
        executable,
        { argv: ["/tmp/demo"], cwd: "/", environment: [] },
        initialUserCredentials,
      ),
    ).toThrow("CS ABI entry must be main(void) or main(int, char **)");
  });

  it("validates process-image startup atomically before the first instruction", (): void => {
    const executable = compileCs486Source("c", "int main(){return 0;}\n");
    const prepared = prepareCsAbiStartup(
      executable,
      { argv: ["/tmp/demo"], cwd: "/", environment: [] },
      initialUserCredentials,
    );
    const requirements = cs486ExecutableMemoryRequirements(executable);
    if (requirements.kind !== "declared")
      throw new Error("declared memory required");
    const process = new Cs486Process(executable, {
      memoryBytes: requirements.linearAddressSpaceBytes,
    });
    expect(() =>
      process.initializeProcessImage({
        segments: [
          { address: prepared.startupAddress, words: [1, 2] },
          { address: prepared.startupAddress + 4, words: [3] },
        ],
        stackArguments: [],
      }),
    ).toThrow("overlap");
    process.initializeProcessImage(prepared.image);
    expect(() => process.initializeProcessImage(prepared.image)).toThrow(
      "no longer initializable",
    );
  });

  it("rejects startup count and per-string capacity plus one", (): void => {
    const executable = compileCs486Source("c", "int main(){return 0;}\n");
    const maximum = prepareCsAbiStartup(
      executable,
      {
        argv: Array.from(
          { length: csAbiLimits.arguments },
          (_, index) => `a${String(index)}`,
        ),
        cwd: "/",
        environment: Array.from(
          { length: csAbiLimits.environmentEntries },
          (_, index) => [`V${String(index)}`, "x"] as const,
        ),
      },
      initialUserCredentials,
    );
    expect(maximum.image.segments[0]!.words[2]).toBe(csAbiLimits.arguments);
    expect(maximum.image.segments[0]!.words[4]).toBe(
      csAbiLimits.environmentEntries,
    );
    expect(() =>
      prepareCsAbiStartup(
        executable,
        {
          argv: Array.from(
            { length: csAbiLimits.arguments + 1 },
            (_, index) => `a${String(index)}`,
          ),
          cwd: "/",
          environment: [],
        },
        initialUserCredentials,
      ),
    ).toThrow("argument count limit");
    expect(() =>
      prepareCsAbiStartup(
        executable,
        {
          argv: ["x".repeat(csAbiLimits.perStringWords)],
          cwd: "/",
          environment: [],
        },
        initialUserCredentials,
      ),
    ).toThrow("word-string limit");
    expect(() =>
      prepareCsAbiStartup(
        executable,
        {
          argv: ["/tmp/demo"],
          cwd: "/",
          environment: Array.from(
            { length: csAbiLimits.environmentEntries + 1 },
            (_, index) => [`V${String(index)}`, "x"] as const,
          ),
        },
        initialUserCredentials,
      ),
    ).toThrow("environment entry limit");
  });

  it("admits one terminal atom before decoding and validates before mutation", (): void => {
    const harness = createHarness();
    harness.context.writeRegister("ebx", csAbiSelectors.termPresent);
    harness.context.writeRegister("ecx", 0);
    harness.context.writeRegister("edx", 2 | (1 << 16));
    harness.context.writeRegister("esi", 0);
    harness.memory[0] = "A".codePointAt(0)! | (2 << 16) | (3 << 20);
    harness.memory[1] = "B".codePointAt(0)! | (4 << 16) | (5 << 20);

    harness.defer = true;
    expect(harness.runtime.syscallHandler("cs", harness.context)).toEqual({
      kind: "continue",
    });
    expect(harness.context.readRegister("eax")).toBe(-csAbiErrno.eagain);
    expect(harness.terminal.line(1).slice(0, 2)).toBe("  ");
    expect(harness.context.readInt32Count).toBe(0);
    expect(harness.work).toEqual([]);

    harness.defer = false;
    harness.runtime.syscallHandler("cs", harness.context);
    expect(harness.context.readRegister("eax")).toBe(0);
    expect(harness.terminal.line(1).slice(0, 2)).toBe("AB");
    expect(harness.context.readInt32Count).toBe(2);
    expect(harness.work).toEqual(["terminal"]);

    harness.memory[1] = 10;
    harness.runtime.syscallHandler("cs", harness.context);
    expect(harness.context.readRegister("eax")).toBe(-csAbiErrno.einval);
    expect(harness.terminal.line(1).slice(0, 2)).toBe("AB");
    expect(harness.context.readInt32Count).toBe(4);
    expect(harness.work).toEqual(["terminal", "terminal"]);
  });

  it("owns a bounded key FIFO for poll and wait-event resume", (): void => {
    const harness = createHarness();
    expect(harness.runtime.enqueueKeyBatch('["h","ArrowUp","Enter"]')).toBe(3);
    harness.context.writeRegister("ebx", csAbiSelectors.keyPoll);
    harness.runtime.syscallHandler("cs", harness.context);
    expect(harness.context.readRegister("eax")).toBe("h".codePointAt(0));

    harness.context.writeRegister("ebx", csAbiSelectors.keyWait);
    harness.runtime.syscallHandler("cs", harness.context);
    expect(harness.context.readRegister("eax")).toBe(0x104);
    harness.runtime.syscallHandler("cs", harness.context);
    expect(harness.context.readRegister("eax")).toBe(13);
    const waiting = harness.runtime.syscallHandler("cs", harness.context);
    expect(waiting).toMatchObject({
      filter: "terminal_keys",
      kind: "wait_event",
    });
    expect(harness.runtime.enqueueKeyBatch('["x"]')).toBe(1);
    if (waiting.kind !== "wait_event") throw new Error("expected key wait");
    waiting.resume?.(null);
    expect(harness.context.readRegister("eax")).toBe("x".codePointAt(0));

    expect(
      harness.runtime.enqueueKeyBatch(
        JSON.stringify(Array<string>(32).fill("a")),
      ),
    ).toBe(32);
    expect(
      harness.runtime.enqueueKeyBatch(
        JSON.stringify(Array<string>(32).fill("b")),
      ),
    ).toBe(32);
    expect(harness.runtime.enqueueKeyBatch('["overflow"]')).toBeUndefined();
  });

  it("blocks standard input without CPU retry and validates descriptor limits", (): void => {
    const harness = createHarness();
    harness.context.writeRegister("ebx", csAbiSelectors.fsRead);
    harness.context.writeRegister("ecx", 0);
    harness.context.writeRegister("edx", 256);
    harness.context.writeRegister("esi", 2);
    const waiting = harness.runtime.syscallHandler("cs", harness.context);
    expect(waiting).toMatchObject({
      filter: "terminal_keys",
      kind: "wait_event",
    });
    expect(harness.runtime.enqueueKeyBatch('["a","Enter"]')).toBe(2);
    if (waiting.kind !== "wait_event") throw new Error("expected stdin wait");
    waiting.resume?.(null);
    expect(harness.context.readRegister("eax")).toBe(2);
    expect([...harness.memory.slice(64, 66)]).toEqual([97, 13]);

    for (let index = 0; index < csAbiLimits.fileDescriptors; index += 1) {
      writeWordString(harness.memory, 0, `/file-${String(index)}`);
      harness.context.writeRegister("ebx", csAbiSelectors.fsOpen);
      harness.context.writeRegister("ecx", 0);
      harness.context.writeRegister("edx", 2 | 4);
      harness.context.writeRegister("esi", 0o600);
      harness.runtime.syscallHandler("cs", harness.context);
      expect(harness.context.readRegister("eax")).toBe(3 + index);
    }
    writeWordString(harness.memory, 0, "/one-too-many");
    harness.context.writeRegister("ebx", csAbiSelectors.fsOpen);
    harness.runtime.syscallHandler("cs", harness.context);
    expect(harness.context.readRegister("eax")).toBe(-csAbiErrno.emfile);

    harness.context.writeRegister("ebx", csAbiSelectors.fsClose);
    harness.context.writeRegister("ecx", 1);
    harness.runtime.syscallHandler("cs", harness.context);
    expect(harness.context.readRegister("eax")).toBe(-csAbiErrno.ebadf);
  });

  it("routes redirected word32 standard input and ordered fd 1/2 output without terminal leakage", (): void => {
    const events: Array<{ descriptor: 1 | 2; text: string }> = [];
    const harness = createHarness({
      outputObserver: (descriptor, text): void => {
        events.push({ descriptor, text });
      },
      standardInput: "A🙂",
    });
    harness.context.writeRegister("ebx", csAbiSelectors.fsRead);
    harness.context.writeRegister("ecx", 0);
    harness.context.writeRegister("edx", 256);
    harness.context.writeRegister("esi", 2);
    harness.runtime.syscallHandler("cs", harness.context);
    expect(harness.context.readRegister("eax")).toBe(2);
    expect([...harness.memory.slice(64, 66)]).toEqual([
      "A".codePointAt(0),
      "🙂".codePointAt(0),
    ]);
    harness.runtime.syscallHandler("cs", harness.context);
    expect(harness.context.readRegister("eax")).toBe(0);

    writeWords(harness.memory, 64, [79, 85, 84, 10]);
    harness.context.writeRegister("ebx", csAbiSelectors.fsWrite);
    harness.context.writeRegister("ecx", 1);
    harness.context.writeRegister("edx", 256);
    harness.context.writeRegister("esi", 4);
    harness.runtime.syscallHandler("cs", harness.context);
    writeWords(harness.memory, 64, [69, 82, 82]);
    harness.context.writeRegister("ecx", 2);
    harness.context.writeRegister("esi", 3);
    harness.runtime.syscallHandler("cs", harness.context);

    expect(events).toEqual([
      { descriptor: 1, text: "OUT\n" },
      { descriptor: 2, text: "ERR" },
    ]);
    expect(harness.terminal.line(1).trim()).toBe("");
  });

  it("blocks, resumes, reports partial writes and EOF, and surfaces EPIPE on standard endpoints", (): void => {
    let readAttempts = 0;
    const writes: number[][] = [];
    let writeMode: "block" | "partial" | "broken" = "block";
    const standardIo: CsAbiStandardIo = {
      inputReady: (): boolean => readAttempts > 0,
      outputReady: (): boolean => writeMode !== "block",
      read: () => {
        readAttempts += 1;
        if (readAttempts === 1) return { kind: "would-block" };
        if (readAttempts === 2) return { kind: "data", units: [65] };
        return { kind: "eof" };
      },
      write: (_descriptor, _dataModel, units) => {
        writes.push([...units]);
        if (writeMode === "block") return { kind: "would-block" };
        if (writeMode === "broken") return { kind: "broken-pipe" };
        return { kind: "written", unitsWritten: 2 };
      },
    };
    const harness = createHarness({ standardIo });
    harness.context.writeRegister("ebx", csAbiSelectors.fsRead);
    harness.context.writeRegister("ecx", 0);
    harness.context.writeRegister("edx", 256);
    harness.context.writeRegister("esi", 4);
    const blockedRead = harness.runtime.syscallHandler("cs", harness.context);
    expect(blockedRead).toMatchObject({
      filter: "csabi_fd0",
      kind: "wait_event",
    });
    if (blockedRead.kind !== "wait_event") throw new Error("expected fd0 wait");
    blockedRead.resume?.(null);
    expect(harness.context.readRegister("eax")).toBe(1);
    expect(harness.memory[64]).toBe(65);
    harness.runtime.syscallHandler("cs", harness.context);
    expect(harness.context.readRegister("eax")).toBe(0);

    writeWords(harness.memory, 64, [65, 66, 67, 68]);
    harness.context.writeRegister("ebx", csAbiSelectors.fsWrite);
    harness.context.writeRegister("ecx", 1);
    harness.context.writeRegister("edx", 256);
    harness.context.writeRegister("esi", 4);
    const blockedWrite = harness.runtime.syscallHandler("cs", harness.context);
    expect(blockedWrite).toMatchObject({
      filter: "csabi_fd1",
      kind: "wait_event",
    });
    if (blockedWrite.kind !== "wait_event")
      throw new Error("expected fd1 wait");
    writeMode = "partial";
    blockedWrite.resume?.(null);
    expect(harness.context.readRegister("eax")).toBe(2);
    expect(writes).toEqual([
      [65, 66, 67, 68],
      [65, 66, 67, 68],
    ]);

    writeMode = "broken";
    harness.runtime.syscallHandler("cs", harness.context);
    expect(harness.context.readRegister("eax")).toBe(-csAbiErrno.epipe);
  });

  it("returns exact errno for selector, count, pointer, and word-string boundaries", (): void => {
    const harness = createHarness();
    expect(harness.runtime.syscallHandler("host", harness.context)).toEqual({
      kind: "continue",
    });
    expect(harness.context.readRegister("eax")).toBe(-csAbiErrno.eperm);

    harness.context.writeRegister("ebx", 999);
    harness.runtime.syscallHandler("cs", harness.context);
    expect(harness.context.readRegister("eax")).toBe(-csAbiErrno.einval);

    harness.context.writeRegister("ebx", csAbiSelectors.sleepTicks);
    harness.context.writeRegister("ecx", 1_000_001);
    harness.runtime.syscallHandler("cs", harness.context);
    expect(harness.context.readRegister("eax")).toBe(-csAbiErrno.einval);
    harness.context.writeRegister("ecx", 1_000_000);
    expect(harness.runtime.syscallHandler("cs", harness.context)).toMatchObject(
      {
        kind: "sleep",
        ticks: 1_000_000,
      },
    );

    harness.context.writeRegister("ebx", csAbiSelectors.fsRead);
    harness.context.writeRegister("ecx", 0);
    harness.context.writeRegister("edx", 0);
    harness.context.writeRegister("esi", csAbiLimits.ioWords + 1);
    harness.runtime.syscallHandler("cs", harness.context);
    expect(harness.context.readRegister("eax")).toBe(-csAbiErrno.einval);
    harness.context.writeRegister("edx", 2);
    harness.context.writeRegister("esi", 1);
    harness.runtime.syscallHandler("cs", harness.context);
    expect(harness.context.readRegister("eax")).toBe(-csAbiErrno.efault);

    harness.memory[0] = 0xd8_00;
    harness.context.writeRegister("ebx", csAbiSelectors.fsOpen);
    harness.context.writeRegister("ecx", 0);
    harness.context.writeRegister("edx", 1);
    harness.context.writeRegister("esi", 0);
    harness.runtime.syscallHandler("cs", harness.context);
    expect(harness.context.readRegister("eax")).toBe(-csAbiErrno.einval);

    harness.runtime.finalize();
    harness.context.writeRegister("ebx", csAbiSelectors.clockTicks);
    harness.runtime.syscallHandler("cs", harness.context);
    expect(harness.context.readRegister("eax")).toBe(-csAbiErrno.eio);
  });

  it("round-trips word-stream files and atomically replaces a destination", (): void => {
    const harness = createHarness();
    writeWordString(harness.memory, 0, "/save.tmp");
    harness.context.writeRegister("ebx", csAbiSelectors.fsOpen);
    harness.context.writeRegister("ecx", 0);
    harness.context.writeRegister("edx", 2 | 4 | 8);
    harness.context.writeRegister("esi", 0o600);
    harness.runtime.syscallHandler("cs", harness.context);
    const descriptor = harness.context.readRegister("eax");
    expect(descriptor).toBe(3);

    writeWords(harness.memory, 128, [67, 83, 78, 72]);
    harness.context.writeRegister("ebx", csAbiSelectors.fsWrite);
    harness.context.writeRegister("ecx", descriptor);
    harness.context.writeRegister("edx", 128 * 4);
    harness.context.writeRegister("esi", 4);
    harness.runtime.syscallHandler("cs", harness.context);
    expect(harness.filesystem.readFile("/save.tmp")).toBe("CSNH");

    harness.filesystem.writeFile("/save", "previous");
    writeWordString(harness.memory, 32, "/save.tmp");
    writeWordString(harness.memory, 64, "/save");
    harness.context.writeRegister("ebx", csAbiSelectors.fsRename);
    harness.context.writeRegister("ecx", 32 * 4);
    harness.context.writeRegister("edx", 64 * 4);
    harness.defer = true;
    harness.runtime.syscallHandler("cs", harness.context);
    expect(harness.context.readRegister("eax")).toBe(-csAbiErrno.eagain);
    expect(harness.filesystem.readFile("/save")).toBe("previous");
    expect(harness.filesystem.readFile("/save.tmp")).toBe("CSNH");

    harness.defer = false;
    harness.runtime.syscallHandler("cs", harness.context);
    expect(harness.context.readRegister("eax")).toBe(0);
    expect(harness.filesystem.readFile("/save")).toBe("CSNH");
    expect(harness.filesystem.exists("/save.tmp")).toBe(false);
  });

  it("preserves file contents across deferred open and rejected whole-buffer write", (): void => {
    const harness = createHarness();
    harness.filesystem.writeFile("/keep", "previous");
    writeWordString(harness.memory, 0, "/keep");
    harness.context.writeRegister("ebx", csAbiSelectors.fsOpen);
    harness.context.writeRegister("ecx", 0);
    harness.context.writeRegister("edx", 2 | 8);
    harness.context.writeRegister("esi", 0o600);
    harness.defer = true;
    harness.runtime.syscallHandler("cs", harness.context);
    expect(harness.context.readRegister("eax")).toBe(-csAbiErrno.eagain);
    expect(harness.filesystem.readFile("/keep")).toBe("previous");

    harness.defer = false;
    harness.runtime.syscallHandler("cs", harness.context);
    const descriptor = harness.context.readRegister("eax");
    expect(descriptor).toBe(3);
    expect(harness.filesystem.readFile("/keep")).toBe("");

    writeWords(harness.memory, 128, [65, 0xd8_00]);
    harness.context.writeRegister("ebx", csAbiSelectors.fsWrite);
    harness.context.writeRegister("ecx", descriptor);
    harness.context.writeRegister("edx", 128 * 4);
    harness.context.writeRegister("esi", 2);
    harness.runtime.syscallHandler("cs", harness.context);
    expect(harness.context.readRegister("eax")).toBe(-csAbiErrno.einval);
    expect(harness.filesystem.readFile("/keep")).toBe("");

    harness.memory[128] = 66;
    harness.context.writeRegister("esi", 1);
    harness.defer = true;
    harness.runtime.syscallHandler("cs", harness.context);
    expect(harness.context.readRegister("eax")).toBe(-csAbiErrno.eagain);
    expect(harness.filesystem.readFile("/keep")).toBe("");
    harness.defer = false;
    harness.runtime.syscallHandler("cs", harness.context);
    expect(harness.context.readRegister("eax")).toBe(1);
    expect(harness.filesystem.readFile("/keep")).toBe("B");
  });

  it("admits seek and stat as block I/O before changing observable state", (): void => {
    const harness = createHarness();
    harness.filesystem.writeFile("/sample", "abc");
    writeWordString(harness.memory, 0, "/sample");
    harness.context.writeRegister("ebx", csAbiSelectors.fsOpen);
    harness.context.writeRegister("ecx", 0);
    harness.context.writeRegister("edx", 1);
    harness.context.writeRegister("esi", 0);
    harness.runtime.syscallHandler("cs", harness.context);
    const descriptor = harness.context.readRegister("eax");
    expect(descriptor).toBe(3);

    harness.context.writeRegister("ebx", csAbiSelectors.fsSeek);
    harness.context.writeRegister("ecx", descriptor);
    harness.context.writeRegister("edx", 2);
    harness.context.writeRegister("esi", 0);
    harness.defer = true;
    harness.runtime.syscallHandler("cs", harness.context);
    expect(harness.context.readRegister("eax")).toBe(-csAbiErrno.eagain);

    harness.defer = false;
    harness.context.writeRegister("edx", 0);
    harness.context.writeRegister("esi", 1);
    harness.runtime.syscallHandler("cs", harness.context);
    expect(harness.context.readRegister("eax")).toBe(0);

    harness.memory.set([91, 92, 93, 94], 64);
    harness.context.writeRegister("ebx", csAbiSelectors.fsStat);
    harness.context.writeRegister("ecx", 0);
    harness.context.writeRegister("edx", 64 * 4);
    harness.defer = true;
    harness.runtime.syscallHandler("cs", harness.context);
    expect(harness.context.readRegister("eax")).toBe(-csAbiErrno.eagain);
    expect([...harness.memory.slice(64, 68)]).toEqual([91, 92, 93, 94]);

    harness.defer = false;
    harness.runtime.syscallHandler("cs", harness.context);
    expect(harness.context.readRegister("eax")).toBe(0);
    expect([...harness.memory.slice(64, 67)]).toEqual([1, 3, 0o644]);
    expect(harness.work.filter((lane) => lane === "block_io")).toHaveLength(3);
  });

  it("flushes stdout only after terminal admission and bounds lifetime output", (): void => {
    const harness = createHarness();
    writeWords(harness.memory, 0, [111, 117, 116]);
    harness.context.writeRegister("ebx", csAbiSelectors.fsWrite);
    harness.context.writeRegister("ecx", 1);
    harness.context.writeRegister("edx", 0);
    harness.context.writeRegister("esi", 3);
    harness.runtime.syscallHandler("cs", harness.context);
    expect(harness.terminal.line(1)).not.toContain("out");

    harness.context.writeRegister("esi", 0);
    harness.defer = true;
    harness.runtime.syscallHandler("cs", harness.context);
    expect(harness.context.readRegister("eax")).toBe(-csAbiErrno.eagain);
    expect(harness.terminal.line(1)).not.toContain("out");

    harness.defer = false;
    harness.runtime.syscallHandler("cs", harness.context);
    expect(harness.context.readRegister("eax")).toBe(0);
    expect(harness.terminal.line(1)).toContain("out");

    harness.memory.fill(65, 0, csAbiLimits.ioWords);
    harness.context.writeRegister("ecx", 2);
    harness.context.writeRegister("esi", csAbiLimits.ioWords);
    for (let index = 0; index < 15; index += 1) {
      harness.runtime.syscallHandler("cs", harness.context);
      expect(harness.context.readRegister("eax")).toBe(csAbiLimits.ioWords);
    }
    const terminalAdmissions = harness.work.filter(
      (lane) => lane === "terminal",
    ).length;
    harness.runtime.syscallHandler("cs", harness.context);
    expect(harness.context.readRegister("eax")).toBe(-csAbiErrno.enospc);
    expect(harness.work.filter((lane) => lane === "terminal")).toHaveLength(
      terminalAdmissions,
    );

    harness.runtime.finalize();
    harness.runtime.finalize();
  });

  it("provides bounded cwd, directory snapshots, extended stat, time, and exclusive create", (): void => {
    const harness = createHarness();
    harness.context.writeRegister("ebx", csAbiSelectors.wallTime);
    harness.runtime.syscallHandler("cs", harness.context);
    expect(harness.context.readRegister("eax")).toBe(
      Math.floor(Date.UTC(2026, 6, 20) / 1_000),
    );

    writeWordString(harness.memory, 0, "/work");
    harness.context.writeRegister("ebx", csAbiSelectors.fsMkdir);
    harness.context.writeRegister("ecx", 0);
    harness.context.writeRegister("edx", 0o700);
    harness.runtime.syscallHandler("cs", harness.context);
    expect(harness.context.readRegister("eax")).toBe(0);

    harness.context.writeRegister("ebx", csAbiSelectors.fsChdir);
    harness.context.writeRegister("ecx", 0);
    harness.defer = true;
    harness.runtime.syscallHandler("cs", harness.context);
    expect(harness.context.readRegister("eax")).toBe(-csAbiErrno.eagain);
    harness.defer = false;
    harness.runtime.syscallHandler("cs", harness.context);
    expect(harness.context.readRegister("eax")).toBe(0);

    harness.context.writeRegister("ebx", csAbiSelectors.fsGetcwd);
    harness.context.writeRegister("ecx", 64 * 4);
    harness.context.writeRegister("edx", 16);
    harness.runtime.syscallHandler("cs", harness.context);
    expect(readWordStringFromMemory(harness.memory, 64)).toBe("/work");

    writeWordString(harness.memory, 0, ".");
    harness.context.writeRegister("ebx", csAbiSelectors.fsAccess);
    harness.context.writeRegister("ecx", 0);
    harness.context.writeRegister("edx", 1);
    harness.runtime.syscallHandler("cs", harness.context);
    expect(harness.context.readRegister("eax")).toBe(0);

    harness.filesystem.writeFile("/work/a", "alpha");
    writeWordString(harness.memory, 0, "/work");
    harness.context.writeRegister("ebx", csAbiSelectors.fsOpenDir);
    harness.context.writeRegister("ecx", 0);
    harness.runtime.syscallHandler("cs", harness.context);
    const directory = harness.context.readRegister("eax");
    expect(directory).toBe(1);
    harness.filesystem.writeFile("/work/b", "beta");
    harness.context.writeRegister("ebx", csAbiSelectors.fsReadDir);
    harness.context.writeRegister("ecx", directory);
    harness.context.writeRegister("edx", 96 * 4);
    harness.context.writeRegister("esi", 16);
    harness.runtime.syscallHandler("cs", harness.context);
    expect(harness.context.readRegister("eax")).toBe(-csAbiErrno.eagain);

    harness.context.writeRegister("ebx", csAbiSelectors.fsCloseDir);
    harness.context.writeRegister("ecx", directory);
    harness.runtime.syscallHandler("cs", harness.context);
    expect(harness.context.readRegister("eax")).toBe(0);
    harness.context.writeRegister("ebx", csAbiSelectors.fsOpenDir);
    harness.context.writeRegister("ecx", 0);
    harness.runtime.syscallHandler("cs", harness.context);
    const reopened = harness.context.readRegister("eax");
    const names: string[] = [];
    for (;;) {
      harness.context.writeRegister("ebx", csAbiSelectors.fsReadDir);
      harness.context.writeRegister("ecx", reopened);
      harness.context.writeRegister("edx", 96 * 4);
      harness.context.writeRegister("esi", 16);
      harness.runtime.syscallHandler("cs", harness.context);
      if (harness.context.readRegister("eax") === 0) break;
      names.push(readWordStringFromMemory(harness.memory, 96));
    }
    expect(names).toEqual(["a", "b"]);

    writeWordString(harness.memory, 0, "/work/a");
    harness.context.writeRegister("ebx", csAbiSelectors.fsStatExtended);
    harness.context.writeRegister("ecx", 0);
    harness.context.writeRegister("edx", 128 * 4);
    harness.runtime.syscallHandler("cs", harness.context);
    expect([...harness.memory.slice(128, 135)]).toEqual([
      1,
      5,
      0o644,
      expect.any(Number),
      1_000,
      1_000,
      1,
    ]);

    harness.context.writeRegister("ebx", csAbiSelectors.fsOpen);
    harness.context.writeRegister("ecx", 0);
    harness.context.writeRegister("edx", 2 | 4 | 32);
    harness.context.writeRegister("esi", 0o600);
    harness.runtime.syscallHandler("cs", harness.context);
    expect(harness.context.readRegister("eax")).toBe(-csAbiErrno.eexist);
    expect(harness.filesystem.readFile("/work/a")).toBe("alpha");
  });

  it("rejects directory descriptor and snapshot capacity plus one", (): void => {
    const harness = createHarness();
    harness.filesystem.makeDirectory("/directory");
    writeWordString(harness.memory, 0, "/directory");
    harness.context.writeRegister("ebx", csAbiSelectors.fsOpenDir);
    harness.context.writeRegister("ecx", 0);
    for (let index = 0; index < csAbiLimits.directoryDescriptors; index += 1) {
      harness.runtime.syscallHandler("cs", harness.context);
      expect(harness.context.readRegister("eax")).toBe(index + 1);
    }
    harness.runtime.syscallHandler("cs", harness.context);
    expect(harness.context.readRegister("eax")).toBe(-csAbiErrno.emfile);

    const oversized = createHarness();
    oversized.filesystem.makeDirectory("/many");
    for (let index = 0; index <= csAbiLimits.directoryEntries; index += 1) {
      oversized.filesystem.writeFile(`/many/e${String(index)}`, "");
    }
    writeWordString(oversized.memory, 0, "/many");
    oversized.context.writeRegister("ebx", csAbiSelectors.fsOpenDir);
    oversized.context.writeRegister("ecx", 0);
    oversized.runtime.syscallHandler("cs", oversized.context);
    expect(oversized.context.readRegister("eax")).toBe(-csAbiErrno.enospc);
  });
});

function createHarness(
  options: {
    readonly outputObserver?: (descriptor: 1 | 2, text: string) => void;
    readonly standardIo?: CsAbiStandardIo;
    readonly standardInput?: string;
  } = {},
): {
  context: TestSyscallContext;
  defer: boolean;
  filesystem: ReturnType<typeof unrestrictedGuestFilesystem>;
  memory: Int32Array;
  runtime: CsAbiRuntime;
  terminal: TerminalBuffer;
  work: string[];
} {
  const filesystem = unrestrictedGuestFilesystem(new InMemoryFilesystem());
  const terminal = new TerminalBuffer(80, 25);
  const context = new TestSyscallContext(65_536);
  const work: string[] = [];
  const harness = {
    context,
    defer: false,
    filesystem,
    memory: context.memory,
    runtime: undefined as unknown as CsAbiRuntime,
    terminal,
    work,
  };
  harness.runtime = new CsAbiRuntime({
    computerId: "c-test",
    credentials: initialUserCredentials,
    currentTick: (): number => 42,
    currentWallTimeMilliseconds: (): number => Date.UTC(2026, 6, 20),
    cwd: "/",
    filesystem,
    heapBaseBytes: 1_024,
    heapWords: 4_096,
    ...options,
    startupAddress: 512,
    runHostWork: (lane, _units, action): boolean => {
      if (harness.defer) return false;
      work.push(lane);
      action();
      return true;
    },
    terminal,
  });
  return harness;
}

class TestSyscallContext implements Cs486SyscallContext {
  readonly memory: Int32Array;
  readonly memoryLimitBytes: number;
  readInt32Count = 0;
  private readonly registers = new Map<Cs486Register, number>();

  constructor(memoryBytes: number) {
    this.memoryLimitBytes = memoryBytes;
    this.memory = new Int32Array(memoryBytes / 4);
  }

  readInt32(address: number): number {
    this.readInt32Count += 1;
    return this.memory[address / 4]!;
  }

  readRegister(register: Cs486Register): number {
    return this.registers.get(register) ?? 0;
  }

  writeInt32(address: number, value: number): void {
    this.memory[address / 4] = value;
  }

  writeRegister(register: Cs486Register, value: number): void {
    this.registers.set(register, value | 0);
  }
}

function writeWordString(
  memory: Int32Array,
  wordOffset: number,
  value: string,
): void {
  writeWords(
    memory,
    wordOffset,
    [...value].map((character) => character.codePointAt(0)!).concat(0),
  );
}

function writeWords(
  memory: Int32Array,
  wordOffset: number,
  values: readonly number[],
): void {
  memory.set(values, wordOffset);
}

function readWordStringFromMemory(
  memory: Int32Array,
  wordOffset: number,
): string {
  const words: number[] = [];
  for (let index = wordOffset; index < memory.length; index += 1) {
    const word = memory[index]!;
    if (word === 0) break;
    words.push(word);
  }
  return String.fromCodePoint(...words);
}
