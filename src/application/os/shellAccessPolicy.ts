import type { ComputerOsProfile } from "../../domain/computer/computer.js";
import type { InMemoryFilesystem } from "../../domain/filesystem/inMemoryFilesystem.js";

export interface ShellAccessPolicy {
  hasAccess(path: string, required: number): boolean;
}

class LinuxShellAccessPolicy implements ShellAccessPolicy {
  constructor(private readonly filesystem: InMemoryFilesystem) {}

  hasAccess(path: string, required: number): boolean {
    const metadata = this.filesystem.getMetadata(path);
    const shift = metadata.uid === 1_000 ? 6 : metadata.gid === 1_000 ? 3 : 0;
    return ((metadata.mode >> shift) & 0b111 & required) === required;
  }
}

class UnrestrictedShellAccessPolicy implements ShellAccessPolicy {
  hasAccess(): boolean {
    return true;
  }
}

export function shellAccessPolicyFor(
  profile: ComputerOsProfile,
  filesystem: InMemoryFilesystem,
): ShellAccessPolicy {
  return profile === "linux"
    ? new LinuxShellAccessPolicy(filesystem)
    : new UnrestrictedShellAccessPolicy();
}
