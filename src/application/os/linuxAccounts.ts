import type {
  FilesystemMetadata,
  InMemoryFilesystem,
} from "../../domain/filesystem/inMemoryFilesystem.js";
import { utf8ByteLength } from "../../domain/text/utf8.js";

export const linuxAccountPaths = Object.freeze({
  group: "/etc/group",
  passwd: "/etc/passwd",
  shadow: "/etc/shadow",
});

export const linuxAccountLimits = Object.freeze({
  maximumFileBytes: Object.freeze({
    group: 16_384,
    passwd: 16_384,
    shadow: 24_576,
  }),
  maximumGroups: 128,
  maximumLineBytes: 512,
  maximumMembersPerGroup: 64,
  maximumNormalId: 60_000,
  maximumSupplementaryGroupsPerUser: 32,
  maximumTotalMemberships: 1_024,
  maximumUsers: 128,
  minimumNormalId: 1_001,
});

export const initialLinuxAccount = Object.freeze({
  gid: 1_000,
  group: "cs",
  home: "/home/cs",
  shell: "/bin/bash",
  uid: 1_000,
  username: "cs",
});

export const rootLinuxAccount = Object.freeze({
  gid: 0,
  group: "root",
  home: "/root",
  shell: "/bin/bash",
  uid: 0,
  username: "root",
});

export const sudoLinuxGroup = Object.freeze({ gid: 27, name: "sudo" });

const passwordAlgorithm = "cs-sha256-v1";
const passwordRounds = 512;
const accountFileOrder = ["passwd", "group", "shadow"] as const;
const accountFileMetadata = Object.freeze({
  group: Object.freeze({ gid: 0, mode: 0o644, uid: 0 }),
  passwd: Object.freeze({ gid: 0, mode: 0o644, uid: 0 }),
  shadow: Object.freeze({ gid: 0, mode: 0o600, uid: 0 }),
});

type AccountFileName = (typeof accountFileOrder)[number];

export type LinuxAccountErrorCode =
  | "capacity"
  | "commit_failed"
  | "conflict"
  | "exists"
  | "invalid"
  | "limit"
  | "not_found"
  | "protected"
  | "rollback_failed"
  | "stale"
  | "unavailable";

export class LinuxAccountDatabaseError extends Error {
  constructor(
    readonly code: LinuxAccountErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LinuxAccountDatabaseError";
  }
}

export class LinuxAccountCommitError extends LinuxAccountDatabaseError {
  readonly rollbackFailed: boolean;

  constructor(
    code: "commit_failed" | "rollback_failed",
    message: string,
    readonly commitCause: unknown,
    readonly rollbackCause?: unknown,
  ) {
    super(code, message);
    this.name = "LinuxAccountCommitError";
    this.rollbackFailed = code === "rollback_failed";
  }
}

export interface LinuxUserRecord {
  readonly gecos: string;
  readonly gid: number;
  readonly home: string;
  readonly name: string;
  readonly shell: string;
  readonly uid: number;
}

export interface LinuxGroupRecord {
  readonly gid: number;
  readonly members: readonly string[];
  readonly name: string;
}

export type LinuxPasswordState = "hash" | "locked" | "unset";

export interface LinuxShadowRecord {
  /** The credential payload without the leading `username:` field. */
  readonly password: string;
  readonly state: LinuxPasswordState;
  readonly username: string;
}

export interface CreateLinuxUserOptions {
  readonly gecos?: string;
  readonly home?: string;
  readonly name: string;
  /** An existing primary group. A private group is created when omitted. */
  readonly primaryGroup?: string;
  readonly shell?: string;
  readonly supplementaryGroups?: readonly string[];
  readonly uid?: number;
  /** A payload or a complete `username:payload` record. Defaults to unset. */
  readonly passwordRecord?: string;
}

export interface UpdateLinuxUserOptions {
  readonly gecos?: string;
  readonly home?: string;
  readonly name?: string;
  readonly primaryGroup?: string;
  readonly shell?: string;
  readonly supplementaryGroups?: readonly string[];
  readonly uid?: number;
}

export interface CreateLinuxGroupOptions {
  readonly gid?: number;
  readonly members?: readonly string[];
  readonly name: string;
}

export interface UpdateLinuxGroupOptions {
  readonly gid?: number;
  readonly members?: readonly string[];
  readonly name?: string;
}

interface MutableLinuxUserRecord {
  gecos: string;
  gid: number;
  home: string;
  name: string;
  shell: string;
  uid: number;
}

interface MutableLinuxGroupRecord {
  gid: number;
  members: string[];
  name: string;
}

interface MutableLinuxShadowRecord {
  password: string;
  state: LinuxPasswordState;
  username: string;
}

interface AccountState {
  readonly groups: Map<string, MutableLinuxGroupRecord>;
  readonly shadow: Map<string, MutableLinuxShadowRecord>;
  readonly users: Map<string, MutableLinuxUserRecord>;
}

type AccountFileContents = Record<AccountFileName, string>;

interface AccountFileBackup {
  readonly contents?: string;
  readonly metadata?: FilesystemMetadata;
  readonly name: AccountFileName;
  readonly path: string;
}

/**
 * Bounded, Map-indexed view of the three persistent CS-Linux account files.
 * Mutations validate a complete draft before replacing any file.
 */
export class LinuxAccountDatabase {
  private usersByUid = new Map<number, MutableLinuxUserRecord>();
  private groupsByGid = new Map<number, MutableLinuxGroupRecord>();

  private constructor(
    private readonly filesystem: InMemoryFilesystem,
    private state: AccountState,
    private sourceFiles: AccountFileContents,
  ) {
    this.rebuildIndexes();
  }

  /** Opens an already-current database without repairing malformed state. */
  static open(filesystem: InMemoryFilesystem): LinuxAccountDatabase {
    const files = readRequiredAccountFiles(filesystem);
    validateAccountFileMetadata(filesystem);
    return new LinuxAccountDatabase(
      filesystem,
      parseAccountFiles(files),
      files,
    );
  }

