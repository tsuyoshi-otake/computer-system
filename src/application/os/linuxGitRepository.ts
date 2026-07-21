import {
  sha256BytePartsHex,
  sha256BytesHex,
} from "../../domain/crypto/sha256.js";
import type { SynchronousTransactionOperation } from "../../domain/filesystem/inMemoryFilesystem.js";
import {
  decodeUtf8 as decodeUtf8Bytes,
  encodeUtf8,
} from "../../domain/text/utf8.js";
import type { GuestFilesystem } from "./guestFilesystem.js";
import { parseLinuxGitRemoteEndpoint } from "./linuxGitRemote.js";

export const linuxGitLimits = Object.freeze({
  maximumBranches: 64,
  maximumCommitMessageBytes: 4_096,
  maximumConfigBytes: 16_384,
  maximumDiffBytes: 131_072,
  maximumHistoryCommits: 256,
  maximumIndexBytes: 131_072,
  maximumObjectBytes: 393_216,
  maximumObjects: 2_048,
  maximumOperationBytes: 8_388_608,
  maximumPathBytes: 255,
  maximumRemoteUrlBytes: 512,
  maximumTags: 64,
  maximumTrackedEntries: 256,
  maximumTraversalEntries: 512,
  maximumWorkUnits: 70_000,
});

export type LinuxGitFileMode = 100_644 | 100_755 | 120_000;
export type LinuxGitObjectType = "blob" | "commit" | "tree";

export interface LinuxGitIndexEntry {
  readonly mode: LinuxGitFileMode;
  readonly oid: string;
  readonly path: string;
}

export interface LinuxGitCommit {
  readonly authorEmail: string;
  readonly authorName: string;
  readonly message: string;
  readonly parents: readonly string[];
  readonly timestampMilliseconds: number;
  readonly tree: string;
}

export interface LinuxGitConfig {
  readonly remotes: ReadonlyMap<string, string>;
  readonly userEmail: string | undefined;
  readonly userName: string | undefined;
}

export interface LinuxGitHead {
  readonly oid: string | undefined;
  readonly ref: string | undefined;
}

export interface LinuxGitIo {
  readonly computerName: string;
  readonly currentDirectory: string;
  readonly effectiveUserId: number;
  readonly filesystem: GuestFilesystem;
  readonly loginName: string;
  readonly nowMilliseconds: () => number;
  readonly readFile: (path: string) => string;
  readonly readFileBytes: (path: string) => Uint8Array;
  readonly readLink: (path: string) => string;
  readonly writeFile: (path: string, contents: string) => void;
  readonly writeFileBytes: (path: string, contents: Uint8Array) => void;
}

export class LinuxGitError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
    this.name = "LinuxGitError";
  }
}

export class LinuxGitOperationBudget {
  private bytesValue = 0;
  private workUnitsValue = 0;

  get cpuCycles(): number {
    return Math.max(
      32,
      this.workUnitsValue * 32 + Math.ceil(this.bytesValue / 8),
    );
  }

  chargeBytes(bytes: number): void {
    requireNonNegativeInteger(bytes, "Git byte charge");
    this.bytesValue += bytes;
    if (this.bytesValue > linuxGitLimits.maximumOperationBytes) {
      throw new LinuxGitError(
        `operation exceeds ${String(linuxGitLimits.maximumOperationBytes)} bytes`,
      );
    }
  }

  chargeWork(units = 1): void {
    requireNonNegativeInteger(units, "Git work charge");
    this.workUnitsValue += units;
    if (this.workUnitsValue > linuxGitLimits.maximumWorkUnits) {
      throw new LinuxGitError("operation work limit exceeded");
    }
  }
}

interface StoredObject {
  readonly oid: string;
  readonly payload: Uint8Array;
  readonly type: LinuxGitObjectType;
}

interface StoredIndex {
  readonly entries: readonly LinuxGitIndexEntry[];
  readonly schema: 1;
}

interface StoredTree {
  readonly entries: readonly LinuxGitIndexEntry[];
  readonly schema: 1;
}

interface StoredCommit {
  readonly authorEmail: string;
  readonly authorName: string;
  readonly message: string;
  readonly parents: readonly string[];
  readonly schema: 1;
  readonly timestampMilliseconds: number;
  readonly tree: string;
}

const repositoryMarker = "CS-SYSTEM-VCS 1\nobjectformat sha256\n";
const objectMarker = "CSGIT-OBJECT 1\n";
const indexMarker = "CSGIT-INDEX 1\n";
const oidPattern = /^[0-9a-f]{64}$/u;
const branchNamePattern = /^[A-Za-z0-9](?:[A-Za-z0-9._/-]{0,62}[A-Za-z0-9])?$/u;
const shortRefNamePattern = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62})?$/u;

export class LinuxGitRepository {
  readonly gitDirectory: string;
  private knownObjectCount: number | undefined;

  private constructor(
    readonly root: string,
    readonly io: LinuxGitIo,
    readonly budget: LinuxGitOperationBudget,
  ) {
    this.gitDirectory = joinAbsolute(root, ".git");
  }

