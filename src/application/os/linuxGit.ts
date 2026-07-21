import { decodeUtf8, encodeUtf8 } from "../../domain/text/utf8.js";
import {
  linuxGitIgnoreLimits,
  linuxGitPathIgnored,
  parseLinuxGitIgnore,
  type LinuxGitIgnoreBudget,
  type LinuxGitIgnoreMatchBudget,
  type LinuxGitIgnoreRule,
} from "./linuxGitIgnore.js";
import {
  LinuxGitError,
  LinuxGitOperationBudget,
  LinuxGitRepository,
  linuxGitLimits,
  linuxGitObjectOid,
  validateBranchName,
  validateRepositoryPath,
  validateTagName,
  type LinuxGitCommit,
  type LinuxGitConfig,
  type LinuxGitFileMode,
  type LinuxGitIndexEntry,
  type LinuxGitIo,
} from "./linuxGitRepository.js";
import { parseLinuxGitRemoteEndpoint } from "./linuxGitRemote.js";

export interface LinuxGitCommandResult {
  readonly cpuCycles: number;
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

interface WorktreeEntry {
  readonly absolutePath: string;
  readonly ignored: boolean;
  readonly mode: LinuxGitFileMode;
  readonly path: string;
}

interface WorktreeScan {
  readonly directories: ReadonlyMap<string, boolean>;
  readonly entries: readonly WorktreeEntry[];
}

interface ReadWorktreeEntry {
  readonly contents: Uint8Array;
  readonly entry: LinuxGitIndexEntry;
}

interface Change {
  readonly kind: "added" | "deleted" | "modified";
  readonly path: string;
}

const gitUsage =
  "git <init|status|add|rm|commit|log|show|diff|branch|switch|checkout|merge|tag|remote|config>";

export function executeLinuxGit(
  arguments_: readonly string[],
  io: LinuxGitIo,
): LinuxGitCommandResult {
  const budget = new LinuxGitOperationBudget();
  try {
    const [command, ...operands] = arguments_;
    if (command === undefined || command === "help" || command === "--help") {
      return result(budget, 0, `${gitUsage}\n`, "");
    }
    if (command === "--version" || command === "version") {
      return result(
        budget,
        0,
        "CS System Git 1.0 (independent bounded format)\n",
        "",
      );
    }
    if (["clone", "fetch", "pull", "push"].includes(command)) {
      return result(
        budget,
        1,
        "",
        `git: ${command}: authenticated guest TCP/IP transport is not available in CS-Linux 1.0\n`,
      );
    }
    if (command === "init") return initialize(operands, io, budget);
    const repository = LinuxGitRepository.discover(io, budget);
    switch (command) {
      case "add":
        return add(repository, operands);
      case "branch":
        return branch(repository, operands);
      case "checkout":
        return checkout(repository, operands);
      case "commit":
        return commit(repository, operands);
      case "config":
        return config(repository, operands);
      case "diff":
        return diff(repository, operands);
      case "log":
        return log(repository, operands);
      case "merge":
        return merge(repository, operands);
      case "remote":
        return remote(repository, operands);
      case "rm":
        return remove(repository, operands);
      case "show":
        return show(repository, operands);
      case "status":
        return status(repository, operands);
      case "switch":
        return switchBranch(repository, operands);
      case "tag":
        return tag(repository, operands);
      default:
        throw new LinuxGitError(
          `${command}: unsupported command\nusage: ${gitUsage}`,
          2,
        );
    }
  } catch (error: unknown) {
    const gitError =
      error instanceof LinuxGitError
        ? error
        : new LinuxGitError(
            error instanceof Error ? error.message : String(error),
          );
    return result(budget, gitError.exitCode, "", `git: ${gitError.message}\n`);
  }
}

function initialize(
  arguments_: readonly string[],
  io: LinuxGitIo,
  budget: LinuxGitOperationBudget,
): LinuxGitCommandResult {
  let initialBranch = "main";
  let directory: string | undefined;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    if (argument.startsWith("--initial-branch=")) {
      initialBranch = argument.slice("--initial-branch=".length);
    } else if (argument === "-b" || argument === "--initial-branch") {
      initialBranch = requireOperand(arguments_, ++index, argument);
    } else if (argument.startsWith("-")) {
      throw new LinuxGitError(`init: unsupported option: ${argument}`, 2);
    } else if (directory === undefined) {
      directory = argument;
    } else {
      throw new LinuxGitError("usage: git init [-b <branch>] [directory]", 2);
    }
  }
  validateBranchName(initialBranch);
  const root = resolveGuestPath(io, directory ?? io.currentDirectory);
  const initialized = LinuxGitRepository.initialize(
    root,
    initialBranch,
    io,
    budget,
  );
  const label = initialized.reinitialized ? "Reinitialized" : "Initialized";
  return result(
    budget,
    0,
    `${label} empty CS System Git repository in ${initialized.repository.gitDirectory}\n`,
    "",
  );
}

function status(
  repository: LinuxGitRepository,
  arguments_: readonly string[],
): LinuxGitCommandResult {
  const short =
    arguments_.length === 1 && ["-s", "--short"].includes(arguments_[0]!);
  if (arguments_.length > (short ? 1 : 0)) {
    throw new LinuxGitError("usage: git status [--short]", 2);
  }
  const index = repository.readIndex();
  const head = repository.readHead();
  const headEntries = repository.treeAtCommit(head.oid);
  const scan = scanWorktree(repository, index, false);
  const workByPath = new Map(
    scan.entries.map((entry) => [entry.path, entry] as const),
  );
  const staged = compareEntrySets(headEntries, index);
  const unstaged: Change[] = [];
  for (const entry of index) {
    const work = workByPath.get(entry.path);
    if (work === undefined) {
      unstaged.push({ kind: "deleted", path: entry.path });
      continue;
    }
    const actual = readWorktreeEntry(repository, work);
    if (!sameEntry(entry, actual.entry)) {
      unstaged.push({ kind: "modified", path: entry.path });
    }
  }
  const tracked = new Set(index.map((entry) => entry.path));
  const untracked = scan.entries
    .filter((entry) => !entry.ignored && !tracked.has(entry.path))
    .map((entry) => entry.path)
    .sort();
  if (short) {
    const rows = renderShortStatus(staged, unstaged, untracked);
    return success(repository, rows.length === 0 ? "" : `${rows.join("\n")}\n`);
  }

  const output: string[] = [];
  const branchName = repository.currentBranchName();
  output.push(
    branchName === undefined ? "HEAD detached" : `On branch ${branchName}`,
  );
  if (head.oid === undefined) output.push("No commits yet");
  appendChangeSection(output, "Changes to be committed:", staged);
  appendChangeSection(output, "Changes not staged for commit:", unstaged);
  if (untracked.length > 0) {
    output.push(
      "",
      "Untracked files:",
      ...untracked.map((path) => `  ${path}`),
    );
  }
  if (staged.length === 0 && unstaged.length === 0 && untracked.length === 0) {
    output.push("", "nothing to commit, working tree clean");
  }
  return success(repository, `${output.join("\n")}\n`);
}

