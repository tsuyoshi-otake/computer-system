import { ByteRingBuffer } from "./byteRingBuffer.js";

export const rs232BaudRate = 9_600;
export const rs232BitsPerByte = 10;

export interface Rs232PortOptions {
  readonly receiveCapacity?: number;
  readonly transmitCapacity?: number;
  readonly maximumWriteBytes?: number;
}

export type Rs232WriteResult =
  | { readonly outcome: "accepted"; readonly bytes: number }
  | { readonly outcome: "powered_off" }
  | { readonly outcome: "write_limit_exceeded"; readonly maximum: number }
  | { readonly outcome: "transmit_buffer_full"; readonly available: number };

export type Rs232ReceiveResult =
  | { readonly outcome: "accepted"; readonly bytes: number }
  | { readonly outcome: "powered_off" }
  | { readonly outcome: "receive_buffer_full"; readonly available: number };

export type Rs232TransferResult =
  | { readonly outcome: "moved"; readonly bytes: number }
  | { readonly outcome: "idle" }
  | { readonly outcome: "sender_offline" }
  | { readonly outcome: "peer_offline" }
  | { readonly outcome: "receiver_blocked" };

export interface Rs232PortStatus {
  readonly droppedReceiveBytes: number;
  readonly droppedTransmitBytes: number;
  readonly lastResetReason?: string;
  readonly maximumWriteBytes: number;
  readonly powerEpoch: number;
  readonly powered: boolean;
  readonly receiveBytes: number;
  readonly receiveCapacity: number;
  readonly resetEpoch: number;
  readonly transmitBytes: number;
  readonly transmitCapacity: number;
}

export class Rs232Port {
  private readonly receiveBuffer: ByteRingBuffer;
  private readonly transmitBuffer: ByteRingBuffer;
  private readonly maximumWriteBytes: number;
  private poweredValue = false;
  private powerEpochValue = 0;
  private resetEpochValue = 0;
  private droppedReceiveBytesValue = 0;
  private droppedTransmitBytesValue = 0;
  private lastResetReasonValue: string | undefined;

  constructor(options: Rs232PortOptions = {}) {
    const receiveCapacity = options.receiveCapacity ?? 4_096;
    const transmitCapacity = options.transmitCapacity ?? 4_096;
    const maximumWriteBytes = options.maximumWriteBytes ?? 1_024;
    if (
      !Number.isSafeInteger(maximumWriteBytes) ||
      maximumWriteBytes <= 0 ||
      maximumWriteBytes > transmitCapacity
    ) {
      throw new RangeError(
        "RS-232C maximum write must fit in the transmit buffer",
      );
    }
    this.receiveBuffer = new ByteRingBuffer(receiveCapacity);
    this.transmitBuffer = new ByteRingBuffer(transmitCapacity);
    this.maximumWriteBytes = maximumWriteBytes;
  }

  get status(): Rs232PortStatus {
    return {
      droppedReceiveBytes: this.droppedReceiveBytesValue,
      droppedTransmitBytes: this.droppedTransmitBytesValue,
      ...(this.lastResetReasonValue === undefined
        ? {}
        : { lastResetReason: this.lastResetReasonValue }),
      maximumWriteBytes: this.maximumWriteBytes,
      powerEpoch: this.powerEpochValue,
      powered: this.poweredValue,
      receiveBytes: this.receiveBuffer.size,
      receiveCapacity: this.receiveBuffer.capacity,
      resetEpoch: this.resetEpochValue,
      transmitBytes: this.transmitBuffer.size,
      transmitCapacity: this.transmitBuffer.capacity,
    };
  }

  powerOn(): void {
    if (this.poweredValue) return;
    this.resetBuffers("power_on");
    this.poweredValue = true;
    this.powerEpochValue += 1;
  }

  powerOff(reason = "power_off"): void {
    if (!this.poweredValue) return;
    this.resetBuffers(reason);
    this.poweredValue = false;
    this.powerEpochValue += 1;
  }

  resetLink(reason: string): void {
    if (reason.length === 0)
      throw new RangeError("Reset reason cannot be empty");
    this.resetBuffers(reason);
  }

  write(bytes: Uint8Array): Rs232WriteResult {
    if (!this.poweredValue) return { outcome: "powered_off" };
    if (bytes.length > this.maximumWriteBytes) {
      return {
        outcome: "write_limit_exceeded",
        maximum: this.maximumWriteBytes,
      };
    }
    if (!this.transmitBuffer.write(bytes)) {
      return {
        outcome: "transmit_buffer_full",
        available: this.transmitBuffer.free,
      };
    }
    return { outcome: "accepted", bytes: bytes.length };
  }

  read(maximumBytes = this.receiveBuffer.capacity): Uint8Array {
    if (!this.poweredValue) return new Uint8Array();
    return this.receiveBuffer.read(maximumBytes);
  }

  receive(bytes: Uint8Array): Rs232ReceiveResult {
    if (!this.poweredValue) return { outcome: "powered_off" };
    if (!this.receiveBuffer.write(bytes)) {
      return {
        outcome: "receive_buffer_full",
        available: this.receiveBuffer.free,
      };
    }
    return { outcome: "accepted", bytes: bytes.length };
  }

  transferTo(peer: Rs232Port, maximumBytes: number): Rs232TransferResult {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
      throw new RangeError("RS-232C transfer limit must be positive");
    }
    if (!this.poweredValue) return { outcome: "sender_offline" };
    if (!peer.poweredValue) return { outcome: "peer_offline" };
    if (this.transmitBuffer.size === 0) return { outcome: "idle" };
    const bytesToMove = Math.min(
      maximumBytes,
      this.transmitBuffer.size,
      peer.receiveBuffer.free,
    );
    if (bytesToMove === 0) return { outcome: "receiver_blocked" };
    const bytes = this.transmitBuffer.peek(bytesToMove);
    if (!peer.receiveBuffer.write(bytes)) {
      return { outcome: "receiver_blocked" };
    }
    this.transmitBuffer.discard(bytes.length);
    return { outcome: "moved", bytes: bytes.length };
  }

  private resetBuffers(reason: string): void {
    this.droppedReceiveBytesValue += this.receiveBuffer.clear();
    this.droppedTransmitBytesValue += this.transmitBuffer.clear();
    this.lastResetReasonValue = reason;
    this.resetEpochValue += 1;
  }
}