  static discover(
    io: LinuxGitIo,
    budget: LinuxGitOperationBudget,
  ): LinuxGitRepository {
    const filesystem = io.filesystem;
    let candidate = filesystem.normalize(io.currentDirectory);
    while (true) {
      budget.chargeWork();
      const gitDirectory = joinAbsolute(candidate, ".git");
      if (filesystem.exists(gitDirectory)) {
        const repository = new LinuxGitRepository(candidate, io, budget);
        repository.validateWorktreeRoot();
        repository.validateControlDirectory();
        if (isInside(io.currentDirectory, gitDirectory)) {
          throw new LinuxGitError(
            "commands from inside .git are not supported",
          );
        }
        repository.readConfig();
        return repository;
      }
      if (candidate === "/") break;
      candidate = parentPath(candidate);
    }
    throw new LinuxGitError(
      "not a CS System Git repository (or any parent): .git",
    );
  }

  static initialize(
    root: string,
    initialBranch: string,
    io: LinuxGitIo,
    budget: LinuxGitOperationBudget,
  ): {
    readonly reinitialized: boolean;
    readonly repository: LinuxGitRepository;
  } {
    const filesystem = io.filesystem;
    const normalizedRoot = filesystem.normalize(root);
    validateBranchName(initialBranch);
    if (!filesystem.exists(normalizedRoot)) {
      filesystem.makeDirectory(normalizedRoot, 0o755);
    }
    if (
      !filesystem.isDirectory(normalizedRoot) ||
      filesystem.isSymbolicLink(normalizedRoot)
    ) {
      throw new LinuxGitError(
        `${normalizedRoot}: repository root is not a real directory`,
      );
    }
    const repository = new LinuxGitRepository(normalizedRoot, io, budget);
    repository.validateWorktreeRoot();
    if (filesystem.exists(repository.gitDirectory)) {
      repository.validateControlDirectory();
      repository.readConfig();
      return { reinitialized: true, repository };
    }

    filesystem.transaction(() => {
      repository.makePrivateDirectory(repository.gitDirectory);
      repository.makePrivateDirectory(repository.controlPath("objects"));
      repository.makePrivateDirectory(repository.controlPath("refs"));
      repository.makePrivateDirectory(repository.controlPath("refs/heads"));
      repository.makePrivateDirectory(repository.controlPath("refs/tags"));
      repository.makePrivateDirectory(repository.controlPath("refs/remotes"));
      repository.makePrivateDirectory(repository.controlPath("info"));
      repository.makePrivateDirectory(repository.controlPath("logs"));
      repository.writeText(
        repository.controlPath("CS_SYSTEM_VCS"),
        repositoryMarker,
      );
      repository.writeText(
        repository.controlPath("HEAD"),
        `ref: refs/heads/${initialBranch}\n`,
      );
      repository.writeText(
        repository.controlPath("config"),
        renderConfig({
          remotes: new Map(),
          userEmail: undefined,
          userName: undefined,
        }),
      );
      repository.writeIndex([]);
      repository.writeText(
        repository.controlPath("info/exclude"),
        "# Local excludes\n",
      );
    });
    repository.validateControlDirectory();
    return { reinitialized: false, repository };
  }

  transaction<Result>(
    operation: SynchronousTransactionOperation<Result>,
  ): Result {
    return this.io.filesystem.transaction(operation);
  }

  controlPath(relative: string): string {
    if (relative.length === 0) return this.gitDirectory;
    validateControlRelativePath(relative);
    return joinAbsolute(this.gitDirectory, relative);
  }

  currentBranchName(): string | undefined {
    const reference = this.readHead().ref;
    return reference?.startsWith("refs/heads/")
      ? reference.slice("refs/heads/".length)
      : undefined;
  }

  readHead(): LinuxGitHead {
    const path = this.controlPath("HEAD");
    const value = this.readText(path, 160).trim();
    if (value.startsWith("ref: ")) {
      const reference = value.slice(5);
      validateFullRef(reference);
      return { oid: this.readRef(reference), ref: reference };
    }
    validateOid(value);
    return { oid: value, ref: undefined };
  }

  writeHeadReference(reference: string): void {
    validateFullRef(reference);
    this.writeText(this.controlPath("HEAD"), `ref: ${reference}\n`);
  }

  writeDetachedHead(oid: string): void {
    validateOid(oid);
    this.writeText(this.controlPath("HEAD"), `${oid}\n`);
  }

  readRef(reference: string): string | undefined {
    validateFullRef(reference);
    if (!this.requireExistingControlParents(reference)) return undefined;
    const path = this.controlPath(reference);
    if (!this.io.filesystem.exists(path)) return undefined;
    const value = this.readText(path, 96).trim();
    validateOid(value);
    return value;
  }

  updateRef(
    reference: string,
    expectedOldOid: string | undefined,
    newOid: string,
  ): void {
    validateFullRef(reference);
    validateOid(newOid);
    const actual = this.readRef(reference);
    if (actual !== expectedOldOid) {
      throw new LinuxGitError(
        `${reference} changed concurrently; expected ${expectedOldOid ?? "unborn"}, found ${actual ?? "unborn"}`,
      );
    }
    this.ensureControlParents(reference);
    this.writeText(this.controlPath(reference), `${newOid}\n`);
  }