function add(
  repository: LinuxGitRepository,
  arguments_: readonly string[],
): LinuxGitCommandResult {
  let all = false;
  let force = false;
  let options = true;
  const pathArguments: string[] = [];
  for (const argument of arguments_) {
    if (options && argument === "--") {
      options = false;
    } else if (options && (argument === "-A" || argument === "--all")) {
      all = true;
    } else if (options && (argument === "-f" || argument === "--force")) {
      force = true;
    } else if (options && argument.startsWith("-")) {
      throw new LinuxGitError(`add: unsupported option: ${argument}`, 2);
    } else {
      pathArguments.push(argument);
    }
  }
  if (!all && pathArguments.length === 0) {
    throw new LinuxGitError("usage: git add [-A] [-f] [--] <path ...>", 2);
  }
  const index = repository.readIndex();
  const scan = scanWorktree(repository, index, true);
  const scopes =
    all && pathArguments.length === 0
      ? [""]
      : pathArguments.map((path) => resolvePathScope(repository, path));
  validateScopes(repository, scopes, scan, index);
  if (!force) {
    for (let index_ = 0; index_ < scopes.length; index_ += 1) {
      const scope = scopes[index_]!;
      if (scope.length === 0) continue;
      const exact = scan.entries.find((entry) => entry.path === scope);
      if (exact?.ignored === true || scan.directories.get(scope) === true) {
        throw new LinuxGitError(
          `${pathArguments[index_] ?? scope}: ignored by a .gitignore or info/exclude rule (use -f to add)`,
        );
      }
    }
  }

  const next = new Map(index.map((entry) => [entry.path, entry] as const));
  const workByPath = new Map(
    scan.entries.map((entry) => [entry.path, entry] as const),
  );
  const selectedWork = scan.entries.filter(
    (entry) =>
      scopes.some((scope) => pathInScope(entry.path, scope)) &&
      (force || !entry.ignored || next.has(entry.path)),
  );
  for (const entry of index) {
    if (
      scopes.some((scope) => pathInScope(entry.path, scope)) &&
      !workByPath.has(entry.path)
    ) {
      next.delete(entry.path);
    }
  }
  repository.transaction(() => {
    for (const worktree of selectedWork) {
      const read = readWorktreeEntry(repository, worktree);
      const oid = repository.writeBlob(read.contents);
      next.set(read.entry.path, { ...read.entry, oid });
    }
    repository.writeIndex([...next.values()]);
  });
  return success(repository);
}

function remove(
  repository: LinuxGitRepository,
  arguments_: readonly string[],
): LinuxGitCommandResult {
  let cached = false;
  let force = false;
  let recursive = false;
  let options = true;
  const paths: string[] = [];
  for (const argument of arguments_) {
    if (options && argument === "--") options = false;
    else if (options && argument === "--cached") cached = true;
    else if (options && (argument === "-f" || argument === "--force"))
      force = true;
    else if (options && (argument === "-r" || argument === "--recursive"))
      recursive = true;
    else if (options && argument.startsWith("-")) {
      throw new LinuxGitError(`rm: unsupported option: ${argument}`, 2);
    } else paths.push(argument);
  }
  if (paths.length === 0) {
    throw new LinuxGitError(
      "usage: git rm [-r] [-f] [--cached] [--] <path ...>",
      2,
    );
  }
  const index = repository.readIndex();
  const scopes = paths.map((path) => resolvePathScope(repository, path));
  const selected = index.filter((entry) =>
    scopes.some((scope) => pathInScope(entry.path, scope)),
  );
  if (selected.length === 0)
    throw new LinuxGitError("pathspec did not match any tracked files");
  for (const scope of scopes) {
    const nested = selected.some(
      (entry) => entry.path !== scope && pathInScope(entry.path, scope),
    );
    if (nested && !recursive)
      throw new LinuxGitError(`${scope || "."}: is a directory (use -r)`);
  }
  if (!cached && !force) {
    const scan = scanWorktree(repository, index, true);
    const workByPath = new Map(
      scan.entries.map((entry) => [entry.path, entry] as const),
    );
    for (const entry of selected) {
      const work = workByPath.get(entry.path);
      if (work === undefined) continue;
      if (!sameEntry(entry, readWorktreeEntry(repository, work).entry)) {
        throw new LinuxGitError(
          `${entry.path}: local modifications would be lost (use -f)`,
        );
      }
    }
  }
  const selectedPaths = new Set(selected.map((entry) => entry.path));
  const next = index.filter((entry) => !selectedPaths.has(entry.path));
  repository.transaction(() => {
    if (!cached) {
      for (const entry of selected) {
        const absolute = repository.absolutePath(entry.path);
        if (!repository.io.filesystem.exists(absolute)) continue;
        if (
          repository.io.filesystem.isDirectory(absolute) &&
          !repository.io.filesystem.isSymbolicLink(absolute)
        ) {
          throw new LinuxGitError(
            `${entry.path}: tracked path unexpectedly became a directory`,
          );
        }
        repository.io.filesystem.delete(absolute);
      }
    }
    repository.writeIndex(next);
  });
  return success(
    repository,
    `${selected.map((entry) => `rm '${entry.path}'`).join("\n")}\n`,
  );
}

function commit(
  repository: LinuxGitRepository,
  arguments_: readonly string[],
): LinuxGitCommandResult {
  const messages: string[] = [];
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    if (argument === "-m" || argument === "--message") {
      messages.push(requireOperand(arguments_, ++index, argument));
    } else if (argument.startsWith("--message=")) {
      messages.push(argument.slice("--message=".length));
    } else {
      throw new LinuxGitError("usage: git commit -m <message>", 2);
    }
  }
  if (messages.length === 0) {
    throw new LinuxGitError(
      "commit requires -m because an interactive editor is not available",
      2,
    );
  }
  const message = messages.join("\n\n");
  const index = repository.readIndex();
  const headBefore = repository.readHead();
  const headTree = repository.treeAtCommit(headBefore.oid);
  if (compareEntrySets(headTree, index).length === 0) {
    throw new LinuxGitError("nothing to commit, working tree unchanged");
  }
  for (const entry of index) {
    if (repository.objectType(entry.oid) !== "blob") {
      throw new LinuxGitError(`${entry.path}: index does not reference a blob`);
    }
  }
  const configuration = repository.readConfig();
  const identity = commitIdentity(repository, configuration);
  let commitOid = "";
  repository.transaction(() => {
    const current = repository.readHead();
    if (current.oid !== headBefore.oid || current.ref !== headBefore.ref) {
      throw new LinuxGitError("HEAD changed concurrently; commit aborted");
    }
    const tree = repository.writeTree(index);
    commitOid = repository.writeCommit({
      authorEmail: identity.email,
      authorName: identity.name,
      message,
      parents: headBefore.oid === undefined ? [] : [headBefore.oid],
      timestampMilliseconds: repository.io.nowMilliseconds(),
      tree,
    });
    if (headBefore.ref === undefined) repository.writeDetachedHead(commitOid);
    else repository.updateRef(headBefore.ref, headBefore.oid, commitOid);
  });
  const branchName = repository.currentBranchName() ?? "detached HEAD";
  return success(
    repository,
    `[${branchName} ${commitOid.slice(0, 12)}] ${firstLine(message)}\n`,
  );
}

