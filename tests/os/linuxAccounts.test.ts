import { describe, expect, it } from "vitest";

import {
  initialLinuxAccount,
  LinuxAccountCommitError,
  LinuxAccountDatabaseError,
  linuxAccountLimits,
  linuxAccountPaths,
  migrateLinuxAccountDatabase,
  openLinuxAccountDatabase,
} from "../../src/application/os/linuxAccounts.js";
import { LinuxAuthentication } from "../../src/application/os/linuxAuthentication.js";
import {
  InMemoryFilesystem,
  type FilesystemLimits,
} from "../../src/domain/filesystem/inMemoryFilesystem.js";

const legacyPasswordPayload = `cs-sha256-v1:512:fixed-test-salt-01:${"a".repeat(64)}`;

describe("CS-Linux account database", (): void => {
  it("initializes a bounded cs administrator, locked root, and sudo group", (): void => {
    const filesystem = accountFilesystem();
    const database = migrateLinuxAccountDatabase(filesystem);

    expect(database.listUsers()).toEqual([
      {
        gecos: "root",
        gid: 0,
        home: "/root",
        name: "root",
        shell: "/bin/bash",
        uid: 0,
      },
      {
        gecos: "Computer System administrator",
        gid: 1_000,
        home: "/home/cs",
        name: "cs",
        shell: "/bin/bash",
        uid: 1_000,
      },
    ]);
    expect(database.getUserByUid(1_000)?.name).toBe("cs");
    expect(database.getGroupByGid(27)).toEqual({
      gid: 27,
      members: ["cs"],
      name: "sudo",
    });
    expect(database.getShadowRecord("root")?.state).toBe("locked");
    expect(database.getShadowRecord("cs")?.state).toBe("unset");
    expect(database.groupsForUser("cs").map((group) => group.name)).toEqual([
      "cs",
      "sudo",
    ]);
    expect(database.allocateUid()).toBe(1_001);
    expect(database.allocateGid()).toBe(1_001);
    expect(filesystem.readFile(linuxAccountPaths.passwd)).toContain(
      "cs:x:1000:1000:Computer System administrator:/home/cs:/bin/bash\n",
    );
    expect(filesystem.readFile(linuxAccountPaths.group)).toContain(
      "sudo:x:27:cs\n",
    );
    expect(filesystem.readFile(linuxAccountPaths.shadow)).toBe(
      "root:!\ncs:!!\n",
    );
    expect(filesystem.getMetadata(linuxAccountPaths.passwd)).toMatchObject({
      gid: 0,
      mode: 0o644,
      uid: 0,
    });
    expect(filesystem.getMetadata(linuxAccountPaths.shadow)).toMatchObject({
      gid: 0,
      mode: 0o600,
      uid: 0,
    });

    expect(openLinuxAccountDatabase(filesystem).getUser("cs")?.home).toBe(
      initialLinuxAccount.home,
    );
  });

  it("fully renames the legacy computer account while preserving its hash and IDs", (): void => {
    const filesystem = legacyAccountFilesystem();
    const legacyLine = `computer:${legacyPasswordPayload}`;
    filesystem.writeFile(linuxAccountPaths.shadow, `${legacyLine}\n`);
    filesystem.setMetadata(linuxAccountPaths.shadow, {
      gid: 0,
      mode: 0o600,
      uid: 0,
    });

    const database = migrateLinuxAccountDatabase(filesystem);
    const passwd = filesystem.readFile(linuxAccountPaths.passwd);
    const group = filesystem.readFile(linuxAccountPaths.group);
    const shadow = filesystem.readFile(linuxAccountPaths.shadow);

    expect(database.getUser("computer")).toBeUndefined();
    expect(database.getGroup("computer")).toBeUndefined();
    expect(database.getShadowRecord("computer")).toBeUndefined();
    expect(database.getUser("cs")).toMatchObject({ gid: 1_000, uid: 1_000 });
    expect(database.getPasswordRecord("cs")).toBe(
      `cs:${legacyPasswordPayload}`,
    );
    expect(passwd).not.toContain("computer");
    expect(passwd).not.toContain("/home/computer");
    expect(passwd).toContain("cs:x:1000:1000:");
    expect(passwd).toContain(":/home/cs:/bin/bash\n");
    expect(group).not.toContain("computer");
    expect(group).toContain("cs:x:1000:cs\n");
    expect(group).toContain("sudo:x:27:cs\n");
    expect(shadow).not.toContain(legacyLine);
    expect(shadow).toContain(`cs:${legacyPasswordPayload}\n`);
    expect(shadow).toContain("root:!\n");
  });

  it("adds unset credentials on a legacy first boot without inventing a password", (): void => {
    const filesystem = legacyAccountFilesystem();

    const database = migrateLinuxAccountDatabase(filesystem);

    expect(database.getShadowRecord("root")).toMatchObject({
      password: "!",
      state: "locked",
    });
    expect(database.getShadowRecord("cs")).toMatchObject({
      password: "!!",
      state: "unset",
    });
  });

  it("finishes a partially migrated account set without losing the legacy hash", (): void => {
    const filesystem = accountFilesystem();
    filesystem.writeFile(
      linuxAccountPaths.passwd,
      "root:x:0:0:root:/root:/bin/bash\ncs:x:1000:1000:Computer System administrator:/home/cs:/bin/bash\n",
    );
    filesystem.writeFile(
      linuxAccountPaths.group,
      "root:x:0:\ncs:x:1000:computer\n",
    );
    filesystem.writeFile(
      linuxAccountPaths.shadow,
      `computer:${legacyPasswordPayload}\n`,
    );

    const database = migrateLinuxAccountDatabase(filesystem);

    expect(database.getPasswordRecord("cs")).toBe(
      `cs:${legacyPasswordPayload}`,
    );
    expect(filesystem.readFile(linuxAccountPaths.group)).toContain(
      "cs:x:1000:cs\n",
    );
    expect(filesystem.readFile(linuxAccountPaths.shadow)).not.toContain(
      "computer:",
    );
  });

  it("persists user, group, membership, rename, and password administration", (): void => {
    const filesystem = accountFilesystem();
    const database = migrateLinuxAccountDatabase(filesystem);

    expect(database.createGroup({ name: "developers" })).toMatchObject({
      gid: 1_001,
      name: "developers",
    });
    expect(
      database.createUser({
        gecos: "Alice Example",
        name: "alice",
        primaryGroup: "developers",
        supplementaryGroups: ["sudo"],
      }),
    ).toMatchObject({
      gid: 1_001,
      home: "/home/alice",
      uid: 1_001,
    });
    expect(database.createUser({ name: "bob" })).toMatchObject({
      gid: 1_002,
      uid: 1_002,
    });
    expect(database.getGroup("bob")?.members).toEqual(["bob"]);

    expect(
      database.updateUser("alice", {
        home: "/srv/alicia",
        name: "alicia",
        supplementaryGroups: ["developers"],
        uid: 2_001,
      }),
    ).toMatchObject({ home: "/srv/alicia", name: "alicia", uid: 2_001 });
    expect(database.getGroup("sudo")?.members).not.toContain("alicia");
    expect(database.getGroup("developers")?.members).toContain("alicia");
    expect(
      database.updateGroup("developers", { gid: 2_000, name: "engineering" }),
    ).toMatchObject({ gid: 2_000, name: "engineering" });
    expect(database.getUser("alicia")?.gid).toBe(2_000);

    expect(
      database.setPasswordRecord("alicia", `alicia:${legacyPasswordPayload}`),
    ).toMatchObject({ password: legacyPasswordPayload, state: "hash" });
    expect(database.lockPassword("alicia").state).toBe("locked");
    expect(database.markPasswordUnset("alicia").state).toBe("unset");

    database.deleteUser("bob", { removePrimaryGroup: true });
    expect(database.getUser("bob")).toBeUndefined();
    expect(database.getGroup("bob")).toBeUndefined();
    database.deleteUser("alicia");
    database.deleteGroup("engineering");

    const reopened = openLinuxAccountDatabase(filesystem);
    expect(reopened.listUsers().map((user) => user.name)).toEqual([
      "root",
      "cs",
    ]);
    expect(reopened.getGroup("engineering")).toBeUndefined();
  });

  it("protects root, sudo, IDs, referential integrity, and record syntax", (): void => {
    const filesystem = accountFilesystem();
    const database = migrateLinuxAccountDatabase(filesystem);

    expectAccountError(() => database.deleteUser("root"), "protected");
    expectAccountError(() => database.deleteGroup("sudo"), "protected");
    expectAccountError(
      () => database.createUser({ name: "Bad.Name" }),
      "invalid",
    );
    expectAccountError(
      () => database.createUser({ name: "zero", uid: 0 }),
      "protected",
    );
    expectAccountError(
      () => database.createGroup({ gid: 27, name: "wheel" }),
      "conflict",
    );
    expectAccountError(
      () => database.createUser({ name: "alice", primaryGroup: "missing" }),
      "not_found",
    );
    expectAccountError(
      () => database.setPasswordRecord("cs", "wrong:record"),
      "invalid",
    );
    expectAccountError(
      () => database.createUser({ name: "computer" }),
      "protected",
    );
    expectAccountError(
      () => database.createGroup({ name: "computer" }),
      "protected",
    );
    expectAccountError(
      () => database.updateUser("cs", { name: "computer" }),
      "protected",
    );
    expectAccountError(
      () => database.updateGroup("cs", { name: "computer" }),
      "protected",
    );
    expect(openLinuxAccountDatabase(filesystem).getUser("cs")?.uid).toBe(1_000);
  });

  it("caps each user at 32 supplementary groups without partial commits", (): void => {
    const filesystem = accountFilesystem();
    const database = migrateLinuxAccountDatabase(filesystem);
    const groupNames = Array.from(
      { length: linuxAccountLimits.maximumSupplementaryGroupsPerUser + 1 },
      (_, index) => `extra${String(index + 1)}`,
    );
    for (const name of groupNames) database.createGroup({ name });

    database.updateUser("cs", {
      supplementaryGroups: groupNames.slice(
        0,
        linuxAccountLimits.maximumSupplementaryGroupsPerUser,
      ),
    });
    const before = accountContents(filesystem);
    expectAccountError(
      () => database.updateUser("cs", { supplementaryGroups: groupNames }),
      "limit",
    );
    expect(accountContents(filesystem)).toEqual(before);

    const reopened = openLinuxAccountDatabase(filesystem);
    expect(reopened.groupsForUser("cs")).toHaveLength(
      linuxAccountLimits.maximumSupplementaryGroupsPerUser + 1,
    );
    expect(
      new LinuxAuthentication(reopened, { enabled: false }).credentials
        ?.supplementaryGroupIds,
    ).toHaveLength(linuxAccountLimits.maximumSupplementaryGroupsPerUser);
  });

  it("fails closed on malformed, oversized, linked, or unsafe account files", (): void => {
    const malformed = accountFilesystem();
    malformed.writeFile(
      linuxAccountPaths.passwd,
      "root:x:0:0:root:/root:/bin/bash\ncs:x:1000:1000:cs:/home/cs:/bin/bash\n",
    );
    malformed.writeFile(
      linuxAccountPaths.group,
      "root:x:0:\ncs:x:1000:cs\nsudo:x:27:ghost\n",
    );
    malformed.writeFile(linuxAccountPaths.shadow, "root:!\ncs:!!\n");
    secureAccountMetadata(malformed);
    const before = accountContents(malformed);
    expectAccountError(() => migrateLinuxAccountDatabase(malformed), "invalid");
    expect(accountContents(malformed)).toEqual(before);

    const oversized = legacyAccountFilesystem({
      capacityBytes: 128 * 1_024,
      maxEntries: 64,
      maxFileBytes: 64 * 1_024,
      maxPathLength: 255,
    });
    oversized.writeFile(
      linuxAccountPaths.passwd,
      "x".repeat(linuxAccountLimits.maximumFileBytes.passwd + 1),
    );
    expectAccountError(
      () => migrateLinuxAccountDatabase(oversized),
      "unavailable",
    );

    const linked = legacyAccountFilesystem();
    linked.createHardLink(linuxAccountPaths.passwd, "/etc/passwd-copy");
    expectAccountError(
      () => migrateLinuxAccountDatabase(linked),
      "unavailable",
    );

    const unsafe = accountFilesystem();
    migrateLinuxAccountDatabase(unsafe);
    unsafe.setMetadata(linuxAccountPaths.shadow, { mode: 0o644 });
    expectAccountError(() => openLinuxAccountDatabase(unsafe), "unavailable");
  });

  it("detects stale database handles instead of overwriting newer accounts", (): void => {
    const filesystem = accountFilesystem();
    migrateLinuxAccountDatabase(filesystem);
    const first = openLinuxAccountDatabase(filesystem);
    const stale = openLinuxAccountDatabase(filesystem);

    first.createGroup({ name: "first" });
    expectAccountError(() => stale.createGroup({ name: "stale" }), "stale");
    expect(
      openLinuxAccountDatabase(filesystem).getGroup("first"),
    ).toBeDefined();
    expect(
      openLinuxAccountDatabase(filesystem).getGroup("stale"),
    ).toBeUndefined();
  });

  it("preflights aggregate account growth before making any write", (): void => {
    const filesystem = accountFilesystem({
      capacityBytes: 1_024,
      maxEntries: 64,
      maxFileBytes: 1_024,
      maxPathLength: 255,
    });
    const database = migrateLinuxAccountDatabase(filesystem);
    filesystem.writeFile("/filler", "x".repeat(filesystem.getFreeSpace() - 1));
    const before = accountContents(filesystem);

    expectAccountError(
      () => database.createUser({ name: "alice" }),
      "capacity",
    );
    expect(accountContents(filesystem)).toEqual(before);
    expect(database.getUser("alice")).toBeUndefined();
  });

  it("restores only bounded account files after a mid-commit failure", (): void => {
    const filesystem = new InjectedFailureFilesystem();
    filesystem.makeDirectory("/etc");
    const database = migrateLinuxAccountDatabase(filesystem);
    const before = accountState(filesystem);
    filesystem.failWrites(2);

    let failure: unknown;
    try {
      database.createUser({ name: "alice" });
    } catch (error: unknown) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(LinuxAccountCommitError);
    expect(failure).toMatchObject({
      code: "commit_failed",
      rollbackFailed: false,
    });
    expect(accountState(filesystem)).toEqual(before);
    expect(database.getUser("alice")).toBeUndefined();
    expect(
      openLinuxAccountDatabase(filesystem).getUser("alice"),
    ).toBeUndefined();
  });

  it("reports rollback failure as an explicit terminal account error", (): void => {
    const filesystem = new InjectedFailureFilesystem();
    filesystem.makeDirectory("/etc");
    const database = migrateLinuxAccountDatabase(filesystem);
    filesystem.failWrites(2, 3);

    let failure: unknown;
    try {
      database.createUser({ name: "alice" });
    } catch (error: unknown) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(LinuxAccountCommitError);
    expect(failure).toMatchObject({
      code: "rollback_failed",
      rollbackFailed: true,
    });
    expect(database.getUser("alice")).toBeUndefined();
  });
});