  deleteRef(reference: string, expectedOid: string | undefined): void {
    validateFullRef(reference);
    const actual = this.readRef(reference);
    if (actual !== expectedOid) {
      throw new LinuxGitError(`${reference} changed concurrently`);
    }
    const path = this.controlPath(reference);
    if (this.io.filesystem.exists(path)) this.io.filesystem.delete(path);
  }

  listRefs(
    namespace: "heads" | "tags",
  ): readonly (readonly [string, string])[] {
    const directory = this.controlPath(`refs/${namespace}`);
    const output: Array<readonly [string, string]> = [];
    const pending = [{ directory, prefix: "" }];
    while (pending.length > 0) {
      const current = pending.pop()!;
      this.requireRealControlEntry(current.directory, "directory");
      for (const name of this.io.filesystem
        .list(current.directory)
        .toReversed()) {
        this.budget.chargeWork();
        const path = joinAbsolute(current.directory, name);
        const relative =
          current.prefix.length === 0 ? name : `${current.prefix}/${name}`;
        if (this.io.filesystem.isSymbolicLink(path)) {
          throw new LinuxGitError(
            `${path}: symbolic links are forbidden inside .git`,
          );
        }
        if (this.io.filesystem.isDirectory(path)) {
          pending.push({ directory: path, prefix: relative });
        } else {
          const oid = this.readRef(`refs/${namespace}/${relative}`);
          if (oid === undefined)
            throw new LinuxGitError(`${path}: ref disappeared during read`);
          output.push([relative, oid] as const);
          const limit =
            namespace === "heads"
              ? linuxGitLimits.maximumBranches
              : linuxGitLimits.maximumTags;
          if (output.length > limit) {
            throw new LinuxGitError(`${namespace} ref limit exceeded`);
          }
        }
      }
    }
    return output.sort(([left], [right]) => left.localeCompare(right));
  }

  readIndex(): readonly LinuxGitIndexEntry[] {
    const path = this.controlPath("index");
    const bytes = this.readBytes(path, linuxGitLimits.maximumIndexBytes);
    const text = decodeUtf8(bytes, path);
    if (!text.startsWith(indexMarker))
      throw new LinuxGitError("index marker is invalid");
    const checksumEnd = text.indexOf("\n", indexMarker.length);
    if (checksumEnd < 0) throw new LinuxGitError("index checksum is missing");
    const checksum = text.slice(indexMarker.length, checksumEnd);
    validateOid(checksum);
    const payload = text.slice(checksumEnd + 1).replace(/\n$/u, "");
    if (sha256BytesHex(encodeUtf8(payload)) !== checksum) {
      throw new LinuxGitError("index checksum mismatch");
    }
    const parsed = parseJson(payload, "index");
    if (
      !isRecord(parsed) ||
      !hasOnlyKeys(parsed, ["schema", "entries"]) ||
      parsed.schema !== 1
    ) {
      throw new LinuxGitError("index schema is invalid");
    }
    const entries = parseEntries(parsed.entries, "index");
    return Object.freeze(entries);
  }

  writeIndex(entries: readonly LinuxGitIndexEntry[]): void {
    const normalized = normalizeEntries(entries, "index");
    const stored: StoredIndex = { entries: normalized, schema: 1 };
    const payload = JSON.stringify(stored);
    const checksum = sha256BytesHex(encodeUtf8(payload));
    const contents = `${indexMarker}${checksum}\n${payload}\n`;
    if (encodeUtf8(contents).byteLength > linuxGitLimits.maximumIndexBytes) {
      throw new LinuxGitError("index size limit exceeded");
    }
    this.writeText(this.controlPath("index"), contents);
  }

  writeBlob(contents: Uint8Array): string {
    return this.writeObject("blob", contents);
  }

  writeTree(entries: readonly LinuxGitIndexEntry[]): string {
    const tree: StoredTree = {
      entries: normalizeEntries(entries, "tree"),
      schema: 1,
    };
    return this.writeObject("tree", encodeUtf8(JSON.stringify(tree)));
  }

  writeCommit(commit: LinuxGitCommit): string {
    validateCommit(commit);
    const stored: StoredCommit = {
      authorEmail: commit.authorEmail,
      authorName: commit.authorName,
      message: commit.message,
      parents: [...commit.parents],
      schema: 1,
      timestampMilliseconds: commit.timestampMilliseconds,
      tree: commit.tree,
    };
    return this.writeObject("commit", encodeUtf8(JSON.stringify(stored)));
  }

  readBlob(oid: string): Uint8Array {
    const object = this.readObject(oid);
    if (object.type !== "blob")
      throw new LinuxGitError(`${oid}: expected blob object`);
    return object.payload;
  }

