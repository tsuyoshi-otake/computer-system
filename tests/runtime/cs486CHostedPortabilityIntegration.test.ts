import { describe, expect, it } from "vitest";

import { linuxFilesystemImage } from "../../src/application/os/osFilesystemImages.js";
import { compileCs486Object } from "../../src/application/toolchain/highLevelCompilers.js";
import { linkCs486Objects } from "../../src/application/toolchain/cs486Linker.js";
import {
  cs486ExecutableMemoryRequirements,
  runCs486,
} from "../../src/domain/cpu/cs486.js";

describe("CS C hosted portability integration", (): void => {
  it("links a deterministic multi-file library across the completed hosted ABI", (): void => {
    const files = new Map(
      linuxFilesystemImage.files.map((file) => [file.path, file.contents]),
    );
    const options = {
      include: ({
        path,
      }: {
        readonly path: string;
      }):
        | { readonly source: string; readonly sourceName: string }
        | undefined => {
        const sourceName = `/usr/include/${path}`;
        const source = files.get(sourceName);
        return source === undefined ? undefined : { source, sourceName };
      },
    };
    const librarySource = [
      "#include <stddef.h>",
      "#include <stdint.h>",
      "#include <stdio.h>",
      "typedef int (*comparison)(int, int);",
      "struct job { unsigned int ready : 1; unsigned int code : 7; uint64_t counter; comparison callback; };",
      "static unsigned int wrap_seed = 0xffffffffu;",
      "static int helper(int value) { return value + 1; }",
      "static int ascending(int left, int right) { return left - right; }",
      "static comparison callbacks[2] = { [0] = ascending, [1] = ascending };",
      "static int visits(void) { static int count = 0; count = count + 1; return count; }",
      "uint64_t advance(uint64_t value) { return value + 1ull; }",
      "extern int other(void);",
      "int library_run(char *buffer, size_t size) {",
      "  int result = 0;",
      "  int error = 0;",
      "  int formatted = 0;",
      "  struct job current = { .callback = callbacks[0], .counter = 0xffffffffull, .code = 5u, .ready = 1u };",
      "  if (wrap_seed + 1u != 0u) { error = 1; goto cleanup; }",
      "  if (!current.ready || current.code != 5u) { error = 2; goto cleanup; }",
      "  if (current.callback(1, 2) >= 0) { error = 3; goto cleanup; }",
      "  current.counter = advance(current.counter);",
      "  if (current.counter != 0x100000000ull) { error = 4; goto cleanup; }",
      "  result = helper(39) + visits() + other() - 2;",
      "cleanup:",
      "  if (error != 0) return error;",
      "  if (result != 42) return 10 + result;",
      '  formatted = snprintf(buffer, size, "%d", result);',
      "  if (formatted != 2) return 100 + formatted;",
      "  return result;",
      "}",
    ].join("\n");
    const companionSource = [
      "static int helper(int value) { return value + 2; }",
      "int other(void) { return helper(1); }",
    ].join("\n");
    const applicationSource = [
      "#include <stddef.h>",
      "int library_run(char *buffer, size_t size);",
      "int main(void) {",
      "  char buffer[8];",
      "  int value = library_run(buffer, 8u);",
      "  return buffer[0] == 52 && buffer[1] == 50 && buffer[2] == 0 ? value : 0;",
      "}",
    ].join("\n");
    const compile = (): ReturnType<typeof compileCs486Object>[] => [
      compileCs486Object("c", librarySource, {
        ...options,
        sourceName: "/usr/src/portable/library.c",
      }),
      compileCs486Object("c", companionSource, {
        ...options,
        sourceName: "/usr/src/portable/companion.c",
      }),
      compileCs486Object("c", applicationSource, {
        ...options,
        sourceName: "/usr/src/portable/main.c",
      }),
      compileCs486Object("c", files.get("/usr/src/cs-libc/libc.c")!, {
        ...options,
        sourceName: "/usr/src/cs-libc/libc.c",
      }),
    ];

    const objects = compile();
    const executable = linkCs486Objects(objects);
    const requirements = cs486ExecutableMemoryRequirements(executable);
    if (requirements.kind !== "declared")
      throw new Error("hosted C executable must declare memory");
    expect(
      runCs486(executable, {
        memoryBytes: requirements.linearAddressSpaceBytes,
      }).registers.eax,
    ).toBe(42);
    expect(compile()).toEqual(objects);
    expect(linkCs486Objects(compile())).toEqual(executable);
  });
});
