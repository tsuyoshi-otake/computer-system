import { describe, expect, it } from "vitest";

import { linuxFilesystemImage } from "../../src/application/os/osFilesystemImages.js";
import { compileCs486Source } from "../../src/application/toolchain/highLevelCompilers.js";
import {
  cs486ExecutableMemoryRequirements,
  runCs486,
} from "../../src/domain/cpu/cs486.js";
import { cs486Byte8DataModel } from "../../src/domain/cpu/cs486Compatibility.js";

describe("CS C byte-oriented portability fixtures", (): void => {
  it("runs CRC32, a bounded binary record parser, and transactional RLE decode", (): void => {
    const files = new Map(
      linuxFilesystemImage.files.map((file) => [file.path, file.contents]),
    );
    const source = [
      "#include <stdint.h>",
      "uint8_t crc_input[9] = { 49, 50, 51, 52, 53, 54, 55, 56, 57 };",
      "uint8_t record[8] = { 67, 83, 1, 42, 120, 86, 52, 18 };",
      "uint8_t truncated_record[7] = { 67, 83, 1, 42, 120, 86, 52 };",
      "uint8_t encoded[6] = { 3, 65, 2, 66, 1, 67 };",
      "uint8_t bomb[2] = { 255, 90 };",
      "uint8_t output[8] = { 170, 170, 170, 170, 170, 170, 170, 170 };",
      "uint32_t crc32(uint8_t *data, int length) {",
      "  uint32_t crc = 4294967295U;",
      "  int index; int bit;",
      "  for (index = 0; index < length; index++) {",
      "    crc = crc ^ data[index];",
      "    for (bit = 0; bit < 8; bit++) crc = (crc >> 1) ^ ((crc & 1U) ? 3988292384U : 0U);",
      "  }",
      "  return ~crc;",
      "}",
      "int parse_record(uint8_t *data, int length, uint8_t *kind, uint32_t *value) {",
      "  if (length != 8 || data[0] != 67 || data[1] != 83 || data[2] != 1) return -1;",
      "  *kind = data[3];",
      "  *value = (uint32_t)data[4] | ((uint32_t)data[5] << 8) | ((uint32_t)data[6] << 16) | ((uint32_t)data[7] << 24);",
      "  return 0;",
      "}",
      "int rle_decode(uint8_t *input, int length, uint8_t *destination, int capacity) {",
      "  int index; int count; int total = 0; int cursor = 0;",
      "  if ((length & 1) != 0) return -1;",
      "  for (index = 0; index < length; index += 2) {",
      "    count = input[index];",
      "    if (count == 0 || total > capacity - count) return -2;",
      "    total = total + count;",
      "  }",
      "  for (index = 0; index < length; index += 2) {",
      "    count = input[index];",
      "    while (count > 0) { destination[cursor] = input[index + 1]; cursor = cursor + 1; count = count - 1; }",
      "  }",
      "  return total;",
      "}",
      "int main(void) {",
      "  uint8_t kind = 0; uint32_t value = 0; int index;",
      "  if (crc32(crc_input, 9) != 3421780262U) return 10;",
      "  if (parse_record(truncated_record, 7, &kind, &value) != -1 || kind != 0 || value != 0) return 11;",
      "  if (parse_record(record, 8, &kind, &value) != 0 || kind != 42 || value != 305419896U) return 12;",
      "  if (rle_decode(bomb, 2, output, 8) != -2) return 13;",
      "  for (index = 0; index < 8; index++) if (output[index] != 170) return 14;",
      "  if (rle_decode(encoded, 6, output, 8) != 6) return 15;",
      "  if (output[0] != 65 || output[1] != 65 || output[2] != 65) return 16;",
      "  if (output[3] != 66 || output[4] != 66 || output[5] != 67) return 17;",
      "  return 0;",
      "}",
    ].join("\n");
    const executable = compileCs486Source("c", source, {
      dataModel: cs486Byte8DataModel,
      include: ({ path }) => {
        const sourceName = `/usr/include/${path}`;
        const included = files.get(sourceName);
        return included === undefined
          ? undefined
          : { source: included, sourceName };
      },
      sourceName: "/tmp/byte-fixtures.c",
    });
    const requirements = cs486ExecutableMemoryRequirements(executable);
    if (requirements.kind !== "declared")
      throw new Error("byte fixture executable must declare memory");

    expect(
      runCs486(executable, {
        memoryBytes: requirements.linearAddressSpaceBytes,
      }).registers.eax,
    ).toBe(0);
  });
});