  readTree(oid: string): readonly LinuxGitIndexEntry[] {
    const object = this.readObject(oid);
    if (object.type !== "tree")
      throw new LinuxGitError(`${oid}: expected tree object`);
    const parsed = parseJson(decodeUtf8(object.payload, oid), "tree");
    if (
      !isRecord(parsed) ||
      !hasOnlyKeys(parsed, ["schema", "entries"]) ||
      parsed.schema !== 1
    ) {
      throw new LinuxGitError(`${oid}: tree schema is invalid`);
    }
    return Object.freeze(parseEntries(parsed.entries, "tree"));
  }

  readCommit(oid: string): LinuxGitCommit {
    const object = this.readObject(oid);
    if (object.type !== "commit")
      throw new LinuxGitError(`${oid}: expected commit object`);
    const parsed = parseJson(decodeUtf8(object.payload, oid), "commit");
    if (
      !isRecord(parsed) ||
      !hasOnlyKeys(parsed, [
        "schema",
        "tree",
        "parents",
        "authorName",
        "authorEmail",
        "timestampMilliseconds",
        "message",
      ]) ||
      parsed.schema !== 1 ||
      typeof parsed.tree !== "string" ||
      !Array.isArray(parsed.parents) ||
      !parsed.parents.every((parent) => typeof parent === "string") ||
      typeof parsed.authorName !== "string" ||
      typeof parsed.authorEmail !== "string" ||
      typeof parsed.timestampMilliseconds !== "number" ||
      typeof parsed.message !== "string"
    ) {
      throw new LinuxGitError(`${oid}: commit schema is invalid`);
    }
    const commit: LinuxGitCommit = {
      authorEmail: parsed.authorEmail,
      authorName: parsed.authorName,
      message: parsed.message,
      parents: parsed.parents,
      timestampMilliseconds: parsed.timestampMilliseconds,
      tree: parsed.tree,
    };
    validateCommit(commit);
    return Object.freeze(commit);
  }

  objectType(oid: string): LinuxGitObjectType {
    return this.readObject(oid).type;
  }

  readConfig(): LinuxGitConfig {
    const path = this.controlPath("config");
    const value = this.readText(path, linuxGitLimits.maximumConfigBytes);
    return parseConfig(value);
  }

  readInfoExclude(): string {
    return this.readText(this.controlPath("info/exclude"), 16_384);
  }

  writeConfig(config: LinuxGitConfig): void {
    this.writeText(this.controlPath("config"), renderConfig(config));
  }

  resolveRevision(value = "HEAD"): string {
    if (value === "HEAD") {
      const oid = this.readHead().oid;
      if (oid === undefined)
        throw new LinuxGitError("HEAD does not point to a commit");
      return oid;
    }
    if (oidPattern.test(value)) {
      this.readObject(value);
      return value;
    }
    if (validShortRefName(value)) {
      const branch = this.readRef(`refs/heads/${value}`);
      if (branch !== undefined) return branch;
      const tag = this.readRef(`refs/tags/${value}`);
      if (tag !== undefined) return tag;
    }
    throw new LinuxGitError(
      `${value}: unknown revision (use a ref name or full object ID)`,
    );
  }

  treeAtCommit(oid: string | undefined): readonly LinuxGitIndexEntry[] {
    if (oid === undefined) return [];
    return this.readTree(this.readCommit(oid).tree);
  }

  relativePath(absolute: string): string {
    const normalized = this.io.filesystem.normalize(absolute);
    if (!isInside(normalized, this.root) || normalized === this.root) {
      if (normalized === this.root) return "";
      throw new LinuxGitError(`${absolute}: path is outside the repository`);
    }
    const relative = normalized.slice(
      this.root.length === 1 ? 1 : this.root.length + 1,
    );
    validateRepositoryPath(relative);
    return relative;
  }

  absolutePath(relative: string): string {
    validateRepositoryPath(relative);
    return joinAbsolute(this.root, relative);
  }

  private writeObject(type: LinuxGitObjectType, payload: Uint8Array): string {
    if (payload.byteLength > linuxGitLimits.maximumObjectBytes) {
      throw new LinuxGitError(
        `object exceeds ${String(linuxGitLimits.maximumObjectBytes)} bytes`,
      );
    }
    this.budget.chargeBytes(payload.byteLength);
    const oid = linuxGitObjectOid(type, payload);
    const directory = this.controlPath(`objects/${oid.slice(0, 2)}`);
    const path = this.controlPath(`objects/${oid.slice(0, 2)}/${oid.slice(2)}`);
    if (!this.io.filesystem.exists(directory))
      this.makePrivateDirectory(directory);
    else this.requireRealControlEntry(directory, "directory");
    if (this.io.filesystem.exists(path)) {
      const existing = this.readObject(oid);
      if (existing.type !== type || !equalBytes(existing.payload, payload)) {
        throw new LinuxGitError(`${oid}: object collision or corrupt object`);
      }
      return oid;
    }
    this.requireObjectCapacity();
    const typeHeader = `${type} ${String(payload.byteLength)}\n`;
    const bytes = concatBytes(encodeUtf8(objectMarker + typeHeader), payload);
    this.writeBytes(path, bytes);
    this.knownObjectCount = (this.knownObjectCount ?? 0) + 1;
    return oid;
  }