function scanWorktree(
  repository: LinuxGitRepository,
  index: readonly LinuxGitIndexEntry[],
  includeIgnored: boolean,
): WorktreeScan {
  const ignoreBudget: LinuxGitIgnoreBudget = { files: 0, rules: 0 };
  const ignoreMatchBudget: LinuxGitIgnoreMatchBudget = { steps: 0 };
  const infoExclude = repository.readInfoExclude();
  const baseRules = parseLinuxGitIgnore(
    infoExclude,
    "",
    ".git/info/exclude",
    ignoreBudget,
  );
  repository.budget.chargeWork(baseRules.length);
  const entries: WorktreeEntry[] = [];
  const directories = new Map<string, boolean>();
  const trackedDirectories = new Set(
    index.flatMap((entry) => repositoryPathParents(entry.path)),
  );
  const pending: Array<{
    readonly absolutePath: string;
    readonly blocked: boolean;
    readonly relativePath: string;
    readonly rules: readonly LinuxGitIgnoreRule[];
  }> = [
    {
      absolutePath: repository.root,
      blocked: false,
      relativePath: "",
      rules: baseRules,
    },
  ];
  let traversed = 0;
  while (pending.length > 0) {
    const current = pending.pop()!;
    let rules = current.rules;
    const ignorePath = joinAbsolute(current.absolutePath, ".gitignore");
    if (
      !current.blocked &&
      repository.io.filesystem.exists(ignorePath) &&
      !repository.io.filesystem.isSymbolicLink(ignorePath) &&
      !repository.io.filesystem.isDirectory(ignorePath)
    ) {
      const ignoreSize = repository.io.filesystem.getSize(ignorePath);
      if (ignoreSize > linuxGitIgnoreLimits.maximumFileBytes) {
        throw new LinuxGitError(
          `${current.relativePath.length === 0 ? ".gitignore" : `${current.relativePath}/.gitignore`}: ignore file exceeds ${String(linuxGitIgnoreLimits.maximumFileBytes)} bytes`,
        );
      }
      repository.budget.chargeBytes(ignoreSize);
      const nestedRules = parseLinuxGitIgnore(
        repository.io.readFile(ignorePath),
        current.relativePath,
        current.relativePath.length === 0
          ? ".gitignore"
          : `${current.relativePath}/.gitignore`,
        ignoreBudget,
      );
      repository.budget.chargeWork(nestedRules.length);
      rules = [...rules, ...nestedRules];
    }
    for (const name of repository.io.filesystem
      .list(current.absolutePath)
      .toReversed()) {
      if (current.relativePath.length === 0 && name === ".git") continue;
      traversed += 1;
      repository.budget.chargeWork();
      if (traversed > linuxGitLimits.maximumTraversalEntries) {
        throw new LinuxGitError("worktree traversal entry limit exceeded");
      }
      const relativePath =
        current.relativePath.length === 0
          ? name
          : `${current.relativePath}/${name}`;
      validateRepositoryPath(relativePath);
      const absolutePath = joinAbsolute(current.absolutePath, name);
      const symbolicLink =
        repository.io.filesystem.isSymbolicLink(absolutePath);
      const directory =
        !symbolicLink && repository.io.filesystem.isDirectory(absolutePath);
      const ignored =
        current.blocked ||
        pathIgnoredWithAccounting(
          repository,
          rules,
          relativePath,
          directory,
          ignoreMatchBudget,
        );
      if (directory) {
        directories.set(relativePath, ignored);
        const trackedBelow = trackedDirectories.has(relativePath);
        if (includeIgnored || !ignored || trackedBelow) {
          pending.push({
            absolutePath,
            blocked: current.blocked || ignored,
            relativePath,
            rules,
          });
        }
        continue;
      }
      const metadata = repository.io.filesystem.getMetadata(
        absolutePath,
        false,
      );
      entries.push({
        absolutePath,
        ignored,
        mode: symbolicLink
          ? 120_000
          : (metadata.mode & 0o111) === 0
            ? 100_644
            : 100_755,
        path: relativePath,
      });
    }
  }
  entries.sort((left, right) => compareRepositoryPath(left.path, right.path));
  return { directories, entries };
}

function pathIgnoredWithAccounting(
  repository: LinuxGitRepository,
  rules: readonly LinuxGitIgnoreRule[],
  path: string,
  directory: boolean,
  budget: LinuxGitIgnoreMatchBudget,
): boolean {
  const before = budget.steps;
  try {
    return linuxGitPathIgnored(rules, path, directory, budget);
  } finally {
    const steps = budget.steps - before;
    if (steps > 0) repository.budget.chargeWork(Math.ceil(steps / 16));
  }
}

function readWorktreeEntry(
  repository: LinuxGitRepository,
  worktree: WorktreeEntry,
): ReadWorktreeEntry {
  const contents =
    worktree.mode === 120_000
      ? encodeUtf8(repository.io.readLink(worktree.absolutePath))
      : repository.io.readFileBytes(worktree.absolutePath);
  repository.budget.chargeBytes(contents.byteLength);
  if (contents.byteLength > linuxGitLimits.maximumObjectBytes) {
    throw new LinuxGitError(
      `${worktree.path}: file exceeds the Git object size limit`,
    );
  }
  return {
    contents,
    entry: {
      mode: worktree.mode,
      oid: linuxGitObjectOid("blob", contents),
      path: worktree.path,
    },
  };
}

function compareEntrySets(
  left: readonly LinuxGitIndexEntry[],
  right: readonly LinuxGitIndexEntry[],
): readonly Change[] {
  const leftMap = new Map(left.map((entry) => [entry.path, entry] as const));
  const rightMap = new Map(right.map((entry) => [entry.path, entry] as const));
  const paths = [...new Set([...leftMap.keys(), ...rightMap.keys()])].sort();
  return paths.flatMap((path): Change[] => {
    const before = leftMap.get(path);
    const after = rightMap.get(path);
    if (before === undefined) return [{ kind: "added", path }];
    if (after === undefined) return [{ kind: "deleted", path }];
    return sameEntry(before, after) ? [] : [{ kind: "modified", path }];
  });
}

function sameEntry(
  left: LinuxGitIndexEntry,
  right: LinuxGitIndexEntry,
): boolean {
  return left.mode === right.mode && left.oid === right.oid;
}

function appendChangeSection(
  output: string[],
  heading: string,
  changes: readonly Change[],
): void {
  if (changes.length === 0) return;
  output.push("", heading);
  for (const change of changes) {
    const label = change.kind === "added" ? "new file" : change.kind;
    output.push(`  ${label}: ${change.path}`);
  }
}

function renderShortStatus(
  staged: readonly Change[],
  unstaged: readonly Change[],
  untracked: readonly string[],
): readonly string[] {
  const rows = new Map<string, [string, string]>();
  for (const change of staged)
    rows.set(change.path, [statusLetter(change.kind), " "]);
  for (const change of unstaged) {
    const row = rows.get(change.path) ?? [" ", " "];
    row[1] = statusLetter(change.kind);
    rows.set(change.path, row);
  }
  return [
    ...[...rows]
      .sort(([left], [right]) => compareRepositoryPath(left, right))
      .map(([path, letters]) => `${letters[0]}${letters[1]} ${path}`),
    ...untracked.map((path) => `?? ${path}`),
  ];
}

function statusLetter(kind: Change["kind"]): string {
  return kind === "added" ? "A" : kind === "deleted" ? "D" : "M";
}

function containsAsciiControl(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint <= 0x1f || codePoint === 0x7f) return true;
  }
  return false;
}

function resolvePathScope(
  repository: LinuxGitRepository,
  value: string,
): string {
  if (value.length === 0 || containsAsciiControl(value)) {
    throw new LinuxGitError(`${value || "<empty>"}: invalid pathspec`, 2);
  }
  const absolute = resolveGuestPath(repository.io, value);
  if (absolute === repository.root) return "";
  return repository.relativePath(absolute);
}

function validateScopes(
  repository: LinuxGitRepository,
  scopes: readonly string[],
  scan: WorktreeScan,
  index: readonly LinuxGitIndexEntry[],
): void {
  for (const scope of scopes) {
    if (scope.length === 0) continue;
    const matched =
      scan.directories.has(scope) ||
      scan.entries.some((entry) => pathInScope(entry.path, scope)) ||
      index.some((entry) => pathInScope(entry.path, scope));
    if (!matched)
      throw new LinuxGitError(`${scope}: pathspec did not match any files`);
    const absolute = repository.absolutePath(scope);
    if (isInside(absolute, repository.gitDirectory)) {
      throw new LinuxGitError(".git is reserved repository metadata");
    }
  }
}

function pathInScope(path: string, scope: string): boolean {
  return scope.length === 0 || path === scope || path.startsWith(`${scope}/`);
}

function resolveGuestPath(io: LinuxGitIo, value: string): string {
  return io.filesystem.normalize(
    value.startsWith("/")
      ? value
      : `${io.currentDirectory === "/" ? "" : io.currentDirectory}/${value}`,
  );
}

function commitIdentity(
  repository: LinuxGitRepository,
  configuration: LinuxGitConfig,
): { readonly email: string; readonly name: string } {
  return {
    email:
      configuration.userEmail ??
      `${repository.io.loginName}@${repository.io.computerName}`,
    name: configuration.userName ?? repository.io.loginName,
  };
}

function requireOperand(
  arguments_: readonly string[],
  index: number,
  option: string,
): string {
  const value = arguments_[index];
  if (value === undefined)
    throw new LinuxGitError(`${option}: missing value`, 2);
  return value;
}

function firstLine(value: string): string {
  return value.split(/\r?\n/u)[0] ?? "";
}

function result(
  budget: LinuxGitOperationBudget,
  exitCode: number,
  stdout: string,
  stderr: string,
): LinuxGitCommandResult {
  return { cpuCycles: budget.cpuCycles, exitCode, stderr, stdout };
}

function success(
  repository: LinuxGitRepository,
  stdout = "",
): LinuxGitCommandResult {
  if (encodeUtf8(stdout).byteLength > linuxGitLimits.maximumDiffBytes) {
    throw new LinuxGitError("command output limit exceeded");
  }
  return result(repository.budget, 0, stdout, "");
}

