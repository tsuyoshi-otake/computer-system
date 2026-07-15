import type { ComputerOsProfile } from "../../domain/computer/computer.js";
import { DosShellFrontend } from "./dosShellFrontend.js";
import { LinuxShellFrontend } from "./linuxShellFrontend.js";
import type { ShellFrontend } from "./shellFrontend.js";

const frontends: Readonly<Record<ComputerOsProfile, ShellFrontend>> = {
  dos: new DosShellFrontend(),
  linux: new LinuxShellFrontend(),
};

export function shellFrontendFor(profile: ComputerOsProfile): ShellFrontend {
  return frontends[profile];
}
