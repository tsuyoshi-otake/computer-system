import { describe, expect, it } from "vitest";

import { BoundedBytePipe } from "../../src/domain/io/boundedBytePipe.js";

describe("BoundedBytePipe", (): void => {
  it("preserves bytes across wraparound and applies partial-write backpressure", (): void => {
    const pipe = new BoundedBytePipe(5);
    const reader = pipe.reader();
    const writer = pipe.writer();

    expect(writer.write(Uint8Array.from([1, 2, 3, 4]))).toEqual({
      bytesWritten: 4,
      kind: "written",
    });
    expect(reader.read(3)).toEqual({
      bytes: Uint8Array.from([1, 2, 3]),
      kind: "data",
    });
    expect(writer.write(Uint8Array.from([5, 6, 7, 8, 9]))).toEqual({
      bytesWritten: 4,
      kind: "written",
    });
    expect(writer.write(Uint8Array.of(10))).toEqual({ kind: "would-block" });
    expect(reader.read(8)).toEqual({
      bytes: Uint8Array.from([4, 5, 6, 7, 8]),
      kind: "data",
    });
  });

  it("publishes EOF only after every writer closes and buffered bytes drain", (): void => {
    const pipe = new BoundedBytePipe(4);
    const reader = pipe.reader();
    const writer = pipe.writer();
    const duplicate = writer.duplicate();
    expect(writer.write(Uint8Array.from([1, 2]))).toEqual({
      bytesWritten: 2,
      kind: "written",
    });
    writer.close();
    expect(reader.read(4).kind).toBe("data");
    expect(reader.read(4)).toEqual({ kind: "would-block" });
    duplicate.close();
    expect(reader.read(4)).toEqual({ kind: "eof" });
  });

  it("reports broken pipe after the final reader closes and makes close idempotent", (): void => {
    const pipe = new BoundedBytePipe(2);
    const reader = pipe.reader();
    const writer = pipe.writer();
    reader.close();
    reader.close();
    expect(writer.write(Uint8Array.of(1))).toEqual({ kind: "broken-pipe" });
    writer.close();
    writer.close();
    expect(pipe.openReaders).toBe(0);
    expect(pipe.openWriters).toBe(0);
  });

  it("advances readiness generations only on blocking-state transitions", (): void => {
    const pipe = new BoundedBytePipe(1);
    const reader = pipe.reader();
    const writer = pipe.writer();
    expect(pipe.readableGeneration).toBe(0);
    expect(writer.write(Uint8Array.of(7))).toEqual({
      bytesWritten: 1,
      kind: "written",
    });
    expect(pipe.readableGeneration).toBe(1);
    expect(reader.read(1).kind).toBe("data");
    expect(pipe.writableGeneration).toBe(1);
    writer.close();
    expect(pipe.readableGeneration).toBe(2);
  });

  it("rejects invalid reads without mutation", (): void => {
    const pipe = new BoundedBytePipe(2);
    const reader = pipe.reader();
    expect(() => reader.read(0)).toThrow(/positive integer/u);
    expect(pipe.bufferedBytes).toBe(0);
  });
});