  /**
   * Initializes a new database or performs the recognized `computer` -> `cs`
   * single-user migration. Any other partial or malformed state fails closed.
   */
  static migrate(filesystem: InMemoryFilesystem): LinuxAccountDatabase {
    const captured = captureAccountFiles(filesystem);
    const present = new Set(
      captured
        .filter((entry) => entry.contents !== undefined)
        .map((entry) => entry.name),
    );

    if (present.size === 0) {
      const state = initialAccountState();
      const files = serializeAccountState(state);
      writeAccountFilesAtomically(filesystem, files, undefined);
      return new LinuxAccountDatabase(filesystem, state, files);
    }
    if (!present.has("passwd") || !present.has("group")) {
      unavailable("CS-Linux account database is incomplete");
    }

    const passwd = captured.find((entry) => entry.name === "passwd")!.contents!;
    const group = captured.find((entry) => entry.name === "group")!.contents!;
    const shadow = captured.find((entry) => entry.name === "shadow")?.contents;
    const state: AccountState = {
      groups: parseGroupFile(group),
      shadow:
        shadow === undefined
          ? new Map<string, MutableLinuxShadowRecord>()
          : parseShadowFile(shadow),
      users: parsePasswdFile(passwd),
    };
    const migratedLegacyName = migrateLegacyComputerName(state);
    const recognizedBootstrap = isRecognizedBootstrapState(state);

    if (migratedLegacyName || recognizedBootstrap) {
      completeBootstrapState(state);
      validateAccountState(state);
      const files = serializeAccountState(state);
      writeAccountFilesAtomically(filesystem, files, undefined);
      return new LinuxAccountDatabase(filesystem, state, files);
    }

    if (shadow === undefined) {
      unavailable("CS-Linux shadow database is missing");
    }
    validateAccountState(state);
    validateAccountFileMetadata(filesystem);
    const files = { group, passwd, shadow };
    return new LinuxAccountDatabase(filesystem, state, files);
  }

  listUsers(): readonly LinuxUserRecord[] {
    return [...this.state.users.values()].map(publicUser);
  }

  listGroups(): readonly LinuxGroupRecord[] {
    return [...this.state.groups.values()].map(publicGroup);
  }

  listShadowRecords(): readonly LinuxShadowRecord[] {
    return [...this.state.shadow.values()].map(publicShadow);
  }

  getUser(name: string): LinuxUserRecord | undefined {
    const record = this.state.users.get(name);
    return record === undefined ? undefined : publicUser(record);
  }

  getUserByUid(uid: number): LinuxUserRecord | undefined {
    const record = this.usersByUid.get(uid);
    return record === undefined ? undefined : publicUser(record);
  }

  getGroup(name: string): LinuxGroupRecord | undefined {
    const record = this.state.groups.get(name);
    return record === undefined ? undefined : publicGroup(record);
  }

  getGroupByGid(gid: number): LinuxGroupRecord | undefined {
    const record = this.groupsByGid.get(gid);
    return record === undefined ? undefined : publicGroup(record);
  }

  getShadowRecord(username: string): LinuxShadowRecord | undefined {
    const record = this.state.shadow.get(username);
    return record === undefined ? undefined : publicShadow(record);
  }

  /** Returns the complete persisted shadow line without its trailing newline. */
  getPasswordRecord(username: string): string | undefined {
    const record = this.state.shadow.get(username);
    return record === undefined
      ? undefined
      : `${record.username}:${record.password}`;
  }

  groupsForUser(username: string): readonly LinuxGroupRecord[] {
    const user = requireUser(this.state, username);
    return [...this.state.groups.values()]
      .filter(
        (group) => group.gid === user.gid || group.members.includes(username),
      )
      .map(publicGroup);
  }

  allocateUid(): number {
    return allocateNormalId(new Set(this.usersByUid.keys()), "UID");
  }

  allocateGid(): number {
    return allocateNormalId(new Set(this.groupsByGid.keys()), "GID");
  }

  createUser(options: CreateLinuxUserOptions): LinuxUserRecord {
    const state = cloneState(this.state);
    validateName(options.name, "user");
    if (state.users.has(options.name))
      problem("exists", `user ${options.name} already exists`);
    if (state.users.size >= linuxAccountLimits.maximumUsers)
      problem("limit", "user account limit reached");

    const uid = options.uid ?? allocateNormalId(userIds(state), "UID");
    validateId(uid, "UID");
    if (uid === 0) problem("protected", "UID 0 is reserved for root");
    if ([...state.users.values()].some((user) => user.uid === uid))
      problem("conflict", `UID ${String(uid)} is already in use`);

    let primaryGroup: MutableLinuxGroupRecord;
    if (options.primaryGroup !== undefined) {
      primaryGroup = requireGroup(state, options.primaryGroup);
    } else {
      const existing = state.groups.get(options.name);
      if (existing !== undefined) primaryGroup = existing;
      else {
        if (state.groups.size >= linuxAccountLimits.maximumGroups)
          problem("limit", "group account limit reached");
        const usedGids = groupIds(state);
        const gid =
          uid >= linuxAccountLimits.minimumNormalId && !usedGids.has(uid)
            ? uid
            : allocateNormalId(usedGids, "GID");
        primaryGroup = { gid, members: [options.name], name: options.name };
        state.groups.set(primaryGroup.name, primaryGroup);
      }
    }

    const user: MutableLinuxUserRecord = {
      gecos: options.gecos ?? "",
      gid: primaryGroup.gid,
      home: options.home ?? `/home/${options.name}`,
      name: options.name,
      shell: options.shell ?? "/bin/bash",
      uid,
    };
    state.users.set(user.name, user);
    state.shadow.set(
      user.name,
      parseShadowRecordInput(user.name, options.passwordRecord ?? "!!"),
    );
    for (const groupName of uniqueNames(options.supplementaryGroups ?? [])) {
      const supplementary = requireGroup(state, groupName);
      if (!supplementary.members.includes(user.name))
        supplementary.members.push(user.name);
    }
    this.commit(state);
    return this.getUser(user.name)!;
  }