function joinAbsolute(base: string, child: string): string {
  return base === "/" ? `/${child}` : `${base}/${child}`;
}

function isInside(path: string, directory: string): boolean {
  return (
    path === directory ||
    path.startsWith(directory === "/" ? "/" : `${directory}/`)
  );
}

function diff(
  repository: LinuxGitRepository,
  arguments_: readonly string[],
): LinuxGitCommandResult {
  let cached = false;
  let options = true;
  const pathArguments: string[] = [];
  for (const argument of arguments_) {
    if (options && argument === "--") options = false;
    else if (options && (argument === "--cached" || argument === "--staged"))
      cached = true;
    else if (options && argument.startsWith("-")) {
      throw new LinuxGitError(`diff: unsupported option: ${argument}`, 2);
    } else pathArguments.push(argument);
  }
  const scopes = pathArguments.map((path) =>
    resolvePathScope(repository, path),
  );
  const selected = (path: string): boolean =>
    scopes.length === 0 || scopes.some((scope) => pathInScope(path, scope));
  const index = repository.readIndex();
  let output: string;
  if (cached) {
    const head = repository.treeAtCommit(repository.readHead().oid);
    output = renderStoredDiff(repository, head, index, selected);
  } else {
    const scan = scanWorktree(repository, index, true);
    const work = new Map(
      scan.entries.map((entry) => [entry.path, entry] as const),
    );
    const chunks: string[] = [];
    let outputBytes = 0;
    for (const entry of index) {
      if (!selected(entry.path)) continue;
      const current = work.get(entry.path);
      if (current === undefined) {
        outputBytes = appendDiffChunk(
          chunks,
          renderOneDiff(
            repository,
            entry.path,
            entry,
            undefined,
            repository.readBlob(entry.oid),
            undefined,
          ),
          outputBytes,
        );
        continue;
      }
      const read = readWorktreeEntry(repository, current);
      if (!sameEntry(entry, read.entry)) {
        outputBytes = appendDiffChunk(
          chunks,
          renderOneDiff(
            repository,
            entry.path,
            entry,
            read.entry,
            repository.readBlob(entry.oid),
            read.contents,
          ),
          outputBytes,
        );
      }
    }
    output = chunks.join("");
  }
  requireDiffOutputWithinLimit(output);
  return success(repository, output);
}

function log(
  repository: LinuxGitRepository,
  arguments_: readonly string[],
): LinuxGitCommandResult {
  let limit: number = linuxGitLimits.maximumHistoryCommits;
  let oneline = false;
  let revision = "HEAD";
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    if (argument === "--oneline") oneline = true;
    else if (argument === "-n" || argument === "--max-count") {
      limit = parseHistoryLimit(requireOperand(arguments_, ++index, argument));
    } else if (argument.startsWith("-n") && argument.length > 2) {
      limit = parseHistoryLimit(argument.slice(2));
    } else if (argument.startsWith("--max-count=")) {
      limit = parseHistoryLimit(argument.slice("--max-count=".length));
    } else if (argument.startsWith("-")) {
      throw new LinuxGitError(`log: unsupported option: ${argument}`, 2);
    } else if (revision === "HEAD") revision = argument;
    else
      throw new LinuxGitError(
        "usage: git log [--oneline] [-n count] [revision]",
        2,
      );
  }
  let oid = repository.resolveRevision(revision);
  const seen = new Set<string>();
  const output: string[] = [];
  let outputBytes = 1;
  while (output.length < limit) {
    if (seen.has(oid)) throw new LinuxGitError("commit graph cycle detected");
    seen.add(oid);
    const commitObject = repository.readCommit(oid);
    const rendered = oneline
      ? `${oid.slice(0, 12)} ${firstLine(commitObject.message)}`
      : renderCommitHeader(oid, commitObject);
    const separator = output.length === 0 ? "" : oneline ? "\n" : "\n\n";
    outputBytes = appendBoundedOutputChunk(
      output,
      rendered,
      outputBytes,
      separator,
      "log output limit exceeded",
    );
    const parent = commitObject.parents[0];
    if (parent === undefined) break;
    oid = parent;
  }
  return success(repository, `${output.join(oneline ? "\n" : "\n\n")}\n`);
}

function show(
  repository: LinuxGitRepository,
  arguments_: readonly string[],
): LinuxGitCommandResult {
  if (arguments_.length > 1)
    throw new LinuxGitError("usage: git show [revision]", 2);
  const oid = repository.resolveRevision(arguments_[0] ?? "HEAD");
  const type = repository.objectType(oid);
  if (type === "blob") {
    const bytes = repository.readBlob(oid);
    if (bytes.byteLength > linuxGitLimits.maximumDiffBytes) {
      return success(
        repository,
        `blob ${oid}\nBlob exceeds the ${String(linuxGitLimits.maximumDiffBytes)} byte display limit (${String(bytes.byteLength)} bytes)\n`,
      );
    }
    const text = decodeDisplayText(bytes);
    return success(
      repository,
      text === undefined
        ? `blob ${oid}\nBinary blob (${String(bytes.byteLength)} bytes)\n`
        : `blob ${oid}\n${text}${text.endsWith("\n") ? "" : "\n"}`,
    );
  }
  if (type === "tree") {
    const entries = repository.readTree(oid);
    return success(
      repository,
      `${entries.map((entry) => `${String(entry.mode)} ${entry.oid} ${entry.path}`).join("\n")}\n`,
    );
  }
  const commitObject = repository.readCommit(oid);
  const parent = commitObject.parents[0];
  const before = repository.treeAtCommit(parent);
  const after = repository.readTree(commitObject.tree);
  const renderedDiff = renderStoredDiff(repository, before, after, () => true);
  const output = `${renderCommitHeader(oid, commitObject)}\n\n${renderedDiff}`;
  requireDiffOutputWithinLimit(output);
  return success(repository, output.endsWith("\n") ? output : `${output}\n`);
}

function branch(
  repository: LinuxGitRepository,
  arguments_: readonly string[],
): LinuxGitCommandResult {
  if (arguments_.length === 0) {
    const current = repository.currentBranchName();
    const refs = new Map(repository.listRefs("heads"));
    if (current !== undefined && !refs.has(current)) refs.set(current, "");
    if (refs.size === 0) return success(repository, "");
    return success(
      repository,
      `${[...refs.keys()]
        .sort()
        .map((name) => `${name === current ? "*" : " "} ${name}`)
        .join("\n")}\n`,
    );
  }
  if (["-d", "-D", "--delete"].includes(arguments_[0]!)) {
    if (arguments_.length !== 2)
      throw new LinuxGitError("usage: git branch -d <name>", 2);
    const force = arguments_[0] === "-D";
    const name = arguments_[1]!;
    validateBranchName(name);
    if (repository.currentBranchName() === name) {
      throw new LinuxGitError(
        `cannot delete branch '${name}' checked out at ${repository.root}`,
      );
    }
    const reference = `refs/heads/${name}`;
    const oid = repository.readRef(reference);
    if (oid === undefined)
      throw new LinuxGitError(`branch '${name}' not found`);
    const headOid = repository.readHead().oid;
    if (
      !force &&
      headOid !== undefined &&
      !isAncestor(repository, oid, headOid)
    ) {
      throw new LinuxGitError(
        `branch '${name}' is not fully merged (use -D to force)`,
      );
    }
    repository.transaction(() => repository.deleteRef(reference, oid));
    return success(
      repository,
      `Deleted branch ${name} (was ${oid.slice(0, 12)}).\n`,
    );
  }
  if (arguments_[0]!.startsWith("-")) {
    throw new LinuxGitError(`branch: unsupported option: ${arguments_[0]!}`, 2);
  }
  if (arguments_.length > 2)
    throw new LinuxGitError("usage: git branch <name> [start-point]", 2);
  const name = arguments_[0]!;
  validateBranchName(name);
  if (repository.readRef(`refs/heads/${name}`) !== undefined) {
    throw new LinuxGitError(`a branch named '${name}' already exists`);
  }
  if (repository.listRefs("heads").length >= linuxGitLimits.maximumBranches) {
    throw new LinuxGitError("branch limit exceeded");
  }
  const oid = repository.resolveRevision(arguments_[1] ?? "HEAD");
  if (repository.objectType(oid) !== "commit") {
    throw new LinuxGitError("branch start-point is not a commit");
  }
  repository.transaction(() =>
    repository.updateRef(`refs/heads/${name}`, undefined, oid),
  );
  return success(repository);
}