  private readObject(oid: string): StoredObject {
    validateOid(oid);
    this.requireObjectCountWithinLimit();
    const directory = this.controlPath(`objects/${oid.slice(0, 2)}`);
    this.requireRealControlEntry(directory, "directory");
    const path = this.controlPath(`objects/${oid.slice(0, 2)}/${oid.slice(2)}`);
    const bytes = this.readBytes(path, linuxGitLimits.maximumObjectBytes + 96);
    const markerBytes = encodeUtf8(objectMarker);
    if (!startsWithBytes(bytes, markerBytes)) {
      throw new LinuxGitError(`${oid}: object marker is invalid`);
    }
    const headerEnd = bytes.indexOf(0x0a, markerBytes.length);
    if (headerEnd < 0 || headerEnd > markerBytes.length + 32) {
      throw new LinuxGitError(`${oid}: object header is invalid`);
    }
    const header = decodeUtf8(bytes.slice(markerBytes.length, headerEnd), oid);
    const match = /^(blob|commit|tree) ([0-9]+)$/u.exec(header);
    if (match === null)
      throw new LinuxGitError(`${oid}: object header is invalid`);
    const type = match[1] as LinuxGitObjectType;
    const size = Number(match[2]);
    if (
      !Number.isSafeInteger(size) ||
      size > linuxGitLimits.maximumObjectBytes
    ) {
      throw new LinuxGitError(`${oid}: object size is invalid`);
    }
    const payload = bytes.subarray(headerEnd + 1);
    if (payload.byteLength !== size)
      throw new LinuxGitError(`${oid}: object length mismatch`);
    if (linuxGitObjectOid(type, payload) !== oid)
      throw new LinuxGitError(`${oid}: object hash mismatch`);
    this.budget.chargeWork();
    return { oid, payload, type };
  }

  private validateControlDirectory(): void {
    this.requireRealControlEntry(this.gitDirectory, "directory");
    const owner = this.io.filesystem.getMetadata(this.gitDirectory, false).uid;
    if (owner !== this.io.effectiveUserId) {
      throw new LinuxGitError(
        `unsafe repository ownership: .git belongs to uid ${String(owner)}, current euid is ${String(this.io.effectiveUserId)}`,
      );
    }
    const markerPath = this.controlPath("CS_SYSTEM_VCS");
    if (this.readText(markerPath, 128) !== repositoryMarker) {
      throw new LinuxGitError(
        "unsupported or corrupt CS System Git repository marker",
      );
    }
    for (const relative of [
      "objects",
      "refs",
      "refs/heads",
      "refs/tags",
      "info",
    ] as const) {
      this.requireRealControlEntry(this.controlPath(relative), "directory");
    }
  }

  private validateWorktreeRoot(): void {
    if (
      !this.io.filesystem.exists(this.root) ||
      !this.io.filesystem.isDirectory(this.root)
    ) {
      throw new LinuxGitError(
        `${this.root}: repository root is not a directory`,
      );
    }
    let current = "/";
    for (const segment of this.root.split("/").filter(Boolean)) {
      current = joinAbsolute(current, segment);
      if (this.io.filesystem.isSymbolicLink(current)) {
        throw new LinuxGitError(
          `${current}: symbolic-link repository roots are not supported`,
        );
      }
    }
  }

  private requireRealControlEntry(
    path: string,
    kind: "directory" | "file",
  ): void {
    if (!this.io.filesystem.exists(path))
      throw new LinuxGitError(`${path}: required .git entry is missing`);
    if (this.io.filesystem.isSymbolicLink(path)) {
      throw new LinuxGitError(
        `${path}: symbolic links are forbidden inside .git`,
      );
    }
    const directory = this.io.filesystem.isDirectory(path);
    if ((kind === "directory") !== directory) {
      throw new LinuxGitError(`${path}: expected ${kind}`);
    }
  }

  private makePrivateDirectory(path: string): void {
    this.io.filesystem.makeDirectory(path, 0o700);
    this.io.filesystem.chmod(path, 0o700);
    this.budget.chargeWork();
  }

  private ensureControlParents(relative: string): void {
    const parts = relative.split("/").slice(0, -1);
    let path = this.gitDirectory;
    for (const part of parts) {
      path = joinAbsolute(path, part);
      if (!this.io.filesystem.exists(path)) this.makePrivateDirectory(path);
      else this.requireRealControlEntry(path, "directory");
    }
  }

  private requireExistingControlParents(relative: string): boolean {
    const parts = relative.split("/").slice(0, -1);
    let path = this.gitDirectory;
    for (const part of parts) {
      path = joinAbsolute(path, part);
      if (!this.io.filesystem.exists(path)) return false;
      this.requireRealControlEntry(path, "directory");
    }
    return true;
  }

  private requireObjectCapacity(): void {
    const count = this.requireObjectCountWithinLimit();
    if (count >= linuxGitLimits.maximumObjects) {
      throw new LinuxGitError("repository object limit exceeded");
    }
  }