  deleteUser(
    username: string,
    options: { readonly removePrimaryGroup?: boolean } = {},
  ): void {
    if (username === rootLinuxAccount.username)
      problem("protected", "root account cannot be deleted");
    const state = cloneState(this.state);
    const user = requireUser(state, username);
    state.users.delete(username);
    state.shadow.delete(username);
    for (const group of state.groups.values()) {
      group.members = group.members.filter((member) => member !== username);
    }
    if (options.removePrimaryGroup === true) {
      const group = state.groups.get(username);
      if (group !== undefined && group.gid === user.gid) {
        if (
          [...state.users.values()].some(
            (candidate) => candidate.gid === group.gid,
          )
        )
          problem("conflict", `group ${username} is still a primary group`);
        state.groups.delete(username);
      }
    }
    this.commit(state);
  }

  updateUser(
    username: string,
    update: UpdateLinuxUserOptions,
  ): LinuxUserRecord {
    const state = cloneState(this.state);
    const current = requireUser(state, username);
    const nextName = update.name ?? current.name;
    const nextUid = update.uid ?? current.uid;
    validateName(nextName, "user");
    validateId(nextUid, "UID");
    if (username === rootLinuxAccount.username) {
      if (nextName !== rootLinuxAccount.username || nextUid !== 0)
        problem("protected", "root identity cannot be changed");
      if (update.primaryGroup !== undefined && update.primaryGroup !== "root")
        problem("protected", "root primary group cannot be changed");
    } else if (nextUid === 0) {
      problem("protected", "UID 0 is reserved for root");
    }
    if (nextName !== username && state.users.has(nextName))
      problem("exists", `user ${nextName} already exists`);
    if (
      [...state.users.values()].some(
        (user) => user.name !== username && user.uid === nextUid,
      )
    )
      problem("conflict", `UID ${String(nextUid)} is already in use`);

    const primaryGroup =
      update.primaryGroup === undefined
        ? requireGroupByGid(state, current.gid)
        : requireGroup(state, update.primaryGroup);
    const updated: MutableLinuxUserRecord = {
      gecos: update.gecos ?? current.gecos,
      gid: primaryGroup.gid,
      home: update.home ?? current.home,
      name: nextName,
      shell: update.shell ?? current.shell,
      uid: nextUid,
    };
    replaceMapEntry(state.users, username, nextName, updated);
    const shadow = state.shadow.get(username)!;
    replaceMapEntry(state.shadow, username, nextName, {
      ...shadow,
      username: nextName,
    });
    for (const group of state.groups.values()) {
      group.members = group.members.map((member) =>
        member === username ? nextName : member,
      );
    }
    if (update.supplementaryGroups !== undefined) {
      const selected = new Set(uniqueNames(update.supplementaryGroups));
      for (const groupName of selected) requireGroup(state, groupName);
      for (const group of state.groups.values()) {
        group.members = group.members.filter((member) => member !== nextName);
        if (selected.has(group.name)) group.members.push(nextName);
      }
    }
    this.commit(state);
    return this.getUser(nextName)!;
  }

  createGroup(options: CreateLinuxGroupOptions): LinuxGroupRecord {
    const state = cloneState(this.state);
    validateName(options.name, "group");
    if (state.groups.has(options.name))
      problem("exists", `group ${options.name} already exists`);
    if (state.groups.size >= linuxAccountLimits.maximumGroups)
      problem("limit", "group account limit reached");
    const gid = options.gid ?? allocateNormalId(groupIds(state), "GID");
    validateId(gid, "GID");
    if ([...state.groups.values()].some((group) => group.gid === gid))
      problem("conflict", `GID ${String(gid)} is already in use`);
    if (gid === 0) problem("protected", "GID 0 is reserved for root");
    if (gid === sudoLinuxGroup.gid)
      problem("protected", `GID ${String(gid)} is reserved for sudo`);
    const members = uniqueNames(options.members ?? []);
    for (const member of members) requireUser(state, member);
    state.groups.set(options.name, { gid, members, name: options.name });
    this.commit(state);
    return this.getGroup(options.name)!;
  }

  deleteGroup(name: string): void {
    if (name === rootLinuxAccount.group || name === sudoLinuxGroup.name)
      problem("protected", `group ${name} cannot be deleted`);
    const state = cloneState(this.state);
    const group = requireGroup(state, name);
    if ([...state.users.values()].some((user) => user.gid === group.gid))
      problem("conflict", `group ${name} is a primary group`);
    state.groups.delete(name);
    this.commit(state);
  }

  updateGroup(name: string, update: UpdateLinuxGroupOptions): LinuxGroupRecord {
    const state = cloneState(this.state);
    const current = requireGroup(state, name);
    const nextName = update.name ?? current.name;
    const nextGid = update.gid ?? current.gid;
    validateName(nextName, "group");
    validateId(nextGid, "GID");
    if (
      name === rootLinuxAccount.group &&
      (nextName !== "root" || nextGid !== 0)
    )
      problem("protected", "root group identity cannot be changed");
    if (
      name === sudoLinuxGroup.name &&
      (nextName !== sudoLinuxGroup.name || nextGid !== sudoLinuxGroup.gid)
    )
      problem("protected", "sudo group identity cannot be changed");
    if (nextName !== name && state.groups.has(nextName))
      problem("exists", `group ${nextName} already exists`);
    if (
      [...state.groups.values()].some(
        (group) => group.name !== name && group.gid === nextGid,
      )
    )
      problem("conflict", `GID ${String(nextGid)} is already in use`);
    if (name !== rootLinuxAccount.group && nextGid === 0)
      problem("protected", "GID 0 is reserved for root");
    if (name !== sudoLinuxGroup.name && nextGid === sudoLinuxGroup.gid)
      problem("protected", `GID ${String(nextGid)} is reserved for sudo`);
    const members =
      update.members === undefined
        ? [...current.members]
        : uniqueNames(update.members);
    for (const member of members) requireUser(state, member);
    replaceMapEntry(state.groups, name, nextName, {
      gid: nextGid,
      members,
      name: nextName,
    });
    if (nextGid !== current.gid) {
      for (const user of state.users.values()) {
        if (user.gid === current.gid) user.gid = nextGid;
      }
    }
    this.commit(state);
    return this.getGroup(nextName)!;
  }