function tag(
  repository: LinuxGitRepository,
  arguments_: readonly string[],
): LinuxGitCommandResult {
  if (arguments_.length === 0) {
    const refs = repository.listRefs("tags");
    return success(
      repository,
      refs.length === 0 ? "" : `${refs.map(([name]) => name).join("\n")}\n`,
    );
  }
  if (arguments_[0] === "-d" || arguments_[0] === "--delete") {
    if (arguments_.length !== 2)
      throw new LinuxGitError("usage: git tag -d <name>", 2);
    const name = arguments_[1]!;
    validateTagName(name);
    const reference = `refs/tags/${name}`;
    const oid = repository.readRef(reference);
    if (oid === undefined) throw new LinuxGitError(`tag '${name}' not found`);
    repository.transaction(() => repository.deleteRef(reference, oid));
    return success(
      repository,
      `Deleted tag '${name}' (was ${oid.slice(0, 12)})\n`,
    );
  }
  if (arguments_[0]!.startsWith("-")) {
    throw new LinuxGitError(
      "annotated, signed, and forced tags are not supported",
      2,
    );
  }
  if (arguments_.length > 2)
    throw new LinuxGitError("usage: git tag <name> [revision]", 2);
  const name = arguments_[0]!;
  validateTagName(name);
  const reference = `refs/tags/${name}`;
  if (repository.readRef(reference) !== undefined)
    throw new LinuxGitError(`tag '${name}' already exists`);
  if (repository.listRefs("tags").length >= linuxGitLimits.maximumTags) {
    throw new LinuxGitError("tag limit exceeded");
  }
  const oid = repository.resolveRevision(arguments_[1] ?? "HEAD");
  repository.transaction(() => repository.updateRef(reference, undefined, oid));
  return success(repository);
}

function config(
  repository: LinuxGitRepository,
  arguments_: readonly string[],
): LinuxGitCommandResult {
  const current = repository.readConfig();
  if (arguments_.length === 1 && arguments_[0] === "--list") {
    const rows = [
      "core.repositoryformatversion=1",
      "core.bare=false",
      "extensions.computersystemvcs=1",
      "extensions.objectformat=sha256",
    ];
    if (current.userName !== undefined)
      rows.push(`user.name=${current.userName}`);
    if (current.userEmail !== undefined)
      rows.push(`user.email=${current.userEmail}`);
    for (const [name, url] of current.remotes)
      rows.push(`remote.${name}.url=${url}`);
    return success(repository, `${rows.join("\n")}\n`);
  }
  let get = false;
  let unset = false;
  const operands = [...arguments_];
  if (operands[0] === "--get") {
    get = true;
    operands.shift();
  } else if (operands[0] === "--unset") {
    unset = true;
    operands.shift();
  }
  if (
    operands.length === 0 ||
    operands.length > 2 ||
    (get && operands.length !== 1) ||
    (unset && operands.length !== 1)
  ) {
    throw new LinuxGitError(
      "usage: git config [--get|--unset] <user.name|user.email> [value]",
      2,
    );
  }
  const key = operands[0]!;
  if (key !== "user.name" && key !== "user.email") {
    throw new LinuxGitError(
      `${key}: only local user.name and user.email are mutable`,
      2,
    );
  }
  const existing = key === "user.name" ? current.userName : current.userEmail;
  if (get || (operands.length === 1 && !unset)) {
    return existing === undefined
      ? result(repository.budget, 1, "", "")
      : success(repository, `${existing}\n`);
  }
  const value = unset ? undefined : operands[1];
  const next: LinuxGitConfig = {
    remotes: current.remotes,
    userEmail: key === "user.email" ? value : current.userEmail,
    userName: key === "user.name" ? value : current.userName,
  };
  repository.transaction(() => repository.writeConfig(next));
  return success(repository);
}

function remote(
  repository: LinuxGitRepository,
  arguments_: readonly string[],
): LinuxGitCommandResult {
  const current = repository.readConfig();
  if (
    arguments_.length === 0 ||
    (arguments_.length === 1 && arguments_[0] === "-v")
  ) {
    const verbose = arguments_[0] === "-v";
    const rows = [...current.remotes]
      .sort(([left], [right]) => left.localeCompare(right))
      .flatMap(([name, url]) =>
        verbose
          ? [`${name}\t${url} (fetch)`, `${name}\t${url} (push)`]
          : [name],
      );
    return success(repository, rows.length === 0 ? "" : `${rows.join("\n")}\n`);
  }
  const [command, name, value] = arguments_;
  if (command === "add") {
    if (name === undefined || value === undefined || arguments_.length !== 3) {
      throw new LinuxGitError("usage: git remote add <name> <url>", 2);
    }
    validateTagName(name);
    if (current.remotes.has(name))
      throw new LinuxGitError(`remote ${name} already exists`);
    parseLinuxGitRemoteEndpoint(value);
    const remotes = new Map(current.remotes);
    remotes.set(name, value);
    repository.transaction(() =>
      repository.writeConfig({ ...current, remotes }),
    );
    return success(repository);
  }
  if (command === "remove" || command === "rm") {
    if (name === undefined || arguments_.length !== 2) {
      throw new LinuxGitError("usage: git remote remove <name>", 2);
    }
    if (!current.remotes.has(name))
      throw new LinuxGitError(`remote ${name} not found`);
    const remotes = new Map(current.remotes);
    remotes.delete(name);
    repository.transaction(() =>
      repository.writeConfig({ ...current, remotes }),
    );
    return success(repository);
  }
  if (command === "get-url") {
    if (name === undefined || arguments_.length !== 2) {
      throw new LinuxGitError("usage: git remote get-url <name>", 2);
    }
    const url = current.remotes.get(name);
    if (url === undefined) throw new LinuxGitError(`remote ${name} not found`);
    return success(repository, `${url}\n`);
  }
  if (command === "set-url") {
    if (name === undefined || value === undefined || arguments_.length !== 3) {
      throw new LinuxGitError("usage: git remote set-url <name> <url>", 2);
    }
    if (!current.remotes.has(name))
      throw new LinuxGitError(`remote ${name} not found`);
    parseLinuxGitRemoteEndpoint(value);
    const remotes = new Map(current.remotes);
    remotes.set(name, value);
    repository.transaction(() =>
      repository.writeConfig({ ...current, remotes }),
    );
    return success(repository);
  }
  throw new LinuxGitError(
    "usage: git remote [-v]|add|remove|get-url|set-url",
    2,
  );
}

function renderStoredDiff(
  repository: LinuxGitRepository,
  before: readonly LinuxGitIndexEntry[],
  after: readonly LinuxGitIndexEntry[],
  selected: (path: string) => boolean,
): string {
  const beforeMap = new Map(
    before.map((entry) => [entry.path, entry] as const),
  );
  const afterMap = new Map(after.map((entry) => [entry.path, entry] as const));
  const chunks: string[] = [];
  let outputBytes = 0;
  for (const path of [
    ...new Set([...beforeMap.keys(), ...afterMap.keys()]),
  ].sort()) {
    if (!selected(path)) continue;
    const left = beforeMap.get(path);
    const right = afterMap.get(path);
    if (left !== undefined && right !== undefined && sameEntry(left, right))
      continue;
    outputBytes = appendDiffChunk(
      chunks,
      renderOneDiff(
        repository,
        path,
        left,
        right,
        left === undefined ? undefined : repository.readBlob(left.oid),
        right === undefined ? undefined : repository.readBlob(right.oid),
      ),
      outputBytes,
    );
  }
  const output = chunks.join("");
  requireDiffOutputWithinLimit(output);
  return output;
}

