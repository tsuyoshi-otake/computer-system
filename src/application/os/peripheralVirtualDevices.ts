import type { ComputerOsProfile } from "../../domain/computer/computer.js";
import { machineFaces } from "../../domain/computer/machineFace.js";
import type { PeripheralBusBroker } from "../io/peripheralBusBroker.js";
import type { VirtualDevice } from "./osProfile.js";

export function createPeripheralVirtualDevices(
  osProfile: ComputerOsProfile,
  computerId: string,
  peripherals: PeripheralBusBroker,
): ReadonlyMap<string, VirtualDevice> {
  void computerId;
  void peripherals;
  const devices = new Map<string, VirtualDevice>();
  for (const [index, face] of machineFaces.entries()) {
    const spiPath =
      osProfile === "linux"
        ? `/dev/spidev${String(index)}.0`
        : `/drives/c/spi${String(index + 1)}`;
    const i2cPath =
      osProfile === "linux"
        ? `/dev/i2c-${String(index)}`
        : `/drives/c/i2c${String(index + 1)}`;
    devices.set(
      spiPath,
      transactionDevice(spiPath, "SPI mode 0, 1000000 Hz, 8-bit, MSB-first\n"),
    );
    devices.set(
      i2cPath,
      transactionDevice(i2cPath, "I2C 100000 Hz, 7-bit addresses\n"),
    );
    void face;
  }
  return devices;
}

function transactionDevice(path: string, description: string): VirtualDevice {
  return {
    path,
    read: () => description,
    write: (): never => {
      throw new Error(
        `${path}: transaction device; use the spi/i2c command or Python module`,
      );
    },
  };
}