  setPasswordRecord(username: string, record: string): LinuxShadowRecord {
    const state = cloneState(this.state);
    requireUser(state, username);
    state.shadow.set(username, parseShadowRecordInput(username, record));
    this.commit(state);
    return this.getShadowRecord(username)!;
  }

  lockPassword(username: string): LinuxShadowRecord {
    return this.setPasswordRecord(username, "!");
  }

  markPasswordUnset(username: string): LinuxShadowRecord {
    return this.setPasswordRecord(username, "!!");
  }

  private commit(state: AccountState): void {
    const membershipViolation = supplementaryGroupLimitViolation(state);
    if (membershipViolation !== undefined)
      problem(
        "limit",
        `user ${membershipViolation} exceeds the supplementary group limit of ${String(linuxAccountLimits.maximumSupplementaryGroupsPerUser)}`,
      );
    validateAccountState(state);
    const files = serializeAccountState(state);
    writeAccountFilesAtomically(this.filesystem, files, this.sourceFiles);
    this.state = state;
    this.sourceFiles = files;
    this.rebuildIndexes();
  }

  private rebuildIndexes(): void {
    this.usersByUid = new Map(
      [...this.state.users.values()].map((user) => [user.uid, user]),
    );
    this.groupsByGid = new Map(
      [...this.state.groups.values()].map((group) => [group.gid, group]),
    );
  }
}

export function openLinuxAccountDatabase(
  filesystem: InMemoryFilesystem,
): LinuxAccountDatabase {
  return LinuxAccountDatabase.open(filesystem);
}

export function migrateLinuxAccountDatabase(
  filesystem: InMemoryFilesystem,
): LinuxAccountDatabase {
  return LinuxAccountDatabase.migrate(filesystem);
}

function initialAccountState(): AccountState {
  return {
    users: new Map([
      [
        "root",
        {
          gecos: "root",
          gid: 0,
          home: rootLinuxAccount.home,
          name: "root",
          shell: rootLinuxAccount.shell,
          uid: 0,
        },
      ],
      [
        initialLinuxAccount.username,
        {
          gecos: "Computer System administrator",
          gid: initialLinuxAccount.gid,
          home: initialLinuxAccount.home,
          name: initialLinuxAccount.username,
          shell: initialLinuxAccount.shell,
          uid: initialLinuxAccount.uid,
        },
      ],
    ]),
    groups: new Map([
      ["root", { gid: 0, members: [], name: "root" }],
      [
        initialLinuxAccount.group,
        {
          gid: initialLinuxAccount.gid,
          members: [initialLinuxAccount.username],
          name: initialLinuxAccount.group,
        },
      ],
      [
        sudoLinuxGroup.name,
        {
          gid: sudoLinuxGroup.gid,
          members: [initialLinuxAccount.username],
          name: sudoLinuxGroup.name,
        },
      ],
    ]),
    shadow: new Map([
      ["root", { password: "!", state: "locked", username: "root" }],
      [
        initialLinuxAccount.username,
        {
          password: "!!",
          state: "unset",
          username: initialLinuxAccount.username,
        },
      ],
    ]),
  };
}

function migrateLegacyComputerName(state: AccountState): boolean {
  const legacy = state.users.get("computer");
  const legacyGroup = state.groups.get("computer");
  const legacyShadow = state.shadow.get("computer");
  const legacyMembership = [...state.groups.values()].some((group) =>
    group.members.includes("computer"),
  );
  if (
    legacy === undefined &&
    legacyGroup === undefined &&
    legacyShadow === undefined &&
    !legacyMembership
  )
    return false;

  const current = state.users.get(initialLinuxAccount.username);
  if (legacy !== undefined) {
    if (
      current !== undefined ||
      legacy.uid !== initialLinuxAccount.uid ||
      legacy.gid !== initialLinuxAccount.gid ||
      legacy.home !== "/home/computer" ||
      legacy.shell !== initialLinuxAccount.shell
    ) {
      unavailable(
        "legacy computer account does not match the supported schema",
      );
    }
  } else if (
    current === undefined ||
    current.uid !== initialLinuxAccount.uid ||
    current.gid !== initialLinuxAccount.gid ||
    current.home !== initialLinuxAccount.home ||
    current.shell !== initialLinuxAccount.shell
  ) {
    unavailable(
      "partially migrated cs account does not match the supported schema",
    );
  }

  const currentGroup = state.groups.get(initialLinuxAccount.group);
  if (
    legacyGroup !== undefined &&
    (currentGroup !== undefined || legacyGroup.gid !== initialLinuxAccount.gid)
  ) {
    unavailable("legacy computer group does not match the supported schema");
  }
  if (
    legacyGroup === undefined &&
    (currentGroup === undefined || currentGroup.gid !== initialLinuxAccount.gid)
  )
    unavailable(
      "partially migrated cs group does not match the supported schema",
    );
  if (
    state.shadow.has(initialLinuxAccount.username) &&
    legacyShadow !== undefined
  )
    unavailable("legacy and current shadow records conflict");

  if (legacy !== undefined)
    replaceMapEntry(state.users, "computer", initialLinuxAccount.username, {
      ...legacy,
      home: initialLinuxAccount.home,
      name: initialLinuxAccount.username,
    });
  if (legacyGroup !== undefined)
    replaceMapEntry(state.groups, "computer", initialLinuxAccount.group, {
      ...legacyGroup,
      members: legacyGroup.members.map((member) =>
        member === "computer" ? initialLinuxAccount.username : member,
      ),
      name: initialLinuxAccount.group,
    });
  for (const group of state.groups.values()) {
    group.members = group.members.map((member) =>
      member === "computer" ? initialLinuxAccount.username : member,
    );
  }
  if (legacyShadow !== undefined) {
    replaceMapEntry(state.shadow, "computer", initialLinuxAccount.username, {
      ...legacyShadow,
      username: initialLinuxAccount.username,
    });
  }
  return true;
}