class InjectedFailureFilesystem extends InMemoryFilesystem {
  private operationWrite = 0;
  private failingWrites = new Set<number>();

  failWrites(...writes: readonly number[]): void {
    this.operationWrite = 0;
    this.failingWrites = new Set(writes);
  }

  override writeFile(path: string, contents: string): void {
    this.operationWrite += 1;
    if (this.failingWrites.has(this.operationWrite))
      throw new Error(`injected write failure ${String(this.operationWrite)}`);
    super.writeFile(path, contents);
  }
}

function accountFilesystem(limits?: FilesystemLimits): InMemoryFilesystem {
  const filesystem = new InMemoryFilesystem(limits);
  filesystem.makeDirectory("/etc");
  return filesystem;
}

function legacyAccountFilesystem(
  limits?: FilesystemLimits,
): InMemoryFilesystem {
  const filesystem = accountFilesystem(limits);
  filesystem.writeFile(
    linuxAccountPaths.passwd,
    "root:x:0:0:root:/root:/bin/bash\ncomputer:x:1000:1000:Computer System administrator:/home/computer:/bin/bash\n",
  );
  filesystem.writeFile(
    linuxAccountPaths.group,
    "root:x:0:\ncomputer:x:1000:computer\n",
  );
  filesystem.setMetadata(linuxAccountPaths.passwd, {
    gid: 0,
    mode: 0o644,
    uid: 0,
  });
  filesystem.setMetadata(linuxAccountPaths.group, {
    gid: 0,
    mode: 0o644,
    uid: 0,
  });
  return filesystem;
}