  private requireObjectCountWithinLimit(): number {
    if (this.knownObjectCount !== undefined) return this.knownObjectCount;
    const root = this.controlPath("objects");
    this.requireRealControlEntry(root, "directory");
    let count = 0;
    for (const prefix of this.io.filesystem.list(root)) {
      this.budget.chargeWork();
      if (!/^[0-9a-f]{2}$/u.test(prefix)) {
        throw new LinuxGitError(`${prefix}: invalid object directory`);
      }
      const directory = joinAbsolute(root, prefix);
      this.requireRealControlEntry(directory, "directory");
      for (const suffix of this.io.filesystem.list(directory)) {
        this.budget.chargeWork();
        if (!/^[0-9a-f]{62}$/u.test(suffix)) {
          throw new LinuxGitError(
            `${prefix}/${suffix}: invalid object filename`,
          );
        }
        this.requireRealControlEntry(joinAbsolute(directory, suffix), "file");
        count += 1;
        if (count > linuxGitLimits.maximumObjects) {
          throw new LinuxGitError("repository object limit exceeded");
        }
      }
    }
    this.knownObjectCount = count;
    return count;
  }

  private readText(path: string, maximumBytes: number): string {
    return decodeUtf8(this.readBytes(path, maximumBytes), path);
  }

  private readBytes(path: string, maximumBytes: number): Uint8Array {
    this.requireRealControlEntry(path, "file");
    const size = this.io.filesystem.getSize(path);
    if (size > maximumBytes)
      throw new LinuxGitError(`${path}: file size limit exceeded`);
    const value = this.io.readFileBytes(path);
    this.budget.chargeBytes(value.byteLength);
    return value;
  }

  private writeText(path: string, value: string): void {
    const bytes = encodeUtf8(value);
    this.budget.chargeBytes(bytes.byteLength);
    this.assertWritableControlFile(path);
    this.io.writeFile(path, value);
    this.io.filesystem.chmod(path, 0o600);
  }

  private writeBytes(path: string, value: Uint8Array): void {
    this.budget.chargeBytes(value.byteLength);
    this.assertWritableControlFile(path);
    this.io.writeFileBytes(path, value);
    this.io.filesystem.chmod(path, 0o600);
  }

  private assertWritableControlFile(path: string): void {
    if (!isInside(path, this.gitDirectory) || path === this.gitDirectory) {
      throw new LinuxGitError("attempted write outside .git");
    }
    if (this.io.filesystem.exists(path))
      this.requireRealControlEntry(path, "file");
    const parent = parentPath(path);
    this.requireRealControlEntry(parent, "directory");
  }
}

export function validateRepositoryPath(path: string): void {
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    path.endsWith("/") ||
    path.includes("\\") ||
    containsAsciiControl(path)
  ) {
    throw new LinuxGitError(`${path || "<empty>"}: invalid repository path`);
  }
  if (encodeUtf8(path).byteLength > linuxGitLimits.maximumPathBytes) {
    throw new LinuxGitError(`${path}: repository path is too long`);
  }
  const segments = path.split("/");
  if (
    segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === "..",
    )
  ) {
    throw new LinuxGitError(`${path}: unsafe repository path segment`);
  }
  if (segments[0] === ".git")
    throw new LinuxGitError(".git is reserved repository metadata");
}

export function validateBranchName(name: string): void {
  const segments = name.split("/");
  if (
    !branchNamePattern.test(name) ||
    name.includes("..") ||
    name.includes("//") ||
    name.endsWith(".lock") ||
    name.includes("@{") ||
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment.startsWith(".") ||
        segment.endsWith(".") ||
        segment.endsWith(".lock"),
    )
  ) {
    throw new LinuxGitError(`${name}: invalid branch name`, 2);
  }
}

export function validateTagName(name: string): void {
  if (!validShortRefName(name) || name.endsWith(".lock")) {
    throw new LinuxGitError(`${name}: invalid tag name`, 2);
  }
}