function isRecognizedBootstrapState(state: AccountState): boolean {
  const requiresBootstrapCompletion =
    !state.groups.has(sudoLinuxGroup.name) ||
    !state.shadow.has("root") ||
    !state.shadow.has(initialLinuxAccount.username);
  if (!requiresBootstrapCompletion) return false;
  if (state.users.size !== 2) return false;
  const root = state.users.get("root");
  const initial = state.users.get(initialLinuxAccount.username);
  if (
    root === undefined ||
    root.uid !== 0 ||
    root.gid !== 0 ||
    root.home !== rootLinuxAccount.home ||
    root.shell !== rootLinuxAccount.shell ||
    initial === undefined ||
    initial.uid !== initialLinuxAccount.uid ||
    initial.gid !== initialLinuxAccount.gid ||
    initial.home !== initialLinuxAccount.home ||
    initial.shell !== initialLinuxAccount.shell
  )
    return false;
  const allowedGroups = new Set(["root", initialLinuxAccount.group, "sudo"]);
  if ([...state.groups.keys()].some((name) => !allowedGroups.has(name)))
    return false;
  const rootGroup = state.groups.get("root");
  const initialGroup = state.groups.get(initialLinuxAccount.group);
  const sudo = state.groups.get(sudoLinuxGroup.name);
  if (
    rootGroup?.gid !== 0 ||
    initialGroup?.gid !== initialLinuxAccount.gid ||
    (sudo !== undefined && sudo.gid !== sudoLinuxGroup.gid)
  )
    return false;
  return [...state.shadow.keys()].every(
    (name) => name === "root" || name === initialLinuxAccount.username,
  );
}

function completeBootstrapState(state: AccountState): void {
  const sudo = state.groups.get(sudoLinuxGroup.name);
  if (sudo === undefined) {
    if (
      [...state.groups.values()].some(
        (group) => group.gid === sudoLinuxGroup.gid,
      )
    )
      unavailable(`GID ${String(sudoLinuxGroup.gid)} is already in use`);
    state.groups.set(sudoLinuxGroup.name, {
      gid: sudoLinuxGroup.gid,
      members: [initialLinuxAccount.username],
      name: sudoLinuxGroup.name,
    });
  } else if (!sudo.members.includes(initialLinuxAccount.username)) {
    sudo.members.push(initialLinuxAccount.username);
  }
  if (!state.shadow.has("root"))
    state.shadow.set("root", {
      password: "!",
      state: "locked",
      username: "root",
    });
  if (!state.shadow.has(initialLinuxAccount.username))
    state.shadow.set(initialLinuxAccount.username, {
      password: "!!",
      state: "unset",
      username: initialLinuxAccount.username,
    });
}

function parseAccountFiles(files: AccountFileContents): AccountState {
  const state = {
    groups: parseGroupFile(files.group),
    shadow: parseShadowFile(files.shadow),
    users: parsePasswdFile(files.passwd),
  };
  validateAccountState(state);
  return state;
}

function parsePasswdFile(
  contents: string,
): Map<string, MutableLinuxUserRecord> {
  const lines = boundedLines(
    contents,
    "passwd",
    linuxAccountLimits.maximumUsers,
  );
  const users = new Map<string, MutableLinuxUserRecord>();
  const uids = new Set<number>();
  for (const line of lines) {
    const fields = line.split(":");
    if (fields.length !== 7 || fields[1] !== "x") invalidFile("passwd");
    const [
      name = "",
      ,
      uidText = "",
      gidText = "",
      gecos = "",
      home = "",
      shell = "",
    ] = fields;
    validateNameInFile(name, "passwd");
    const uid = parseId(uidText, "passwd");
    const gid = parseId(gidText, "passwd");
    validateTextField(gecos, 128, false, "passwd");
    validatePathField(home, 128, "passwd");
    validatePathField(shell, 64, "passwd");
    if (users.has(name) || uids.has(uid)) invalidFile("passwd");
    users.set(name, { gecos, gid, home, name, shell, uid });
    uids.add(uid);
  }
  return users;
}

function parseGroupFile(
  contents: string,
): Map<string, MutableLinuxGroupRecord> {
  const lines = boundedLines(
    contents,
    "group",
    linuxAccountLimits.maximumGroups,
  );
  const groups = new Map<string, MutableLinuxGroupRecord>();
  const gids = new Set<number>();
  let memberships = 0;
  for (const line of lines) {
    const fields = line.split(":");
    if (fields.length !== 4 || fields[1] !== "x") invalidFile("group");
    const [name = "", , gidText = "", memberText = ""] = fields;
    validateNameInFile(name, "group");
    const gid = parseId(gidText, "group");
    const members = memberText.length === 0 ? [] : memberText.split(",");
    if (
      members.length > linuxAccountLimits.maximumMembersPerGroup ||
      new Set(members).size !== members.length
    )
      invalidFile("group");
    for (const member of members) validateNameInFile(member, "group");
    memberships += members.length;
    if (
      memberships > linuxAccountLimits.maximumTotalMemberships ||
      groups.has(name) ||
      gids.has(gid)
    )
      invalidFile("group");
    groups.set(name, { gid, members, name });
    gids.add(gid);
  }
  return groups;
}

