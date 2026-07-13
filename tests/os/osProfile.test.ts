import { describe, expect, it } from "vitest";

import { getOsProfile } from "../../src/application/os/osProfile.js";
import { ShellSession } from "../../src/application/os/shellSession.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";

describe("OS profile boundary", (): void => {
  it("selects Linux behavior through injected profile services", (): void => {
    const profile = getOsProfile("linux");
    const filesystem = new InMemoryFilesystem();
    profile.boot(filesystem, { computerName: "c-linux1" });

    expect(
      profile.pathDialect.resolve("work", profile.home, profile.home),
    ).toBe("/home/computer/work");
    expect(profile.virtualDevices.get("/dev/null")?.read()).toBe("");
    expect(filesystem.readFile("/etc/hostname")).toBe("c-linux1\n");
  });

  it("keeps profile command aliases outside the shared shell core", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem, {
      computerName: "c-dos001",
      osProfile: "dos",
    });

    expect(shell.prompt()).toBe("C:\\USERS\\COMPUTER> ");
    expect(shell.submit("DIR C:\\").lines[0]).toContain("AUTOEXEC.BAT");
    expect(shell.submit("ECHO discarded > NUL").exitCode).toBe(0);
  });
});
