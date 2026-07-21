import { describe, expect, it } from "vitest";

import { linuxFilesystemImage } from "../../src/application/os/osFilesystemImages.js";
import { compileCs486Object } from "../../src/application/toolchain/highLevelCompilers.js";
import { linkCs486Objects } from "../../src/application/toolchain/cs486Linker.js";
import {
  cs486ExecutableMemoryRequirements,
  runCs486,
} from "../../src/domain/cpu/cs486.js";
import {
  cs486Byte8DataModel,
  cs486Word32DataModel,
} from "../../src/domain/cpu/cs486Compatibility.js";

describe("CS C hosted integer headers", (): void => {
  it("keeps limits, stdint, stddef, and stdbool consistent with the word ABI", (): void => {
    const files = new Map(
      linuxFilesystemImage.files.map((file) => [file.path, file.contents]),
    );
    const source = [
      "#include <stddef.h>",
      "#include <limits.h>",
      "#include <stdint.h>",
      "#include <stdbool.h>",
      '_Static_assert(CHAR_BIT == 32, "word chars");',
      '_Static_assert(UCHAR_MAX == UINT_MAX, "one-word unsigned char");',
      '_Static_assert(USHRT_MAX == UINT_MAX, "one-word unsigned short");',
      '_Static_assert(sizeof(size_t) == 1, "size word");',
      '_Static_assert(sizeof(int32_t) == 1, "int32 word");',
      '_Static_assert(sizeof(uint64_t) == 2, "uint64 pair");',
      '_Static_assert(INT64_MIN < 0ll, "signed minimum");',
      "int main(void) {",
      "  bool ready = true;",
      "  uint64_t maximum = UINT64_MAX;",
      "  int64_t minimum = INT64_MIN;",
      "  return (ready ? 20 : 0)",
      "    + (maximum == ULLONG_MAX ? 20 : 0)",
      "    + (minimum == LLONG_MIN && SIZE_MAX == UINT_MAX ? 2 : 0);",
      "}",
    ].join("\n");
    const object = compileCs486Object("c", source, {
      include: ({ path }) => {
        const sourceName = `/usr/include/${path}`;
        const included = files.get(sourceName);
        return included === undefined
          ? undefined
          : { source: included, sourceName };
      },
      sourceName: "/tmp/headers.c",
    });
    const executable = linkCs486Objects([object]);
    const requirements = cs486ExecutableMemoryRequirements(executable);
    if (requirements.kind !== "declared")
      throw new Error("hosted C executable must declare memory");
    expect(
      runCs486(executable, {
        memoryBytes: requirements.linearAddressSpaceBytes,
      }).registers.eax,
    ).toBe(42);
    expect(
      compileCs486Object("c", source, {
        include: ({ path }) => {
          const sourceName = `/usr/include/${path}`;
          const included = files.get(sourceName);
          return included === undefined
            ? undefined
            : { source: included, sourceName };
        },
        sourceName: "/tmp/headers.c",
      }),
    ).toEqual(object);
  });

  it("publishes exact byte-profile integer limits and direct byte storage", (): void => {
    const files = new Map(
      linuxFilesystemImage.files.map((file) => [file.path, file.contents]),
    );
    const source = [
      "#include <limits.h>",
      "#include <stdint.h>",
      "#include <cs/byte.h>",
      '_Static_assert(CHAR_BIT == 8, "byte chars");',
      '_Static_assert(sizeof(int8_t) == 1, "int8");',
      '_Static_assert(sizeof(uint16_t) == 2, "uint16");',
      '_Static_assert(sizeof(int32_t) == 4, "uint32");',
      '_Static_assert(INT_LEAST8_MIN == INT8_MIN, "least8");',
      '_Static_assert(UINT_FAST16_MAX == UINT32_MAX, "fast16");',
      "cs_byte_storage_t storage[5] = { 1, 2, 3, 4, 5 };",
      "int main(void) {",
      "  cs_byte_store(storage, 1, 255);",
      "  return (CS_BYTE_STORAGE_UNITS(5) == 5 ? 0 : 1000) + cs_byte_load(storage, 0) + cs_byte_load(storage, 1) + cs_byte_load(storage, 4);",
      "}",
    ].join("\n");
    const object = compileCs486Object("c", source, {
      dataModel: cs486Byte8DataModel,
      include: ({ path }) => {
        const sourceName = `/usr/include/${path}`;
        const included = files.get(sourceName);
        return included === undefined
          ? undefined
          : { source: included, sourceName };
      },
      sourceName: "/tmp/byte-headers.c",
    });
    const executable = linkCs486Objects([object]);
    const requirements = cs486ExecutableMemoryRequirements(executable);
    if (requirements.kind !== "declared")
      throw new Error("hosted byte executable must declare memory");

    expect(
      runCs486(executable, {
        memoryBytes: requirements.linearAddressSpaceBytes,
      }).registers.eax,
    ).toBe(261);
  });

  it("packs explicit octets into word-profile storage without changing char semantics", (): void => {
    const files = new Map(
      linuxFilesystemImage.files.map((file) => [file.path, file.contents]),
    );
    const source = [
      "#include <limits.h>",
      "#include <cs/byte.h>",
      '_Static_assert(CHAR_BIT == 32, "word chars");',
      "cs_byte_storage_t storage[2] = { 0, 0 };",
      "int main(void) {",
      "  cs_byte_store(storage, 0, 1);",
      "  cs_byte_store(storage, 3, 254);",
      "  cs_byte_store(storage, 4, 255);",
      "  return (CS_BYTE_STORAGE_UNITS(5) == 2 ? 0 : 1000) + cs_byte_load(storage, 0) + cs_byte_load(storage, 3) + cs_byte_load(storage, 4);",
      "}",
    ].join("\n");
    const object = compileCs486Object("c", source, {
      dataModel: cs486Word32DataModel,
      include: ({ path }) => {
        const sourceName = `/usr/include/${path}`;
        const included = files.get(sourceName);
        return included === undefined
          ? undefined
          : { source: included, sourceName };
      },
      sourceName: "/tmp/packed-word-bytes.c",
    });
    const executable = linkCs486Objects([object]);
    const requirements = cs486ExecutableMemoryRequirements(executable);
    if (requirements.kind !== "declared")
      throw new Error("hosted word executable must declare memory");

    expect(
      runCs486(executable, {
        memoryBytes: requirements.linearAddressSpaceBytes,
      }).registers.eax,
    ).toBe(510);
  });
});