function renderOneDiff(
  repository: LinuxGitRepository,
  path: string,
  before: LinuxGitIndexEntry | undefined,
  after: LinuxGitIndexEntry | undefined,
  beforeBytes: Uint8Array | undefined,
  afterBytes: Uint8Array | undefined,
): string {
  repository.budget.chargeWork();
  const output = [`diff --cs-git a/${path} b/${path}`];
  if (before?.mode !== after?.mode) {
    if (before !== undefined) output.push(`old mode ${String(before.mode)}`);
    if (after !== undefined) output.push(`new mode ${String(after.mode)}`);
  }
  if (beforeBytes?.includes(0) === true || afterBytes?.includes(0) === true) {
    output.push(
      `Binary files ${before === undefined ? "/dev/null" : `a/${path}`} and ${after === undefined ? "/dev/null" : `b/${path}`} differ`,
    );
    return `${output.join("\n")}\n`;
  }
  const inputBytes =
    (beforeBytes?.byteLength ?? 0) + (afterBytes?.byteLength ?? 0);
  if (inputBytes > Math.floor(linuxGitLimits.maximumDiffBytes / 2)) {
    throw new LinuxGitError(
      "diff input is too large for bounded text rendering",
    );
  }
  const beforeText =
    beforeBytes === undefined ? "" : decodeDisplayText(beforeBytes);
  const afterText =
    afterBytes === undefined ? "" : decodeDisplayText(afterBytes);
  if (beforeText === undefined || afterText === undefined) {
    output.push(
      `Binary files ${before === undefined ? "/dev/null" : `a/${path}`} and ${after === undefined ? "/dev/null" : `b/${path}`} differ`,
    );
    return `${output.join("\n")}\n`;
  }
  output.push(
    `--- ${before === undefined ? "/dev/null" : `a/${path}`}`,
    `+++ ${after === undefined ? "/dev/null" : `b/${path}`}`,
    "@@",
  );
  if (beforeText.length > 0) {
    for (const line of linesForDiff(beforeText)) output.push(`-${line}`);
  }
  if (afterText.length > 0) {
    for (const line of linesForDiff(afterText)) output.push(`+${line}`);
  }
  const value = `${output.join("\n")}\n`;
  requireDiffOutputWithinLimit(value);
  return value;
}

function linesForDiff(value: string): readonly string[] {
  const lines = value.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function decodeDisplayText(value: Uint8Array): string | undefined {
  if (value.includes(0)) return undefined;
  try {
    return decodeUtf8(value);
  } catch {
    return undefined;
  }
}

function requireDiffOutputWithinLimit(value: string): void {
  if (encodeUtf8(value).byteLength > linuxGitLimits.maximumDiffBytes) {
    throw new LinuxGitError("diff output limit exceeded");
  }
}

function appendDiffChunk(
  chunks: string[],
  chunk: string,
  currentBytes: number,
): number {
  return appendBoundedOutputChunk(
    chunks,
    chunk,
    currentBytes,
    "",
    "diff output limit exceeded",
  );
}

function appendBoundedOutputChunk(
  chunks: string[],
  chunk: string,
  currentBytes: number,
  separator: string,
  errorMessage: string,
): number {
  const additionalBytes = encodeUtf8(`${separator}${chunk}`).byteLength;
  if (currentBytes + additionalBytes > linuxGitLimits.maximumDiffBytes) {
    throw new LinuxGitError(errorMessage);
  }
  chunks.push(chunk);
  return currentBytes + additionalBytes;
}

function renderCommitHeader(oid: string, commitObject: LinuxGitCommit): string {
  return [
    `commit ${oid}`,
    `Author: ${commitObject.authorName} <${commitObject.authorEmail}>`,
    `Date:   ${new Date(commitObject.timestampMilliseconds).toISOString()}`,
    "",
    ...commitObject.message.split(/\r?\n/u).map((line) => `    ${line}`),
  ].join("\n");
}

function parseHistoryLimit(value: string): number {
  if (!/^[1-9][0-9]*$/u.test(value))
    throw new LinuxGitError(`${value}: invalid history limit`, 2);
  const parsed = Number(value);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed > linuxGitLimits.maximumHistoryCommits
  ) {
    throw new LinuxGitError(
      `history limit must be between 1 and ${String(linuxGitLimits.maximumHistoryCommits)}`,
      2,
    );
  }
  return parsed;
}

function isAncestor(
  repository: LinuxGitRepository,
  ancestor: string,
  descendant: string,
): boolean {
  const pending = [descendant];
  const seen = new Set<string>();
  let next = 0;
  while (next < pending.length) {
    const oid = pending[next++]!;
    if (oid === ancestor) return true;
    if (seen.has(oid)) continue;
    seen.add(oid);
    if (seen.size > linuxGitLimits.maximumHistoryCommits) {
      throw new LinuxGitError("commit ancestry limit exceeded");
    }
    pending.push(...repository.readCommit(oid).parents);
  }
  return false;
}

function switchBranch(
  repository: LinuxGitRepository,
  arguments_: readonly string[],
): LinuxGitCommandResult {
  let create = false;
  let detach = false;
  const operands: string[] = [];
  for (const argument of arguments_) {
    if (argument === "-c" || argument === "--create") create = true;
    else if (argument === "--detach") detach = true;
    else if (argument.startsWith("-")) {
      throw new LinuxGitError(`switch: unsupported option: ${argument}`, 2);
    } else operands.push(argument);
  }
  const validOperandCount = create
    ? operands.length >= 1 && operands.length <= 2
    : operands.length === 1;
  if (!validOperandCount || (create && detach)) {
    throw new LinuxGitError(
      "usage: git switch [-c <branch> [start-point]|--detach <revision>|<branch>]",
      2,
    );
  }
  const target = operands[0]!;
  if (create) return createAndSwitch(repository, target, operands[1] ?? "HEAD");
  if (detach) return detachAt(repository, target);
  validateBranchName(target);
  return attachBranch(repository, target);
}

function checkout(
  repository: LinuxGitRepository,
  arguments_: readonly string[],
): LinuxGitCommandResult {
  if (arguments_.includes("--")) {
    throw new LinuxGitError(
      "checkout of individual paths is not supported; use add/rm and switch whole snapshots",
      2,
    );
  }
  if (arguments_[0] === "-b") {
    if (arguments_.length < 2 || arguments_.length > 3) {
      throw new LinuxGitError(
        "usage: git checkout -b <branch> [start-point]",
        2,
      );
    }
    return createAndSwitch(repository, arguments_[1]!, arguments_[2] ?? "HEAD");
  }
  if (arguments_.length !== 1 || arguments_[0]!.startsWith("-")) {
    throw new LinuxGitError("usage: git checkout [-b] <branch-or-revision>", 2);
  }
  const target = arguments_[0]!;
  const branchOid = validBranchCandidate(target)
    ? repository.readRef(`refs/heads/${target}`)
    : undefined;
  if (branchOid !== undefined || repository.currentBranchName() === target) {
    return attachBranch(repository, target);
  }
  return detachAt(repository, target);
}

function createAndSwitch(
  repository: LinuxGitRepository,
  name: string,
  startPoint: string,
): LinuxGitCommandResult {
  validateBranchName(name);
  const reference = `refs/heads/${name}`;
  if (
    repository.readRef(reference) !== undefined ||
    repository.currentBranchName() === name
  ) {
    throw new LinuxGitError(`a branch named '${name}' already exists`);
  }
  if (repository.listRefs("heads").length >= linuxGitLimits.maximumBranches) {
    throw new LinuxGitError("branch limit exceeded");
  }
  const oid = repository.resolveRevision(startPoint);
  if (repository.objectType(oid) !== "commit") {
    throw new LinuxGitError(`${startPoint}: switch target is not a commit`);
  }
  const target = repository.treeAtCommit(oid);
  const oldIndex = requireCleanWorktree(repository);
  const prepared = prepareCheckout(repository, oldIndex, target);
  repository.transaction(() => {
    applyPreparedCheckout(repository, oldIndex, target, prepared);
    repository.updateRef(reference, undefined, oid);
    repository.writeHeadReference(reference);
  });
  return success(repository, `Switched to a new branch '${name}'\n`);
}

