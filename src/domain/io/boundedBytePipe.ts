import { ByteRingBuffer } from "./byteRingBuffer.js";

export type PipeReadResult =
  | { readonly kind: "data"; readonly bytes: Uint8Array }
  | { readonly kind: "eof" }
  | { readonly kind: "would-block" };

export type PipeWriteResult =
  | { readonly kind: "broken-pipe" }
  | { readonly kind: "would-block" }
  | { readonly bytesWritten: number; readonly kind: "written" };

/**
 * One bounded anonymous byte pipe. The scheduler owns waiting; this primitive
 * owns byte order, endpoint lifetime, readiness generations, and backpressure.
 */
export class BoundedBytePipe {
  private readonly ring: ByteRingBuffer;
  private readers = 0;
  private writers = 0;
  private readableGenerationValue = 0;
  private writableGenerationValue = 0;

  constructor(readonly capacity: number) {
    this.ring = new ByteRingBuffer(capacity);
  }

  get bufferedBytes(): number {
    return this.ring.size;
  }

  get freeBytes(): number {
    return this.ring.free;
  }

  get openReaders(): number {
    return this.readers;
  }

  get openWriters(): number {
    return this.writers;
  }

  get readableGeneration(): number {
    return this.readableGenerationValue;
  }

  get writableGeneration(): number {
    return this.writableGenerationValue;
  }

  reader(): PipeReader {
    this.readers += 1;
    return new PipeReader(this);
  }

  writer(): PipeWriter {
    this.writers += 1;
    return new PipeWriter(this);
  }

  duplicateReader(): PipeReader {
    this.readers += 1;
    return new PipeReader(this);
  }

  duplicateWriter(): PipeWriter {
    this.writers += 1;
    return new PipeWriter(this);
  }

  read(maximumBytes: number): PipeReadResult {
    requirePositiveTransfer(maximumBytes);
    if (this.ring.size === 0) {
      return this.writers === 0 ? { kind: "eof" } : { kind: "would-block" };
    }
    const wasFull = this.ring.free === 0;
    const bytes = this.ring.read(maximumBytes);
    if (wasFull && bytes.byteLength > 0) this.writableGenerationValue += 1;
    return { bytes, kind: "data" };
  }

  write(bytes: Uint8Array): PipeWriteResult {
    if (!(bytes instanceof Uint8Array)) {
      throw new TypeError("Pipe writes require Uint8Array bytes");
    }
    if (bytes.byteLength === 0) return { bytesWritten: 0, kind: "written" };
    if (this.readers === 0) return { kind: "broken-pipe" };
    if (this.ring.free === 0) return { kind: "would-block" };
    const wasEmpty = this.ring.size === 0;
    const count = Math.min(bytes.byteLength, this.ring.free);
    const accepted = count === bytes.byteLength ? bytes : bytes.slice(0, count);
    if (!this.ring.write(accepted)) {
      throw new Error("Pipe free-space accounting did not terminate");
    }
    if (wasEmpty) this.readableGenerationValue += 1;
    return { bytesWritten: count, kind: "written" };
  }

  closeReader(): void {
    if (this.readers <= 0) throw new Error("Pipe reader count underflow");
    this.readers -= 1;
    if (this.readers === 0) {
      this.ring.clear();
      this.writableGenerationValue += 1;
    }
  }

  closeWriter(): void {
    if (this.writers <= 0) throw new Error("Pipe writer count underflow");
    this.writers -= 1;
    if (this.writers === 0) this.readableGenerationValue += 1;
  }
}

export class PipeReader {
  private closedValue = false;

  constructor(private readonly pipe: BoundedBytePipe) {}

  get closed(): boolean {
    return this.closedValue;
  }

  get ready(): boolean {
    return this.pipe.bufferedBytes > 0 || this.pipe.openWriters === 0;
  }

  get readableGeneration(): number {
    return this.pipe.readableGeneration;
  }

  duplicate(): PipeReader {
    this.assertOpen();
    return this.pipe.duplicateReader();
  }

  read(maximumBytes: number): PipeReadResult {
    this.assertOpen();
    return this.pipe.read(maximumBytes);
  }

  close(): void {
    if (this.closedValue) return;
    this.closedValue = true;
    this.pipe.closeReader();
  }

  private assertOpen(): void {
    if (this.closedValue) throw new Error("Pipe reader is closed");
  }
}

export class PipeWriter {
  private closedValue = false;

  constructor(private readonly pipe: BoundedBytePipe) {}

  get closed(): boolean {
    return this.closedValue;
  }

  get freeBytes(): number {
    return this.pipe.freeBytes;
  }

  get ready(): boolean {
    return this.pipe.openReaders === 0 || this.pipe.freeBytes > 0;
  }

  get writableGeneration(): number {
    return this.pipe.writableGeneration;
  }

  duplicate(): PipeWriter {
    this.assertOpen();
    return this.pipe.duplicateWriter();
  }

  write(bytes: Uint8Array): PipeWriteResult {
    this.assertOpen();
    return this.pipe.write(bytes);
  }

  close(): void {
    if (this.closedValue) return;
    this.closedValue = true;
    this.pipe.closeWriter();
  }

  private assertOpen(): void {
    if (this.closedValue) throw new Error("Pipe writer is closed");
  }
}

function requirePositiveTransfer(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError("Pipe read size must be a positive integer");
  }
}
