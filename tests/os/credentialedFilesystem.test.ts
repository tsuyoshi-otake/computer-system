import { describe, expect, it } from "vitest";

import { CredentialedFilesystem } from "../../src/application/os/credentialedFilesystem.js";
import { UnrestrictedGuestFilesystem } from "../../src/application/os/guestFilesystem.js";
import {
  createLoginCredentials,
  initialUserCredentials,
  rootCredentials,
} from "../../src/application/os/linuxCredentials.js";
import {
  defaultFilesystemLimits,
  FilesystemError,
  InMemoryFilesystem,
} from "../../src/domain/filesystem/inMemoryFilesystem.js";

describe("credential-aware guest filesystem", (): void => {
  it("enforces ancestor search and does not bypass it through symbolic links", (): void => {
    const raw = new InMemoryFilesystem();
    raw.makeDirectory("/open");
    raw.makeDirectory("/private");
    raw.writeFile("/private/secret", "classified");
    raw.setMetadata("/private", { gid: 2_000, mode: 0o700, uid: 2_000 });
    raw.setMetadata("/private/secret", {
      gid: 2_000,
      mode: 0o644,
      uid: 2_000,
    });
    raw.createSymbolicLink("/private", "/open/private-link");
    const guest = new CredentialedFilesystem(raw, initialUserCredentials);

    expectFilesystemError(
      () => guest.readFile("/private/secret"),
      "permission_denied",
    );
    expectFilesystemError(
      () => guest.exists("/open/private-link/secret"),
      "permission_denied",
    );
    expect(guest.hasAccess("/private/secret", 0b100)).toBe(false);
    expect(
      new CredentialedFilesystem(raw, rootCredentials).readFile(
        "/private/secret",
      ),
    ).toBe("classified");

    raw.writeFile("/open/public", "public");
    raw.createSymbolicLink("/private/bounce", "/open/double-hop");
    raw.createSymbolicLink("/open/public", "/private/bounce");
    raw.createSymbolicLink("/private/../open/public", "/open/lexical-hop");
    expectFilesystemError(
      () => guest.readFile("/open/double-hop"),
      "permission_denied",
    );
    expectFilesystemError(
      () => guest.readFile("/open/lexical-hop"),
      "permission_denied",
    );
    expectFilesystemError(
      () => guest.readFile("/private/../open/public"),
      "permission_denied",
    );
  });

  it("selects owner, supplementary-group, and other permission classes", (): void => {
    const raw = new InMemoryFilesystem();
    raw.makeDirectory("/shared");
    raw.writeFile("/shared/group-readable", "group");
    raw.setMetadata("/shared/group-readable", {
      gid: 77,
      mode: 0o640,
      uid: 2_000,
    });
    const groupMember = new CredentialedFilesystem(
      raw,
      createLoginCredentials({
        groupId: 1_001,
        loginName: "member",
        supplementaryGroupIds: [77],
        userId: 1_001,
      }),
    );
    const outsider = new CredentialedFilesystem(
      raw,
      createLoginCredentials({
        groupId: 1_002,
        loginName: "outsider",
        userId: 1_002,
      }),
    );

    expect(groupMember.readFile("/shared/group-readable")).toBe("group");
    expect(groupMember.hasAccess("/shared/group-readable", 0b010)).toBe(false);
    expectFilesystemError(
      () => outsider.readFile("/shared/group-readable"),
      "permission_denied",
    );
  });

  it("applies root DAC override without inventing execute permission", (): void => {
    const raw = new InMemoryFilesystem();
    raw.makeDirectory("/locked");
    raw.writeFile("/locked/data", "root-readable");
    raw.writeFile("/locked/program", "binary");
    raw.setMetadata("/locked", { gid: 2_000, mode: 0o000, uid: 2_000 });
    raw.setMetadata("/locked/data", { gid: 2_000, mode: 0o000, uid: 2_000 });
    raw.setMetadata("/locked/program", {
      gid: 2_000,
      mode: 0o000,
      uid: 2_000,
    });
    const root = new CredentialedFilesystem(raw, rootCredentials);

    expect(root.readFile("/locked/data")).toBe("root-readable");
    expect(root.hasAccess("/locked/program", 0b001)).toBe(false);
    raw.setMetadata("/locked/program", { mode: 0o001 });
    expect(root.hasAccess("/locked/program", 0b001)).toBe(true);
  });

  it("uses effective ownership and umask for every newly created entry", (): void => {
    const raw = writableHome();
    const guest = new CredentialedFilesystem(raw, initialUserCredentials);
    expect(guest.setUmask(0o027)).toBe(0o022);

    guest.makeDirectory("/home/cs/project/cache");
    guest.writeFile("/home/cs/project/value", "value");
    guest.createSymbolicLink("value", "/home/cs/project/value-link");

    expect(guest.getMetadata("/home/cs/project")).toMatchObject({
      gid: 1_000,
      mode: 0o750,
      uid: 1_000,
    });
    expect(guest.getMetadata("/home/cs/project/cache")).toMatchObject({
      gid: 1_000,
      mode: 0o750,
      uid: 1_000,
    });
    expect(guest.getMetadata("/home/cs/project/value")).toMatchObject({
      gid: 1_000,
      mode: 0o640,
      uid: 1_000,
    });
    expect(
      guest.getMetadata("/home/cs/project/value-link", false),
    ).toMatchObject({
      gid: 1_000,
      mode: 0o777,
      uid: 1_000,
    });
    expect(() =>
      guest.writeFile("/home/cs/project/invalid", "value", 0o10_000),
    ).toThrow(RangeError);
    expect(guest.exists("/home/cs/project/invalid")).toBe(false);

    const root = new CredentialedFilesystem(raw, rootCredentials);
    root.writeFile("/root-created", "root");
    expect(root.getMetadata("/root-created")).toMatchObject({ gid: 0, uid: 0 });
  });

  it("rolls back every newly created ancestor when recursive mkdir fails", (): void => {
    const raw = new InMemoryFilesystem({
      ...defaultFilesystemLimits,
      maxEntries: 3,
    });
    raw.makeDirectory("/home/cs");
    raw.setMetadata("/home", { gid: 0, mode: 0o755, uid: 0 });
    raw.setMetadata("/home/cs", { gid: 1_000, mode: 0o700, uid: 1_000 });
    const guest = new CredentialedFilesystem(raw, initialUserCredentials);

    expectFilesystemError(
      () => guest.makeDirectory("/home/cs/partial/final"),
      "entry_limit",
    );
    expect(raw.exists("/home/cs/partial")).toBe(false);
    expect(raw.exists("/home/cs/partial/final")).toBe(false);
  });

  it("enforces chmod, chown, chgrp, and csfs nosuid rules", (): void => {
    const raw = writableHome();
    const guest = new CredentialedFilesystem(raw, initialUserCredentials);
    const root = new CredentialedFilesystem(raw, rootCredentials);
    guest.writeFile("/home/cs/value", "value");

    guest.chmod("/home/cs/value", 0o6750);
    expect(guest.getMetadata("/home/cs/value").mode).toBe(0o750);
    expectFilesystemError(
      () => guest.chown("/home/cs/value", 2_000),
      "operation_not_permitted",
    );
    expectFilesystemError(
      () => guest.chgrp("/home/cs/value", 2_000),
      "operation_not_permitted",
    );
    guest.chgrp("/home/cs/value", 27);
    expect(guest.getMetadata("/home/cs/value").gid).toBe(27);
    root.chown("/home/cs/value", 2_000, 2_001);
    expect(root.getMetadata("/home/cs/value")).toMatchObject({
      gid: 2_001,
      uid: 2_000,
    });
    expectFilesystemError(
      () => guest.chmod("/home/cs/value", 0o600),
      "operation_not_permitted",
    );
  });

  it("enforces sticky deletion and checks recursive delete permissions", (): void => {
    const raw = new InMemoryFilesystem();
    raw.makeDirectory("/tmp");
    raw.setMetadata("/tmp", { gid: 0, mode: 0o1777, uid: 0 });
    const alice = userFilesystem(raw, "alice", 1_001);
    const bob = userFilesystem(raw, "bob", 1_002);
    alice.writeFile("/tmp/alice-file", "alice");
    bob.writeFile("/tmp/bob-file", "bob");

    expectFilesystemError(
      () => bob.delete("/tmp/alice-file"),
      "operation_not_permitted",
    );
    alice.delete("/tmp/alice-file");
    expect(alice.exists("/tmp/alice-file")).toBe(false);

    alice.makeDirectory("/tmp/tree");
    alice.writeFile("/tmp/tree/value", "value");
    alice.chmod("/tmp/tree", 0o500);
    expectFilesystemError(() => alice.delete("/tmp/tree"), "permission_denied");
    new CredentialedFilesystem(raw, rootCredentials).delete("/tmp/tree");
    expect(raw.exists("/tmp/tree")).toBe(false);
  });

  it("checks copy, move, hard-link, readlink, and stat boundaries", (): void => {
    const raw = writableHome();
    const guest = new CredentialedFilesystem(
      raw,
      initialUserCredentials,
      0o027,
    );
    guest.makeDirectory("/home/cs/source");
    guest.writeFile("/home/cs/source/value", "copy me", 0o666);
    guest.createSymbolicLink("value", "/home/cs/source/link");
    guest.copy("/home/cs/source", "/home/cs/copied");

    expect(guest.readFile("/home/cs/copied/value")).toBe("copy me");
    expect(guest.getMetadata("/home/cs/copied/value")).toMatchObject({
      gid: 1_000,
      mode: 0o640,
      uid: 1_000,
    });
    expect(guest.readLink("/home/cs/copied/link")).toBe("value");
    expect(guest.stat("/home/cs/copied/link", false).kind).toBe(
      "symbolic_link",
    );
    expect(guest.stat("/home/cs/copied/link").kind).toBe("file");
    guest.createHardLink("/home/cs/copied/value", "/home/cs/copied/value-hard");
    expect(guest.getLinkCount("/home/cs/copied/value")).toBe(2);
    guest.move("/home/cs/copied/value-hard", "/home/cs/value-moved");
    expect(guest.readFile("/home/cs/value-moved")).toBe("copy me");

    raw.writeFile("/root-owned", "root");
    raw.setMetadata("/root-owned", { gid: 0, mode: 0o644, uid: 0 });
    expectFilesystemError(
      () => guest.createHardLink("/root-owned", "/home/cs/root-hard"),
      "operation_not_permitted",
    );
  });

  it("keeps the account database writable only through account commands", (): void => {
    const raw = new InMemoryFilesystem();
    raw.makeDirectory("/etc");
    raw.writeFile("/etc/passwd", "root:x:0:0:root:/root:/bin/bash\n");
    raw.writeFile("/etc/group", "root:x:0:\n");
    raw.writeFile("/etc/shadow", "root:!\n");
    raw.setMetadata("/etc/passwd", { gid: 0, mode: 0o644, uid: 0 });
    raw.setMetadata("/etc/group", { gid: 0, mode: 0o644, uid: 0 });
    raw.setMetadata("/etc/shadow", { gid: 0, mode: 0o600, uid: 0 });
    raw.writeFile("/source", "replacement");
    const root = new CredentialedFilesystem(raw, rootCredentials);

    for (const operation of [
      (): void => root.writeFile("/etc/passwd", "replacement"),
      (): void => root.appendFile("/etc/group", "wheel:x:10:root\n"),
      (): void => root.delete("/etc/shadow"),
      (): void => root.move("/etc/passwd", "/tmp-passwd"),
      (): void => root.copy("/source", "/etc/passwd"),
      (): void => root.chmod("/etc/shadow", 0o644),
      (): void => root.setModifiedTime("/etc/passwd", 1),
      (): void => root.createHardLink("/etc/passwd", "/passwd-hard"),
      (): void => root.delete("/etc"),
      (): void => root.delete("/"),
      (): void => root.move("/", "/old-root"),
      (): void => root.chmod("/etc", 0o700),
    ]) {
      expectFilesystemError(operation, "operation_not_permitted");
    }

    root.createSymbolicLink("/etc/passwd", "/passwd-link");
    expectFilesystemError(
      () => root.writeFile("/passwd-link", "replacement"),
      "operation_not_permitted",
    );
    root.writeFile("/etc/profile", "export PATH=/bin\n");
    expect(raw.readFile("/etc/profile")).toBe("export PATH=/bin\n");
    expect(raw.readFile("/etc/passwd")).toBe(
      "root:x:0:0:root:/root:/bin/bash\n",
    );
  });

  it("provides a DOS/trusted view without Linux DAC checks", (): void => {
    const raw = new InMemoryFilesystem();
    raw.makeDirectory("/system");
    raw.writeFile("/system/value", "trusted");
    raw.setMetadata("/system", { gid: 0, mode: 0o000, uid: 0 });
    raw.setMetadata("/system/value", { gid: 0, mode: 0o000, uid: 0 });
    const trusted = new UnrestrictedGuestFilesystem(raw);

    expect(trusted.readFile("/system/value")).toBe("trusted");
    trusted.writeFile("/system/new", "allowed");
    expect(raw.readFile("/system/new")).toBe("allowed");
  });
});

function expectFilesystemError(operation: () => unknown, code: string): void {
  try {
    operation();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(FilesystemError);
    expect((error as FilesystemError).code).toBe(code);
    return;
  }
  throw new Error(`Expected FilesystemError with code ${code}`);
}

function userFilesystem(
  filesystem: InMemoryFilesystem,
  loginName: string,
  id: number,
): CredentialedFilesystem {
  return new CredentialedFilesystem(
    filesystem,
    createLoginCredentials({ groupId: id, loginName, userId: id }),
  );
}

function writableHome(): InMemoryFilesystem {
  const filesystem = new InMemoryFilesystem();
  filesystem.makeDirectory("/home/cs");
  filesystem.setMetadata("/home", { gid: 0, mode: 0o755, uid: 0 });
  filesystem.setMetadata("/home/cs", {
    gid: 1_000,
    mode: 0o750,
    uid: 1_000,
  });
  return filesystem;
}
