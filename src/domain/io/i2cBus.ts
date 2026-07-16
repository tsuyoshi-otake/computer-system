export const i2cClockHz = 100_000;
export const minimumI2cAddress = 0x08;
export const maximumI2cAddress = 0x77;
export const maximumI2cTransactionBytes = 256;

export interface I2cRequest {
  readonly readLength: number;
  readonly write: Uint8Array;
}

export interface I2cTarget {
  readonly address: number;
  readonly id: string;
  transact(request: I2cRequest): Uint8Array;
}

export type I2cAttachResult =
  | { readonly outcome: "attached" }
  | { readonly outcome: "address_conflict"; readonly address: number };

export type I2cTransactionResult =
  | { readonly outcome: "completed"; readonly read: Uint8Array }
  | { readonly outcome: "nack"; readonly address: number }
  | { readonly outcome: "address_conflict"; readonly address: number }
  | { readonly outcome: "transaction_limit_exceeded"; readonly maximum: number }
  | { readonly outcome: "protocol_error"; readonly message: string };

export interface I2cScanResult {
  readonly addresses: readonly number[];
  readonly conflicts: readonly number[];
}

export class I2cSegment {
  private readonly targets = new Map<number, Map<string, I2cTarget>>();

  attach(target: I2cTarget): I2cAttachResult {
    requireI2cAddress(target.address);
    requireIdentifier(target.id, "I2C target ID");
    const targets =
      this.targets.get(target.address) ?? new Map<string, I2cTarget>();
    targets.set(target.id, target);
    this.targets.set(target.address, targets);
    return targets.size === 1
      ? { outcome: "attached" }
      : { outcome: "address_conflict", address: target.address };
  }

  detach(targetId: string): boolean {
    let removed = false;
    for (const [address, targets] of this.targets) {
      removed = targets.delete(targetId) || removed;
      if (targets.size === 0) this.targets.delete(address);
    }
    return removed;
  }

  scan(): I2cScanResult {
    const addresses: number[] = [];
    const conflicts: number[] = [];
    for (const [address, targets] of this.targets) {
      if (targets.size === 1) addresses.push(address);
      else conflicts.push(address);
    }
    return {
      addresses: addresses.sort((left, right) => left - right),
      conflicts: conflicts.sort((left, right) => left - right),
    };
  }

  transact(
    address: number,
    write: Uint8Array,
    readLength: number,
  ): I2cTransactionResult {
    requireI2cAddress(address);
    if (!Number.isSafeInteger(readLength) || readLength < 0) {
      throw new RangeError("I2C read length must be a non-negative integer");
    }
    if (write.length + readLength > maximumI2cTransactionBytes) {
      return {
        outcome: "transaction_limit_exceeded",
        maximum: maximumI2cTransactionBytes,
      };
    }
    const targets = this.targets.get(address);
    if (targets === undefined || targets.size === 0) {
      return { outcome: "nack", address };
    }
    if (targets.size !== 1) return { outcome: "address_conflict", address };
    try {
      const read = [...targets.values()][0]!.transact({
        write: write.slice(),
        readLength,
      });
      if (read.length !== readLength) {
        return {
          outcome: "protocol_error",
          message: "I2C response length does not match the requested length",
        };
      }
      return { outcome: "completed", read: read.slice() };
    } catch (error: unknown) {
      return {
        outcome: "protocol_error",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export function requireI2cAddress(address: number): void {
  if (
    !Number.isSafeInteger(address) ||
    address < minimumI2cAddress ||
    address > maximumI2cAddress
  ) {
    throw new RangeError(
      "I2C address must be a usable 7-bit address (0x08..0x77)",
    );
  }
}

function requireIdentifier(value: string, label: string): void {
  if (value.length === 0 || value.length > 128)
    throw new RangeError(`${label} must contain 1..128 characters`);
}