function parseShadowFile(
  contents: string,
): Map<string, MutableLinuxShadowRecord> {
  const lines = boundedLines(
    contents,
    "shadow",
    linuxAccountLimits.maximumUsers,
  );
  const records = new Map<string, MutableLinuxShadowRecord>();
  for (const line of lines) {
    const separator = line.indexOf(":");
    if (separator <= 0) invalidFile("shadow");
    const username = line.slice(0, separator);
    validateNameInFile(username, "shadow");
    if (records.has(username)) invalidFile("shadow");
    records.set(
      username,
      parseShadowRecordInput(username, line.slice(separator + 1), "shadow"),
    );
  }
  return records;
}

function parseShadowRecordInput(
  username: string,
  record: string,
  source?: "shadow",
): MutableLinuxShadowRecord {
  const prefix = `${username}:`;
  const password = record.startsWith(prefix)
    ? record.slice(prefix.length)
    : record;
  const fail = (): never => {
    if (source === "shadow") invalidFile("shadow");
    problem("invalid", "password record is invalid");
  };
  if (password === "!") return { password, state: "locked", username };
  if (password === "!!") return { password, state: "unset", username };
  if (
    !new RegExp(
      `^${passwordAlgorithm}:${String(passwordRounds)}:[A-Za-z0-9_-]{16,32}:[0-9a-f]{64}$`,
      "u",
    ).test(password)
  )
    return fail();
  return { password, state: "hash", username };
}

function validateAccountState(state: AccountState): void {
  if (
    state.users.size === 0 ||
    state.users.size > linuxAccountLimits.maximumUsers ||
    state.groups.size === 0 ||
    state.groups.size > linuxAccountLimits.maximumGroups ||
    state.shadow.size !== state.users.size
  )
    invalidState();

  const uidSet = new Set<number>();
  for (const [name, user] of state.users) {
    validateNameInState(name, "user");
    if (user.name !== name) invalidState();
    validateIdInState(user.uid, "UID");
    validateIdInState(user.gid, "GID");
    validateTextFieldInState(user.gecos, 128, false);
    validatePathFieldInState(user.home, 128);
    validatePathFieldInState(user.shell, 64);
    if (uidSet.has(user.uid)) invalidState();
    uidSet.add(user.uid);
  }
  const gidSet = new Set<number>();
  let memberships = 0;
  for (const [name, group] of state.groups) {
    validateNameInState(name, "group");
    validateIdInState(group.gid, "GID");
    if (
      group.name !== name ||
      gidSet.has(group.gid) ||
      group.members.length > linuxAccountLimits.maximumMembersPerGroup ||
      new Set(group.members).size !== group.members.length
    )
      invalidState();
    gidSet.add(group.gid);
    memberships += group.members.length;
    for (const member of group.members) {
      if (!state.users.has(member)) invalidState();
    }
  }
  if (memberships > linuxAccountLimits.maximumTotalMemberships) invalidState();
  if (supplementaryGroupLimitViolation(state) !== undefined) invalidState();
  for (const user of state.users.values()) {
    if (!gidSet.has(user.gid) || !state.shadow.has(user.name)) invalidState();
  }
  for (const [name, shadow] of state.shadow) {
    if (!state.users.has(name) || shadow.username !== name) invalidState();
    parseShadowRecordInput(name, shadow.password, "shadow");
  }
  const root = state.users.get(rootLinuxAccount.username);
  const rootGroup = state.groups.get(rootLinuxAccount.group);
  const sudo = state.groups.get(sudoLinuxGroup.name);
  if (
    root?.uid !== rootLinuxAccount.uid ||
    root.gid !== rootLinuxAccount.gid ||
    rootGroup?.gid !== rootLinuxAccount.gid ||
    sudo?.gid !== sudoLinuxGroup.gid
  )
    invalidState();

  const files = serializeAccountStateUnchecked(state);
  validateSerializedFiles(files);
}

function supplementaryGroupLimitViolation(
  state: AccountState,
): string | undefined {
  const counts = new Map<string, number>();
  for (const group of state.groups.values()) {
    for (const member of group.members) {
      const user = state.users.get(member);
      if (user === undefined || group.gid === user.gid) continue;
      const count = (counts.get(member) ?? 0) + 1;
      if (count > linuxAccountLimits.maximumSupplementaryGroupsPerUser)
        return member;
      counts.set(member, count);
    }
  }
  return undefined;
}

function serializeAccountState(state: AccountState): AccountFileContents {
  validateAccountState(state);
  return serializeAccountStateUnchecked(state);
}

function serializeAccountStateUnchecked(
  state: AccountState,
): AccountFileContents {
  return {
    passwd:
      [...state.users.values()]
        .map(
          (user) =>
            `${user.name}:x:${String(user.uid)}:${String(user.gid)}:${user.gecos}:${user.home}:${user.shell}`,
        )
        .join("\n") + "\n",
    group:
      [...state.groups.values()]
        .map(
          (group) =>
            `${group.name}:x:${String(group.gid)}:${group.members.join(",")}`,
        )
        .join("\n") + "\n",
    shadow:
      [...state.shadow.values()]
        .map((record) => `${record.username}:${record.password}`)
        .join("\n") + "\n",
  };
}