function attachBranch(
  repository: LinuxGitRepository,
  name: string,
): LinuxGitCommandResult {
  validateBranchName(name);
  const reference = `refs/heads/${name}`;
  const oid = repository.readRef(reference);
  if (oid === undefined && repository.currentBranchName() !== name) {
    throw new LinuxGitError(`branch '${name}' not found`);
  }
  const target = repository.treeAtCommit(oid);
  const oldIndex = requireCleanWorktree(repository);
  const prepared = prepareCheckout(repository, oldIndex, target);
  repository.transaction(() => {
    applyPreparedCheckout(repository, oldIndex, target, prepared);
    repository.writeHeadReference(reference);
  });
  return success(repository, `Switched to branch '${name}'\n`);
}

function detachAt(
  repository: LinuxGitRepository,
  revision: string,
): LinuxGitCommandResult {
  const oid = repository.resolveRevision(revision);
  if (repository.objectType(oid) !== "commit") {
    throw new LinuxGitError(`${revision}: checkout target is not a commit`);
  }
  const target = repository.treeAtCommit(oid);
  const oldIndex = requireCleanWorktree(repository);
  const prepared = prepareCheckout(repository, oldIndex, target);
  repository.transaction(() => {
    applyPreparedCheckout(repository, oldIndex, target, prepared);
    repository.writeDetachedHead(oid);
  });
  return success(
    repository,
    `HEAD is now at ${oid.slice(0, 12)} ${firstLine(repository.readCommit(oid).message)}\n`,
  );
}

function merge(
  repository: LinuxGitRepository,
  arguments_: readonly string[],
): LinuxGitCommandResult {
  let ffOnly = false;
  let message: string | undefined;
  let targetName: string | undefined;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    if (argument === "--ff-only") ffOnly = true;
    else if (argument === "-m" || argument === "--message") {
      message = requireOperand(arguments_, ++index, argument);
    } else if (argument.startsWith("-")) {
      throw new LinuxGitError(`merge: unsupported option: ${argument}`, 2);
    } else if (targetName === undefined) targetName = argument;
    else
      throw new LinuxGitError(
        "usage: git merge [--ff-only] [-m message] <revision>",
        2,
      );
  }
  if (targetName === undefined) {
    throw new LinuxGitError(
      "usage: git merge [--ff-only] [-m message] <revision>",
      2,
    );
  }
  const head = repository.readHead();
  if (head.ref === undefined)
    throw new LinuxGitError("cannot merge while HEAD is detached");
  const targetOid = repository.resolveRevision(targetName);
  if (repository.objectType(targetOid) !== "commit") {
    throw new LinuxGitError(`${targetName}: merge target is not a commit`);
  }
  const oldIndex = requireCleanWorktree(repository);
  if (head.oid === targetOid)
    return success(repository, "Already up to date.\n");

  if (head.oid === undefined || isAncestor(repository, head.oid, targetOid)) {
    const targetTree = repository.treeAtCommit(targetOid);
    const prepared = prepareCheckout(repository, oldIndex, targetTree);
    repository.transaction(() => {
      const current = repository.readHead();
      if (current.ref !== head.ref || current.oid !== head.oid) {
        throw new LinuxGitError("HEAD changed concurrently; merge aborted");
      }
      applyPreparedCheckout(repository, oldIndex, targetTree, prepared);
      repository.updateRef(head.ref!, head.oid, targetOid);
    });
    return success(
      repository,
      head.oid === undefined
        ? `Branch initialized at ${targetOid.slice(0, 12)}.\n`
        : `Fast-forward ${head.oid.slice(0, 12)}..${targetOid.slice(0, 12)}\n`,
    );
  }
  if (isAncestor(repository, targetOid, head.oid)) {
    return success(repository, "Already up to date.\n");
  }
  if (ffOnly) throw new LinuxGitError("not possible to fast-forward, aborting");

  const currentOid = head.oid;
  if (currentOid === undefined) {
    throw new LinuxGitError("unborn HEAD did not take the fast-forward path");
  }
  const baseOid = findMergeBase(repository, currentOid, targetOid);
  if (baseOid === undefined)
    throw new LinuxGitError("refusing to merge unrelated histories");
  const base = new Map(
    repository
      .treeAtCommit(baseOid)
      .map((entry) => [entry.path, entry] as const),
  );
  const ours = new Map(
    repository
      .treeAtCommit(currentOid)
      .map((entry) => [entry.path, entry] as const),
  );
  const theirs = new Map(
    repository
      .treeAtCommit(targetOid)
      .map((entry) => [entry.path, entry] as const),
  );
  const merged: LinuxGitIndexEntry[] = [];
  const conflicts: string[] = [];
  for (const path of [
    ...new Set([...base.keys(), ...ours.keys(), ...theirs.keys()]),
  ].sort()) {
    const baseEntry = base.get(path);
    const ourEntry = ours.get(path);
    const theirEntry = theirs.get(path);
    let selected: LinuxGitIndexEntry | undefined;
    if (optionalEntryEqual(ourEntry, theirEntry)) selected = ourEntry;
    else if (optionalEntryEqual(baseEntry, ourEntry)) selected = theirEntry;
    else if (optionalEntryEqual(baseEntry, theirEntry)) selected = ourEntry;
    else {
      conflicts.push(path);
      continue;
    }
    if (selected !== undefined) merged.push(selected);
  }
  const collision = fileDirectoryCollision(merged);
  if (collision !== undefined) conflicts.push(collision);
  if (conflicts.length > 0) {
    throw new LinuxGitError(
      `merge conflict; no files were changed:\n${conflicts.map((path) => `CONFLICT ${path}`).join("\n")}`,
    );
  }
  const prepared = prepareCheckout(repository, oldIndex, merged);
  const configuration = repository.readConfig();
  const identity = commitIdentity(repository, configuration);
  let mergeOid = "";
  repository.transaction(() => {
    const current = repository.readHead();
    if (current.ref !== head.ref || current.oid !== head.oid) {
      throw new LinuxGitError("HEAD changed concurrently; merge aborted");
    }
    applyPreparedCheckout(repository, oldIndex, merged, prepared);
    const treeOid = repository.writeTree(merged);
    mergeOid = repository.writeCommit({
      authorEmail: identity.email,
      authorName: identity.name,
      message: message ?? `Merge '${targetName}'`,
      parents: [currentOid, targetOid],
      timestampMilliseconds: repository.io.nowMilliseconds(),
      tree: treeOid,
    });
    repository.updateRef(head.ref!, head.oid, mergeOid);
  });
  return success(repository, `Merge made commit ${mergeOid.slice(0, 12)}.\n`);
}

interface PreparedCheckoutEntry {
  readonly entry: LinuxGitIndexEntry;
}

function requireCleanWorktree(
  repository: LinuxGitRepository,
): readonly LinuxGitIndexEntry[] {
  const index = repository.readIndex();
  const headEntries = repository.treeAtCommit(repository.readHead().oid);
  if (compareEntrySets(headEntries, index).length > 0) {
    throw new LinuxGitError("staged changes would be overwritten by checkout");
  }
  const scan = scanWorktree(repository, index, true);
  const work = new Map(
    scan.entries.map((entry) => [entry.path, entry] as const),
  );
  for (const entry of index) {
    const candidate = work.get(entry.path);
    if (
      candidate === undefined ||
      !sameEntry(entry, readWorktreeEntry(repository, candidate).entry)
    ) {
      throw new LinuxGitError(
        `${entry.path}: local changes would be overwritten by checkout`,
      );
    }
  }
  return index;
}

