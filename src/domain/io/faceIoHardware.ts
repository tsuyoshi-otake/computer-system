import { machineFaces, type MachineFace } from "../computer/machineFace.js";
import { Rs232Port, type Rs232PortOptions } from "./rs232Port.js";

export interface FaceIoHardwareOptions {
  readonly rs232?: Rs232PortOptions;
}

/**
 * Transient per-computer face I/O hardware.
 *
 * This object deliberately has no snapshot representation. Link state and
 * buffered bytes are physical runtime state and are cleared at every power or
 * topology boundary.
 */
export class FaceIoHardware {
  private readonly serialPorts: Readonly<Record<MachineFace, Rs232Port>>;

  constructor(options: FaceIoHardwareOptions = {}) {
    this.serialPorts = Object.fromEntries(
      machineFaces.map((face) => [face, new Rs232Port(options.rs232)]),
    ) as unknown as Readonly<Record<MachineFace, Rs232Port>>;
  }

  rs232(face: MachineFace): Rs232Port {
    return this.serialPorts[face];
  }

  powerOn(): void {
    for (const face of machineFaces) this.serialPorts[face].powerOn();
  }

  powerOff(reason = "power_off"): void {
    for (const face of machineFaces) this.serialPorts[face].powerOff(reason);
  }

  resetFace(face: MachineFace, reason: string): void {
    this.serialPorts[face].resetLink(reason);
  }
}