function writeAccountFilesAtomically(
  filesystem: InMemoryFilesystem,
  files: AccountFileContents,
  expected: AccountFileContents | undefined,
): void {
  validateSerializedFiles(files);
  const backups = captureAccountFiles(filesystem);
  if (expected !== undefined) {
    for (const backup of backups) {
      if (
        backup.contents !== expected[backup.name] ||
        backup.metadata === undefined ||
        !matchesRequiredMetadata(backup.name, backup.metadata)
      )
        problem("stale", "account database changed during update");
    }
  }

  const totalDelta = backups.reduce(
    (delta, backup) =>
      delta +
      utf8ByteLength(files[backup.name]) -
      utf8ByteLength(backup.contents ?? ""),
    0,
  );
  if (Math.max(0, totalDelta) > filesystem.getFreeSpace())
    problem("capacity", "insufficient space for account database update");

  const writes = backups
    .map((backup) => ({
      backup,
      delta:
        utf8ByteLength(files[backup.name]) -
        utf8ByteLength(backup.contents ?? ""),
    }))
    .filter(
      ({ backup }) =>
        backup.contents !== files[backup.name] ||
        backup.metadata === undefined ||
        !matchesRequiredMetadata(backup.name, backup.metadata),
    )
    .sort((left, right) => left.delta - right.delta);
  if (writes.length === 0) return;

  const touched = new Set<AccountFileName>();
  try {
    for (const { backup } of writes) {
      touched.add(backup.name);
      filesystem.writeFile(backup.path, files[backup.name]);
      filesystem.setMetadata(backup.path, accountFileMetadata[backup.name]);
    }
  } catch (commitCause: unknown) {
    let rollbackCause: Error | undefined;
    try {
      rollbackCause = restoreAccountFiles(
        filesystem,
        backups.filter((backup) => touched.has(backup.name)),
      );
    } catch (error: unknown) {
      rollbackCause = asError(error);
    }
    if (rollbackCause !== undefined) {
      throw new LinuxAccountCommitError(
        "rollback_failed",
        "CS-Linux account update failed and rollback did not complete",
        commitCause,
        rollbackCause,
      );
    }
    throw new LinuxAccountCommitError(
      "commit_failed",
      "CS-Linux account update failed; previous account files were restored",
      commitCause,
    );
  }
}

function captureAccountFiles(
  filesystem: InMemoryFilesystem,
): AccountFileBackup[] {
  return accountFileOrder.map((name) => {
    const path = linuxAccountPaths[name];
    if (!filesystem.exists(path)) return { name, path };
    if (
      filesystem.isDirectory(path) ||
      filesystem.isSymbolicLink(path) ||
      filesystem.getLinkCount(path) !== 1
    )
      unavailable(`${path} is not a private regular file`);
    if (filesystem.getSize(path) > linuxAccountLimits.maximumFileBytes[name])
      unavailable(`${path} exceeds its bounded size`);
    return {
      contents: filesystem.readFile(path),
      metadata: filesystem.getMetadata(path),
      name,
      path,
    };
  });
}

function readRequiredAccountFiles(
  filesystem: InMemoryFilesystem,
): AccountFileContents {
  const captured = captureAccountFiles(filesystem);
  const result = {} as Partial<AccountFileContents>;
  for (const backup of captured) {
    if (backup.contents === undefined) unavailable(`${backup.path} is missing`);
    result[backup.name] = backup.contents;
  }
  return result as AccountFileContents;
}

function validateAccountFileMetadata(filesystem: InMemoryFilesystem): void {
  for (const name of accountFileOrder) {
    const path = linuxAccountPaths[name];
    const metadata = filesystem.getMetadata(path);
    if (!matchesRequiredMetadata(name, metadata))
      unavailable(`${path} has unsafe ownership or mode`);
  }
}

function matchesRequiredMetadata(
  name: AccountFileName,
  metadata: FilesystemMetadata,
): boolean {
  const required = accountFileMetadata[name];
  return (
    metadata.gid === required.gid &&
    metadata.mode === required.mode &&
    metadata.uid === required.uid
  );
}