function prepareCheckout(
  repository: LinuxGitRepository,
  oldIndex: readonly LinuxGitIndexEntry[],
  target: readonly LinuxGitIndexEntry[],
): readonly PreparedCheckoutEntry[] {
  const scan = scanWorktree(repository, oldIndex, true);
  const work = new Map(
    scan.entries.map((entry) => [entry.path, entry] as const),
  );
  const oldPaths = new Set(oldIndex.map((entry) => entry.path));
  const targetPaths = new Set(target.map((entry) => entry.path));
  for (const entry of target) {
    const existing = work.get(entry.path);
    if (existing !== undefined && !oldPaths.has(entry.path)) {
      throw new LinuxGitError(
        `${entry.path}: untracked file would be overwritten by checkout`,
      );
    }
    const absolute = repository.absolutePath(entry.path);
    if (
      repository.io.filesystem.exists(absolute) &&
      repository.io.filesystem.isDirectory(absolute) &&
      !repository.io.filesystem.isSymbolicLink(absolute)
    ) {
      const untrackedBelow = scan.entries.some(
        (candidate) =>
          pathInScope(candidate.path, entry.path) &&
          !oldPaths.has(candidate.path),
      );
      if (untrackedBelow) {
        throw new LinuxGitError(
          `${entry.path}: untracked directory contents would be overwritten`,
        );
      }
    }
    for (const parent of repositoryPathParents(entry.path)) {
      const parentAbsolute = repository.absolutePath(parent);
      if (!repository.io.filesystem.exists(parentAbsolute)) continue;
      const realDirectory =
        !repository.io.filesystem.isSymbolicLink(parentAbsolute) &&
        repository.io.filesystem.isDirectory(parentAbsolute);
      if (!realDirectory && !oldPaths.has(parent)) {
        throw new LinuxGitError(`${parent}: path component blocks checkout`);
      }
    }
  }
  const oldByPath = new Map(
    oldIndex.map((entry) => [entry.path, entry] as const),
  );
  const prepared = target
    .filter((entry) => {
      const old = oldByPath.get(entry.path);
      return old === undefined || !sameEntry(old, entry);
    })
    .map((entry) => ({
      entry,
    }));
  for (const old of oldIndex) {
    if (targetPaths.has(old.path)) continue;
    const absolute = repository.absolutePath(old.path);
    if (
      repository.io.filesystem.exists(absolute) &&
      repository.io.filesystem.isDirectory(absolute) &&
      !repository.io.filesystem.isSymbolicLink(absolute)
    ) {
      throw new LinuxGitError(
        `${old.path}: tracked file unexpectedly became a directory`,
      );
    }
  }
  return prepared;
}

function applyPreparedCheckout(
  repository: LinuxGitRepository,
  oldIndex: readonly LinuxGitIndexEntry[],
  target: readonly LinuxGitIndexEntry[],
  prepared: readonly PreparedCheckoutEntry[],
): void {
  const targetByPath = new Map(
    target.map((entry) => [entry.path, entry] as const),
  );
  for (const entry of [...oldIndex].sort(
    (left, right) => right.path.length - left.path.length,
  )) {
    const replacement = targetByPath.get(entry.path);
    if (replacement !== undefined && sameEntry(entry, replacement)) continue;
    const absolute = repository.absolutePath(entry.path);
    if (!repository.io.filesystem.exists(absolute)) continue;
    if (
      repository.io.filesystem.isDirectory(absolute) &&
      !repository.io.filesystem.isSymbolicLink(absolute)
    ) {
      throw new LinuxGitError(
        `${entry.path}: refusing recursive tracked-file deletion`,
      );
    }
    repository.io.filesystem.delete(absolute);
  }
  for (const preparedEntry of [...prepared].sort((left, right) =>
    compareRepositoryPath(left.entry.path, right.entry.path),
  )) {
    const contents = repository.readBlob(preparedEntry.entry.oid);
    ensureWorktreeParents(repository, preparedEntry.entry.path);
    const absolute = repository.absolutePath(preparedEntry.entry.path);
    if (repository.io.filesystem.exists(absolute)) {
      if (
        repository.io.filesystem.isDirectory(absolute) &&
        !repository.io.filesystem.isSymbolicLink(absolute) &&
        repository.io.filesystem.list(absolute).length > 0
      ) {
        throw new LinuxGitError(
          `${preparedEntry.entry.path}: directory is not empty`,
        );
      }
      repository.io.filesystem.delete(absolute);
    }
    if (preparedEntry.entry.mode === 120_000) {
      const targetValue = decodeSymlinkTarget(
        contents,
        preparedEntry.entry.path,
      );
      repository.budget.chargeBytes(contents.byteLength);
      repository.io.filesystem.createSymbolicLink(targetValue, absolute);
    } else {
      repository.budget.chargeBytes(contents.byteLength);
      repository.io.writeFileBytes(absolute, contents);
      repository.io.filesystem.chmod(
        absolute,
        preparedEntry.entry.mode === 100_755 ? 0o755 : 0o644,
      );
    }
  }
  repository.writeIndex(target);
}

function ensureWorktreeParents(
  repository: LinuxGitRepository,
  path: string,
): void {
  let current = repository.root;
  for (const part of path.split("/").slice(0, -1)) {
    current = joinAbsolute(current, part);
    if (!repository.io.filesystem.exists(current)) {
      repository.io.filesystem.makeDirectory(current, 0o777);
      continue;
    }
    if (
      repository.io.filesystem.isSymbolicLink(current) ||
      !repository.io.filesystem.isDirectory(current)
    ) {
      throw new LinuxGitError(`${path}: parent is not a real directory`);
    }
  }
}

function decodeSymlinkTarget(contents: Uint8Array, path: string): string {
  let target: string;
  try {
    target = decodeUtf8(contents);
  } catch {
    throw new LinuxGitError(`${path}: symbolic-link blob is not valid UTF-8`);
  }
  if (target.length === 0 || target.includes("\u0000")) {
    throw new LinuxGitError(`${path}: symbolic-link target is invalid`);
  }
  return target;
}

function repositoryPathParents(path: string): readonly string[] {
  const parts = path.split("/");
  const parents: string[] = [];
  for (let index = 1; index < parts.length; index += 1) {
    parents.push(parts.slice(0, index).join("/"));
  }
  return parents;
}

function optionalEntryEqual(
  left: LinuxGitIndexEntry | undefined,
  right: LinuxGitIndexEntry | undefined,
): boolean {
  return left === undefined
    ? right === undefined
    : right !== undefined && sameEntry(left, right);
}

function fileDirectoryCollision(
  entries: readonly LinuxGitIndexEntry[],
): string | undefined {
  const sorted = [...entries].sort((left, right) =>
    compareRepositoryPath(left.path, right.path),
  );
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index]!.path.startsWith(`${sorted[index - 1]!.path}/`)) {
      return `${sorted[index - 1]!.path} vs ${sorted[index]!.path}`;
    }
  }
  return undefined;
}

function findMergeBase(
  repository: LinuxGitRepository,
  left: string,
  right: string,
): string | undefined {
  const leftGraph = collectAncestorGraph(repository, left);
  const rightGraph = collectAncestorGraph(repository, right);
  const common = [...leftGraph.keys()].filter((oid) => rightGraph.has(oid));
  if (common.length === 0) return undefined;

  const parents = new Map(leftGraph);
  for (const [oid, values] of rightGraph) parents.set(oid, values);
  const commonSet = new Set(common);
  const dominated = new Set<string>();
  let transitions = 0;
  for (const descendant of common) {
    const pending = [...(parents.get(descendant) ?? [])];
    const seen = new Set<string>();
    let next = 0;
    while (next < pending.length) {
      const oid = pending[next++]!;
      transitions += 1;
      if (seen.has(oid)) continue;
      seen.add(oid);
      if (commonSet.has(oid)) dominated.add(oid);
      pending.push(...(parents.get(oid) ?? []));
    }
  }
  if (transitions > 0) {
    repository.budget.chargeWork(Math.ceil(transitions / 16));
  }
  const best = common.filter((oid) => !dominated.has(oid));
  if (best.length !== 1) {
    throw new LinuxGitError(
      "multiple merge bases are not supported; merge aborted without changes",
    );
  }
  return best[0];
}

function collectAncestorGraph(
  repository: LinuxGitRepository,
  start: string,
): ReadonlyMap<string, readonly string[]> {
  const pending = [start];
  const parents = new Map<string, readonly string[]>();
  let next = 0;
  while (next < pending.length) {
    const oid = pending[next++]!;
    if (parents.has(oid)) continue;
    if (parents.size >= linuxGitLimits.maximumHistoryCommits) {
      throw new LinuxGitError("commit ancestry limit exceeded");
    }
    const commitParents = repository.readCommit(oid).parents;
    parents.set(oid, commitParents);
    pending.push(...commitParents);
  }
  return parents;
}

function validBranchCandidate(value: string): boolean {
  try {
    validateBranchName(value);
    return true;
  } catch {
    return false;
  }
}

function compareRepositoryPath(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