function parseConfig(value: string): LinuxGitConfig {
  if (encodeUtf8(value).byteLength > linuxGitLimits.maximumConfigBytes) {
    throw new LinuxGitError("config size limit exceeded");
  }
  let section = "";
  let remoteName: string | undefined;
  let formatVersion: string | undefined;
  let bare: string | undefined;
  let extension: string | undefined;
  let objectFormat: string | undefined;
  let userName: string | undefined;
  let userEmail: string | undefined;
  const remotes = new Map<string, string>();
  const seenKeys = new Set<string>();
  for (const rawLine of value.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#") || line.startsWith(";"))
      continue;
    const sectionMatch = /^\[([a-z]+)(?: "([A-Za-z0-9._-]+)")?\]$/u.exec(line);
    if (sectionMatch !== null) {
      section = sectionMatch[1]!;
      remoteName = section === "remote" ? sectionMatch[2] : undefined;
      if (section === "remote" && remoteName === undefined) {
        throw new LinuxGitError("config remote section is invalid");
      }
      if (!["core", "extensions", "remote", "user"].includes(section)) {
        throw new LinuxGitError(`unsupported config section: ${section}`);
      }
      continue;
    }
    const assignment = /^([A-Za-z][A-Za-z0-9]*)\s*=\s*(.*)$/u.exec(line);
    if (assignment === null || section.length === 0)
      throw new LinuxGitError("config syntax is invalid");
    const key = assignment[1]!.toLowerCase();
    const contents = assignment[2]!;
    validateConfigValue(contents);
    const identity = `${section}:${remoteName ?? ""}:${key}`;
    if (seenKeys.has(identity)) {
      throw new LinuxGitError(`duplicate config key: ${section}.${key}`);
    }
    seenKeys.add(identity);
    if (section === "core" && key === "repositoryformatversion")
      formatVersion = contents;
    else if (section === "core" && key === "bare") bare = contents;
    else if (section === "extensions" && key === "computersystemvcs")
      extension = contents;
    else if (section === "extensions" && key === "objectformat")
      objectFormat = contents;
    else if (section === "user" && key === "name") userName = contents;
    else if (section === "user" && key === "email") userEmail = contents;
    else if (
      section === "remote" &&
      key === "url" &&
      remoteName !== undefined
    ) {
      parseLinuxGitRemoteEndpoint(contents);
      if (remotes.has(remoteName))
        throw new LinuxGitError(`duplicate remote: ${remoteName}`);
      remotes.set(remoteName, contents);
    } else {
      throw new LinuxGitError(`unsupported config key: ${section}.${key}`);
    }
  }
  if (
    formatVersion !== "1" ||
    bare !== "false" ||
    extension !== "1" ||
    objectFormat !== "sha256"
  ) {
    throw new LinuxGitError(
      "repository format or required CS System Git extension is invalid",
    );
  }
  return Object.freeze({ remotes, userEmail, userName });
}

function renderConfig(config: LinuxGitConfig): string {
  if (config.remotes.size > 16)
    throw new LinuxGitError("remote limit exceeded");
  const lines = [
    "[core]",
    "    repositoryformatversion = 1",
    "    bare = false",
    "[extensions]",
    "    computerSystemVcs = 1",
    "    objectFormat = sha256",
  ];
  if (config.userName !== undefined || config.userEmail !== undefined) {
    lines.push("[user]");
    if (config.userName !== undefined) {
      validateConfigValue(config.userName);
      lines.push(`    name = ${config.userName}`);
    }
    if (config.userEmail !== undefined) {
      validateConfigValue(config.userEmail);
      lines.push(`    email = ${config.userEmail}`);
    }
  }
  for (const [name, url] of [...config.remotes].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (!validShortRefName(name))
      throw new LinuxGitError(`${name}: invalid remote name`);
    parseLinuxGitRemoteEndpoint(url);
    lines.push(`[remote "${name}"]`, `    url = ${url}`);
  }
  const value = `${lines.join("\n")}\n`;
  if (encodeUtf8(value).byteLength > linuxGitLimits.maximumConfigBytes) {
    throw new LinuxGitError("config size limit exceeded");
  }
  return value;
}

function validateConfigValue(value: string): void {
  if (
    value.length === 0 ||
    value !== value.trim() ||
    containsAsciiControl(value) ||
    encodeUtf8(value).byteLength > linuxGitLimits.maximumRemoteUrlBytes
  ) {
    throw new LinuxGitError("config value is empty, unsafe, or too long", 2);
  }
}

function parseEntries(
  value: unknown,
  context: string,
): readonly LinuxGitIndexEntry[] {
  if (
    !Array.isArray(value) ||
    value.length > linuxGitLimits.maximumTrackedEntries
  ) {
    throw new LinuxGitError(`${context} entry limit exceeded`);
  }
  const entries: LinuxGitIndexEntry[] = [];
  let previous = "";
  for (const candidate of value) {
    if (
      !isRecord(candidate) ||
      !hasOnlyKeys(candidate, ["mode", "oid", "path"]) ||
      !validMode(candidate.mode) ||
      typeof candidate.oid !== "string" ||
      typeof candidate.path !== "string"
    ) {
      throw new LinuxGitError(`${context} entry is invalid`);
    }
    validateOid(candidate.oid);
    validateRepositoryPath(candidate.path);
    if (candidate.path <= previous)
      throw new LinuxGitError(`${context} entries are not uniquely sorted`);
    if (previous.length > 0 && candidate.path.startsWith(`${previous}/`)) {
      throw new LinuxGitError(
        `${context} contains a file/directory path collision`,
      );
    }
    previous = candidate.path;
    entries.push({
      mode: candidate.mode,
      oid: candidate.oid,
      path: candidate.path,
    });
  }
  return entries;
}