function restoreAccountFiles(
  filesystem: InMemoryFilesystem,
  backups: readonly AccountFileBackup[],
): Error | undefined {
  let firstFailure: Error | undefined;
  const ordered = [...backups].sort((left, right) => {
    if (left.contents === undefined) return -1;
    if (right.contents === undefined) return 1;
    const leftCurrent = filesystem.exists(left.path)
      ? filesystem.getSize(left.path)
      : 0;
    const rightCurrent = filesystem.exists(right.path)
      ? filesystem.getSize(right.path)
      : 0;
    return (
      utf8ByteLength(left.contents) -
      leftCurrent -
      (utf8ByteLength(right.contents) - rightCurrent)
    );
  });
  for (const backup of ordered) {
    try {
      if (backup.contents === undefined) {
        if (filesystem.exists(backup.path)) filesystem.delete(backup.path);
        continue;
      }
      if (
        filesystem.exists(backup.path) &&
        (filesystem.isDirectory(backup.path) ||
          filesystem.isSymbolicLink(backup.path) ||
          filesystem.getLinkCount(backup.path) !== 1)
      )
        throw new Error(`${backup.path} is not rollback-safe`);
      filesystem.writeFile(backup.path, backup.contents);
      filesystem.setMetadata(backup.path, {
        gid: backup.metadata!.gid,
        mode: backup.metadata!.mode,
        uid: backup.metadata!.uid,
      });
      filesystem.setModifiedTime(
        backup.path,
        backup.metadata!.modifiedAtMilliseconds,
      );
    } catch (error: unknown) {
      firstFailure ??= asError(error);
    }
  }
  return firstFailure;
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function validateSerializedFiles(files: AccountFileContents): void {
  for (const name of accountFileOrder) {
    if (utf8ByteLength(files[name]) > linuxAccountLimits.maximumFileBytes[name])
      problem("limit", `${name} account file limit reached`);
    const lines = files[name].slice(0, -1).split("\n");
    if (
      lines.some(
        (line) => utf8ByteLength(line) > linuxAccountLimits.maximumLineBytes,
      )
    )
      problem("limit", `${name} account line limit reached`);
  }
}

function boundedLines(
  contents: string,
  name: AccountFileName,
  maximumLines: number,
): string[] {
  if (
    utf8ByteLength(contents) > linuxAccountLimits.maximumFileBytes[name] ||
    !contents.endsWith("\n") ||
    contents.includes("\r") ||
    contents.includes("\0")
  )
    invalidFile(name);
  const lines = contents.slice(0, -1).split("\n");
  if (
    lines.length === 0 ||
    lines.length > maximumLines ||
    lines.some(
      (line) =>
        line.length === 0 ||
        utf8ByteLength(line) > linuxAccountLimits.maximumLineBytes,
    )
  )
    invalidFile(name);
  return lines;
}

function validateName(name: string, kind: "group" | "user"): void {
  if (name === "computer")
    problem("protected", "legacy account name computer is reserved");
  if (!/^[a-z_][a-z0-9_-]{0,31}$/u.test(name))
    problem("invalid", `${kind} name is invalid`);
}

function validateNameInFile(name: string, file: AccountFileName): void {
  if (!/^[a-z_][a-z0-9_-]{0,31}$/u.test(name)) invalidFile(file);
}

function validateNameInState(name: string, kind: "group" | "user"): void {
  if (!/^[a-z_][a-z0-9_-]{0,31}$/u.test(name))
    problem("invalid", `${kind} name is invalid`);
}

function validateId(value: number, kind: "GID" | "UID"): void {
  if (
    !Number.isInteger(value) ||
    value < 0 ||
    value > linuxAccountLimits.maximumNormalId
  )
    problem("invalid", `${kind} is invalid`);
}

function validateIdInState(value: number, kind: "GID" | "UID"): void {
  validateId(value, kind);
}

function parseId(value: string, file: AccountFileName): number {
  if (!/^(?:0|[1-9][0-9]{0,4})$/u.test(value)) invalidFile(file);
  const parsed = Number(value);
  if (parsed > linuxAccountLimits.maximumNormalId) invalidFile(file);
  return parsed;
}

function validateTextField(
  value: string,
  maximumBytes: number,
  allowColon: boolean,
  file: AccountFileName,
): void {
  if (
    utf8ByteLength(value) > maximumBytes ||
    /[\0\r\n]/u.test(value) ||
    (!allowColon && value.includes(":"))
  )
    invalidFile(file);
}

function validateTextFieldInState(
  value: string,
  maximumBytes: number,
  allowColon: boolean,
): void {
  if (
    utf8ByteLength(value) > maximumBytes ||
    /[\0\r\n]/u.test(value) ||
    (!allowColon && value.includes(":"))
  )
    problem("invalid", "account text field is invalid");
}

function validatePathField(
  value: string,
  maximumBytes: number,
  file: AccountFileName,
): void {
  validateTextField(value, maximumBytes, false, file);
  if (!isCanonicalAbsolutePath(value)) invalidFile(file);
}

function validatePathFieldInState(value: string, maximumBytes: number): void {
  validateTextFieldInState(value, maximumBytes, false);
  if (!isCanonicalAbsolutePath(value))
    problem("invalid", "account path is invalid");
}

function isCanonicalAbsolutePath(value: string): boolean {
  return (
    value.startsWith("/") &&
    value.length > 1 &&
    !value.endsWith("/") &&
    !value.includes("//") &&
    !value.split("/").some((segment) => segment === "." || segment === "..")
  );
}

function allocateNormalId(
  used: ReadonlySet<number>,
  kind: "GID" | "UID",
): number {
  const maximumAttempts = Math.min(
    linuxAccountLimits.maximumUsers + linuxAccountLimits.maximumGroups + 1,
    linuxAccountLimits.maximumNormalId - linuxAccountLimits.minimumNormalId + 1,
  );
  for (let offset = 0; offset < maximumAttempts; offset += 1) {
    const candidate = linuxAccountLimits.minimumNormalId + offset;
    if (!used.has(candidate)) return candidate;
  }
  problem("limit", `no normal ${kind} is available`);
}

function uniqueNames(names: readonly string[]): string[] {
  if (new Set(names).size !== names.length)
    problem("invalid", "group list contains duplicates");
  for (const name of names) validateName(name, "group");
  return [...names];
}

function requireUser(
  state: AccountState,
  username: string,
): MutableLinuxUserRecord {
  const user = state.users.get(username);
  if (user === undefined)
    problem("not_found", `user ${username} does not exist`);
  return user;
}

function requireGroup(
  state: AccountState,
  name: string,
): MutableLinuxGroupRecord {
  const group = state.groups.get(name);
  if (group === undefined) problem("not_found", `group ${name} does not exist`);
  return group;
}

function requireGroupByGid(
  state: AccountState,
  gid: number,
): MutableLinuxGroupRecord {
  const group = [...state.groups.values()].find(
    (candidate) => candidate.gid === gid,
  );
  if (group === undefined)
    problem("not_found", `GID ${String(gid)} does not exist`);
  return group;
}

function userIds(state: AccountState): Set<number> {
  return new Set([...state.users.values()].map((user) => user.uid));
}

function groupIds(state: AccountState): Set<number> {
  return new Set([...state.groups.values()].map((group) => group.gid));
}

function cloneState(state: AccountState): AccountState {
  return {
    users: new Map([...state.users].map(([name, user]) => [name, { ...user }])),
    groups: new Map(
      [...state.groups].map(([name, group]) => [
        name,
        { ...group, members: [...group.members] },
      ]),
    ),
    shadow: new Map(
      [...state.shadow].map(([name, shadow]) => [name, { ...shadow }]),
    ),
  };
}

function replaceMapEntry<T>(
  map: Map<string, T>,
  previous: string,
  next: string,
  value: T,
): void {
  const entries = [...map];
  map.clear();
  for (const [name, entry] of entries) {
    if (name === previous) map.set(next, value);
    else map.set(name, entry);
  }
}

function publicUser(record: MutableLinuxUserRecord): LinuxUserRecord {
  return { ...record };
}

function publicGroup(record: MutableLinuxGroupRecord): LinuxGroupRecord {
  return { ...record, members: [...record.members] };
}

function publicShadow(record: MutableLinuxShadowRecord): LinuxShadowRecord {
  return { ...record };
}

function invalidFile(name: AccountFileName): never {
  throw new LinuxAccountDatabaseError(
    "unavailable",
    `${linuxAccountPaths[name]} is invalid`,
  );
}

function invalidState(): never {
  throw new LinuxAccountDatabaseError(
    "invalid",
    "CS-Linux account update is inconsistent",
  );
}

function unavailable(message: string): never {
  throw new LinuxAccountDatabaseError("unavailable", message);
}

function problem(code: LinuxAccountErrorCode, message: string): never {
  throw new LinuxAccountDatabaseError(code, message);
}