function secureAccountMetadata(filesystem: InMemoryFilesystem): void {
  filesystem.setMetadata(linuxAccountPaths.passwd, {
    gid: 0,
    mode: 0o644,
    uid: 0,
  });
  filesystem.setMetadata(linuxAccountPaths.group, {
    gid: 0,
    mode: 0o644,
    uid: 0,
  });
  filesystem.setMetadata(linuxAccountPaths.shadow, {
    gid: 0,
    mode: 0o600,
    uid: 0,
  });
}

function accountContents(
  filesystem: InMemoryFilesystem,
): Record<string, string> {
  return {
    group: filesystem.readFile(linuxAccountPaths.group),
    passwd: filesystem.readFile(linuxAccountPaths.passwd),
    shadow: filesystem.readFile(linuxAccountPaths.shadow),
  };
}

function accountState(filesystem: InMemoryFilesystem): unknown {
  return {
    contents: accountContents(filesystem),
    metadata: {
      group: filesystem.getMetadata(linuxAccountPaths.group),
      passwd: filesystem.getMetadata(linuxAccountPaths.passwd),
      shadow: filesystem.getMetadata(linuxAccountPaths.shadow),
    },
  };
}

function expectAccountError(
  action: () => unknown,
  code: LinuxAccountDatabaseError["code"],
): void {
  let failure: unknown;
  try {
    action();
  } catch (error: unknown) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(LinuxAccountDatabaseError);
  expect(failure).toMatchObject({ code });
}