function normalizeEntries(
  entries: readonly LinuxGitIndexEntry[],
  context: string,
): readonly LinuxGitIndexEntry[] {
  if (entries.length > linuxGitLimits.maximumTrackedEntries) {
    throw new LinuxGitError(`${context} entry limit exceeded`);
  }
  const sorted = [...entries].sort((left, right) =>
    compareRepositoryPath(left.path, right.path),
  );
  for (let index = 0; index < sorted.length; index += 1) {
    const entry = sorted[index]!;
    validateRepositoryPath(entry.path);
    validateOid(entry.oid);
    if (!validMode(entry.mode))
      throw new LinuxGitError(`${entry.path}: invalid file mode`);
    if (index > 0 && sorted[index - 1]!.path === entry.path) {
      throw new LinuxGitError(`${entry.path}: duplicate ${context} entry`);
    }
    if (index > 0 && entry.path.startsWith(`${sorted[index - 1]!.path}/`)) {
      throw new LinuxGitError(
        `${entry.path}: ${context} file/directory path collision`,
      );
    }
  }
  return Object.freeze(sorted.map((entry) => Object.freeze({ ...entry })));
}

function validateCommit(commit: LinuxGitCommit): void {
  validateOid(commit.tree);
  if (commit.parents.length > 2)
    throw new LinuxGitError("commit parent limit exceeded");
  for (const parent of commit.parents) validateOid(parent);
  validateIdentityValue(commit.authorName, "author name");
  validateIdentityValue(commit.authorEmail, "author email");
  if (
    !Number.isSafeInteger(commit.timestampMilliseconds) ||
    commit.timestampMilliseconds < 0
  ) {
    throw new LinuxGitError("commit timestamp is invalid");
  }
  if (
    commit.message.length === 0 ||
    encodeUtf8(commit.message).byteLength >
      linuxGitLimits.maximumCommitMessageBytes ||
    commit.message.includes("\u0000")
  ) {
    throw new LinuxGitError("commit message is empty or exceeds its limit", 2);
  }
}

function validateIdentityValue(value: string, label: string): void {
  if (
    value.length === 0 ||
    value.length > 128 ||
    containsAsciiControl(value) ||
    value.includes("<") ||
    value.includes(">")
  ) {
    throw new LinuxGitError(`${label} is invalid`);
  }
}

function containsAsciiControl(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint <= 0x1f || codePoint === 0x7f) return true;
  }
  return false;
}

export function linuxGitObjectOid(
  type: LinuxGitObjectType,
  payload: Uint8Array,
): string {
  return sha256BytePartsHex([
    encodeUtf8(`${type} ${String(payload.byteLength)}\u0000`),
    payload,
  ]);
}

function validateOid(value: string): void {
  if (!oidPattern.test(value))
    throw new LinuxGitError(`${value}: invalid object ID`);
}

function validateFullRef(reference: string): void {
  if (reference.startsWith("refs/heads/")) {
    validateBranchName(reference.slice("refs/heads/".length));
    return;
  }
  if (reference.startsWith("refs/tags/")) {
    validateTagName(reference.slice("refs/tags/".length));
    return;
  }
  if (reference.startsWith("refs/remotes/")) {
    const rest = reference.slice("refs/remotes/".length);
    if (!branchNamePattern.test(rest))
      throw new LinuxGitError(`${reference}: invalid remote ref`);
    return;
  }
  throw new LinuxGitError(`${reference}: unsupported ref namespace`);
}

function validShortRefName(value: string): boolean {
  return (
    shortRefNamePattern.test(value) &&
    !value.includes("..") &&
    !value.endsWith(".")
  );
}

function validateControlRelativePath(value: string): void {
  if (
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.includes("\\") ||
    value
      .split("/")
      .some((part) => part.length === 0 || part === "." || part === "..")
  ) {
    throw new LinuxGitError(`${value}: invalid .git path`);
  }
}

function validMode(value: unknown): value is LinuxGitFileMode {
  return value === 100_644 || value === 100_755 || value === 120_000;
}

function decodeUtf8(value: Uint8Array, source: string): string {
  try {
    return decodeUtf8Bytes(value);
  } catch {
    throw new LinuxGitError(`${source}: invalid UTF-8 metadata`);
  }
}

function parseJson(value: string, context: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new LinuxGitError(`${context}: invalid JSON metadata`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const allowed = new Set(keys);
  return (
    Object.keys(value).every((key) => allowed.has(key)) &&
    keys.every((key) => key in value)
  );
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const output = new Uint8Array(left.byteLength + right.byteLength);
  output.set(left, 0);
  output.set(right, left.byteLength);
  return output;
}

function startsWithBytes(value: Uint8Array, prefix: Uint8Array): boolean {
  if (value.byteLength < prefix.byteLength) return false;
  for (let index = 0; index < prefix.byteLength; index += 1) {
    if (value[index] !== prefix[index]) return false;
  }
  return true;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function compareRepositoryPath(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function joinAbsolute(base: string, child: string): string {
  return base === "/" ? `/${child}` : `${base}/${child}`;
}

function parentPath(path: string): string {
  if (path === "/") return "/";
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
}

function isInside(path: string, directory: string): boolean {
  return (
    path === directory ||
    path.startsWith(directory === "/" ? "/" : `${directory}/`)
  );
}

function requireNonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError(`${name} must be non-negative`);
}
