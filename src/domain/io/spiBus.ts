export const defaultSpiConfiguration = {
  bitOrder: "msb-first",
  bitsPerWord: 8,
  clockHz: 1_000_000,
  mode: 0,
} as const;

export const maximumSpiTransferBytes = 256;
export const maximumSpiChipSelect = 7;

export interface SpiPeripheral {
  readonly id: string;
  transfer(transmit: Uint8Array): Uint8Array;
}

export type SpiAttachResult =
  | { readonly outcome: "attached" }
  | { readonly outcome: "chip_select_conflict"; readonly chipSelect: number };

export type SpiTransferResult =
  | { readonly outcome: "completed"; readonly receive: Uint8Array }
  | { readonly outcome: "detached" }
  | { readonly outcome: "chip_select_conflict"; readonly chipSelect: number }
  | { readonly outcome: "transfer_limit_exceeded"; readonly maximum: number }
  | { readonly outcome: "protocol_error"; readonly message: string };

export class SpiBus {
  private readonly targets = new Map<number, Map<string, SpiPeripheral>>();

  attach(chipSelect: number, peripheral: SpiPeripheral): SpiAttachResult {
    requireChipSelect(chipSelect);
    requireIdentifier(peripheral.id, "SPI peripheral ID");
    const targets =
      this.targets.get(chipSelect) ?? new Map<string, SpiPeripheral>();
    targets.set(peripheral.id, peripheral);
    this.targets.set(chipSelect, targets);
    return targets.size === 1
      ? { outcome: "attached" }
      : { outcome: "chip_select_conflict", chipSelect };
  }

  detach(peripheralId: string): boolean {
    let removed = false;
    for (const [chipSelect, targets] of this.targets) {
      removed = targets.delete(peripheralId) || removed;
      if (targets.size === 0) this.targets.delete(chipSelect);
    }
    return removed;
  }

  transfer(chipSelect: number, transmit: Uint8Array): SpiTransferResult {
    requireChipSelect(chipSelect);
    if (transmit.length > maximumSpiTransferBytes) {
      return {
        outcome: "transfer_limit_exceeded",
        maximum: maximumSpiTransferBytes,
      };
    }
    const targets = this.targets.get(chipSelect);
    if (targets === undefined || targets.size === 0)
      return { outcome: "detached" };
    if (targets.size !== 1) {
      return { outcome: "chip_select_conflict", chipSelect };
    }
    try {
      const receive = [...targets.values()][0]!.transfer(transmit.slice());
      if (receive.length !== transmit.length) {
        return {
          outcome: "protocol_error",
          message: "SPI response length must equal transfer length",
        };
      }
      return { outcome: "completed", receive: receive.slice() };
    } catch (error: unknown) {
      return {
        outcome: "protocol_error",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

function requireChipSelect(value: number): void {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > maximumSpiChipSelect
  ) {
    throw new RangeError("SPI chip select must be between 0 and 7");
  }
}

function requireIdentifier(value: string, label: string): void {
  if (value.length === 0 || value.length > 128)
    throw new RangeError(`${label} must contain 1..128 characters`);
}
