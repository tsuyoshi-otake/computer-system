import { describe, expect, it } from "vitest";

import { ShellSession } from "../../src/application/os/shellSession.js";
import {
  FloppyDrive,
  FloppyGuestFilesystem,
} from "../../src/application/os/floppyDrive.js";
import { unrestrictedGuestFilesystem } from "../../src/application/os/guestFilesystem.js";
import { DosRuntimeState } from "../../src/application/os/dosRuntimeState.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";
import { FloppyMedia } from "../../src/domain/storage/floppyMedia.js";

const timestamp = Date.UTC(2026, 6, 16, 12, 0, 1);

describe("FloppyDrive guest integration", (): void => {
  it("formats /S in DOS, performs A: I/O, and keeps FAT content across sessions", (): void => {
    const fixture = createFixture("dos");
    const dos = DosRuntimeState.create();
    dos.mountMedia("A", { generation: 1 });
    const shell = new ShellSession(fixture.filesystem, {
      dosRuntime: dos,
      floppyDrive: fixture.drive,
      guestFilesystem: fixture.guest,
      osProfile: "dos",
      requestFloppyIo: (requests): string => {
        fixture.io.push(...requests);
        return "floppy:done";
      },
    });

    expect(shell.submit("FORMAT A: /S /V:BOOTDISK")).toMatchObject({
      exitCode: 0,
      ioWaitEvent: "floppy:done",
    });
    expect(fixture.media.bootable).toBe(true);
    expect(fixture.media.volumeLabel).toBe("BOOTDISK");
    expect(() =>
      shell.writeCompilerOutput("A:\\DIRECT.TXT", "DIRECT\r\n"),
    ).not.toThrow();
    const written = shell.submit("ECHO HELLO > A:\\HELLO.TXT");
    expect(written.exitCode, JSON.stringify(written)).toBe(0);
    expect(shell.submit("TYPE A:\\HELLO.TXT").stdout).toContain("HELLO");
    expect(fixture.media.readFile("/HELLO.TXT")).toContain("HELLO");
    expect(fixture.io.some((request) => request.operation === "write")).toBe(
      true,
    );
    expect(fixture.saves).toBeGreaterThan(1);
  });

  it("mounts a fixed-permission vfat view in Linux and rejects metadata/link bypasses", (): void => {
    const fixture = createFixture("linux");
    fixture.media.format({
      modifiedAtMilliseconds: timestamp,
      volumeLabel: "SHARED",
    });
    const shell = initializedLinuxShell(fixture);

    expect(shell.submit("mount /dev/fd0 /mnt/floppy").exitCode).not.toBe(0);
    authorizeSudo(shell);
    expect(
      shell.submit("sudo -n mount -t vfat /dev/fd0 /mnt/floppy").exitCode,
    ).toBe(0);
    expect(shell.submit("echo shared > /mnt/floppy/SHARED.TXT").exitCode).toBe(
      0,
    );
    expect(shell.submit("cat /mnt/floppy/SHARED.TXT").stdout).toBe("shared\n");
    expect(fixture.guest.getMetadata("/mnt/floppy/SHARED.TXT")).toMatchObject({
      gid: 1_000,
      mode: 0o644,
      uid: 1_000,
    });
    expect(shell.submit("chmod 777 /mnt/floppy/SHARED.TXT").exitCode).not.toBe(
      0,
    );
    expect(
      shell.submit("ln -s /etc/passwd /mnt/floppy/PASSWD").exitCode,
    ).not.toBe(0);
    expect(shell.submit("sudo -n umount /mnt/floppy").exitCode).toBe(0);
    expect(fixture.guest.exists("/mnt/floppy/SHARED.TXT")).toBe(false);
  });

  it("requires an unmounted device for Linux formatting and supports guest eject", (): void => {
    let ejected = 0;
    const fixture = createFixture("linux", (): void => {
      ejected += 1;
    });
    const shell = initializedLinuxShell(fixture);
    authorizeSudo(shell);

    expect(
      shell.submit("sudo -n mkfs.fat -F 12 -n DATA /dev/fd0").exitCode,
    ).toBe(0);
    expect(fixture.media.volumeLabel).toBe("DATA");
    expect(shell.submit("sudo -n mount /dev/fd0 /mnt/floppy").exitCode).toBe(0);
    expect(shell.submit("sudo -n mkfs.fat /dev/fd0").exitCode).not.toBe(0);
    expect(shell.submit("sudo -n eject /dev/fd0").exitCode).toBe(0);
    expect(ejected).toBe(1);
  });
});

function createFixture(
  profile: "dos" | "linux",
  onGuestEject: () => void = (): void => undefined,
): {
  readonly drive: FloppyDrive;
  readonly filesystem: InMemoryFilesystem;
  readonly guest: FloppyGuestFilesystem;
  readonly io: ReturnType<FloppyDrive["drainIo"]>[number][];
  readonly media: FloppyMedia;
  readonly saves: number;
} {
  const filesystem = new InMemoryFilesystem();
  const media = new FloppyMedia("f-01234567");
  let saves = 0;
  const drive = new FloppyDrive({
    nowMilliseconds: (): number => timestamp,
    onGuestEject,
    save: (): void => {
      saves += 1;
    },
  });
  drive.insert(media);
  const io: ReturnType<FloppyDrive["drainIo"]>[number][] = [];
  return {
    drive,
    filesystem,
    guest: new FloppyGuestFilesystem(
      unrestrictedGuestFilesystem(filesystem),
      drive,
      profile,
    ),
    io,
    media,
    get saves(): number {
      return saves;
    },
  };
}

function initializedLinuxShell(
  fixture: ReturnType<typeof createFixture>,
): ShellSession {
  const shell = new ShellSession(fixture.filesystem, {
    computerName: "c-floppy",
    floppyDrive: fixture.drive,
    guestFilesystem: fixture.guest,
    osProfile: "linux",
    passwordSalt: (): string => "fixed-floppy-salt",
    requireLogin: true,
  });
  expect(shell.prompt()).toBe("New password: ");
  shell.submit("floppy-test-password");
  expect(shell.submit("floppy-test-password").exitCode).toBe(0);
  return shell;
}

function authorizeSudo(shell: ShellSession): void {
  expect(shell.submit("sudo true").exitCode).toBe(0);
  expect(shell.prompt()).toContain("[sudo] password");
  expect(shell.submit("floppy-test-password").exitCode).toBe(0);
}
