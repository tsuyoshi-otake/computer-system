export class ByteRingBuffer {
  private readonly storage: Uint8Array;
  private head = 0;
  private tail = 0;
  private sizeValue = 0;

  constructor(readonly capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity <= 0) {
      throw new RangeError("Byte ring capacity must be a positive integer");
    }
    this.storage = new Uint8Array(capacity);
  }

  get size(): number {
    return this.sizeValue;
  }

  get free(): number {
    return this.capacity - this.sizeValue;
  }

  write(bytes: Uint8Array): boolean {
    if (bytes.length > this.free) return false;
    for (let index = 0; index < bytes.length; index += 1) {
      this.storage[this.tail] = bytes[index]!;
      this.tail = (this.tail + 1) % this.capacity;
    }
    this.sizeValue += bytes.length;
    return true;
  }

  peek(maximumBytes = this.sizeValue): Uint8Array {
    const count = boundedCount(maximumBytes, this.sizeValue);
    const bytes = new Uint8Array(count);
    for (let index = 0; index < count; index += 1) {
      bytes[index] = this.storage[(this.head + index) % this.capacity]!;
    }
    return bytes;
  }

  read(maximumBytes = this.sizeValue): Uint8Array {
    const bytes = this.peek(maximumBytes);
    this.discard(bytes.length);
    return bytes;
  }

  discard(count: number): void {
    const bounded = boundedCount(count, this.sizeValue);
    if (bounded !== count) {
      throw new RangeError("Cannot discard more bytes than the ring contains");
    }
    this.head = (this.head + count) % this.capacity;
    this.sizeValue -= count;
    if (this.sizeValue === 0) this.tail = this.head;
  }

  clear(): number {
    const removed = this.sizeValue;
    this.head = 0;
    this.tail = 0;
    this.sizeValue = 0;
    return removed;
  }
}

function boundedCount(value: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("Byte count must be a non-negative integer");
  }
  return Math.min(value, maximum);
}
