import type { ComputerRecord } from "../../domain/computer/computer.js";
import type { MachineFace } from "../../domain/computer/machineFace.js";
import { machineFaces } from "../../domain/computer/machineFace.js";
import type { FaceIoHardware } from "../../domain/io/faceIoHardware.js";
import {
  I2cSegment,
  type I2cAttachResult,
  type I2cScanResult,
  type I2cTarget,
  type I2cTransactionResult,
} from "../../domain/io/i2cBus.js";
import {
  SpiBus,
  type SpiAttachResult,
  type SpiPeripheral,
  type SpiTransferResult,
} from "../../domain/io/spiBus.js";

export interface PeripheralEndpoint {
  readonly computerId: string;
  readonly face: MachineFace;
}

export type PeripheralAccessFailure =
  | { readonly outcome: "missing_computer" }
  | { readonly outcome: "powered_off" };

export type PeripheralSpiTransferResult =
  SpiTransferResult | PeripheralAccessFailure;
export type PeripheralI2cTransactionResult =
  I2cTransactionResult | PeripheralAccessFailure;
export type PeripheralI2cScanResult =
  ({ readonly outcome: "completed" } & I2cScanResult) | PeripheralAccessFailure;

interface FaceBuses {
  readonly i2c: I2cSegment;
  readonly spi: SpiBus;
}

/** Host-testable controller boundary used by future Bedrock IoT adapters. */
export class PeripheralBusBroker {
  private readonly hardware = new Map<string, FaceIoHardware>();
  private readonly buses = new Map<string, FaceBuses>();

  register(record: ComputerRecord): void {
    this.hardware.set(record.computerId, record.faceIo);
    for (const face of machineFaces) {
      this.buses.set(endpointKey({ computerId: record.computerId, face }), {
        i2c: new I2cSegment(),
        spi: new SpiBus(),
      });
    }
  }

  attachSpi(
    endpoint: PeripheralEndpoint,
    chipSelect: number,
    peripheral: SpiPeripheral,
  ): SpiAttachResult | PeripheralAccessFailure {
    const access = this.registeredBuses(endpoint);
    return "outcome" in access
      ? access
      : access.spi.attach(chipSelect, peripheral);
  }

  detachSpi(endpoint: PeripheralEndpoint, peripheralId: string): boolean {
    return (
      this.buses.get(endpointKey(endpoint))?.spi.detach(peripheralId) ?? false
    );
  }

  transferSpi(
    endpoint: PeripheralEndpoint,
    chipSelect: number,
    transmit: Uint8Array,
  ): PeripheralSpiTransferResult {
    const access = this.access(endpoint);
    return "outcome" in access
      ? access
      : access.spi.transfer(chipSelect, transmit);
  }

  attachI2c(
    endpoint: PeripheralEndpoint,
    target: I2cTarget,
  ): I2cAttachResult | PeripheralAccessFailure {
    const access = this.registeredBuses(endpoint);
    return "outcome" in access ? access : access.i2c.attach(target);
  }

  detachI2c(endpoint: PeripheralEndpoint, targetId: string): boolean {
    return this.buses.get(endpointKey(endpoint))?.i2c.detach(targetId) ?? false;
  }

  scanI2c(endpoint: PeripheralEndpoint): PeripheralI2cScanResult {
    const access = this.access(endpoint);
    if ("outcome" in access) return access;
    return { outcome: "completed", ...access.i2c.scan() };
  }

  transactI2c(
    endpoint: PeripheralEndpoint,
    address: number,
    write: Uint8Array,
    readLength: number,
  ): PeripheralI2cTransactionResult {
    const access = this.access(endpoint);
    return "outcome" in access
      ? access
      : access.i2c.transact(address, write, readLength);
  }

  clearFace(endpoint: PeripheralEndpoint): void {
    if (!this.hardware.has(endpoint.computerId)) return;
    this.buses.set(endpointKey(endpoint), {
      i2c: new I2cSegment(),
      spi: new SpiBus(),
    });
  }

  clearComputer(computerId: string): void {
    for (const face of machineFaces) this.clearFace({ computerId, face });
  }

  private access(
    endpoint: PeripheralEndpoint,
  ): FaceBuses | PeripheralAccessFailure {
    const hardware = this.hardware.get(endpoint.computerId);
    const buses = this.buses.get(endpointKey(endpoint));
    if (hardware === undefined || buses === undefined) {
      return { outcome: "missing_computer" };
    }
    if (!hardware.rs232(endpoint.face).status.powered) {
      return { outcome: "powered_off" };
    }
    return buses;
  }

  private registeredBuses(
    endpoint: PeripheralEndpoint,
  ): FaceBuses | PeripheralAccessFailure {
    const buses = this.buses.get(endpointKey(endpoint));
    return buses ?? { outcome: "missing_computer" };
  }
}

function endpointKey(endpoint: PeripheralEndpoint): string {
  return `${endpoint.computerId}\u0000${endpoint.face}`;
}
