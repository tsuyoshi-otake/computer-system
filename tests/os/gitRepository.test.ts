import { describe, expect, it } from "vitest";

import { executeLinuxGit } from "../../src/application/os/linuxGit.js";
import {
  sha256BytePartsHex,
  sha256BytesHex,
} from "../../src/domain/crypto/sha256.js";
import type { LinuxGitIo } from "../../src/application/os/linuxGitRepository.js";
import { UnrestrictedGuestFilesystem } from "../../src/application/os/guestFilesystem.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";

interface GitHarness {
  readonly filesystem: InMemoryFilesystem;
  readonly io: LinuxGitIo;
  readonly run: (
    arguments_: readonly string[],
  ) => ReturnType<typeof executeLinuxGit>;
}

function gitHarness(): GitHarness {
  const filesystem = new InMemoryFilesystem();
  filesystem.makeDirectory("/repo");
  const guest = new UnrestrictedGuestFilesystem(filesystem);
  let now = 1_800_000_000_000;
  const io: LinuxGitIo = {
    computerName: "cs-test",
    currentDirectory: "/repo",
    effectiveUserId: 1_000,
    filesystem: guest,
    loginName: "cs",
    nowMilliseconds: () => (now += 1_000),
    readFile: (path) => guest.readFile(path),
    readFileBytes: (path) => guest.readFileBytes(path),
    readLink: (path) => guest.readLink(path),
    writeFile: (path, contents) => guest.writeFile(path, contents),
    writeFileBytes: (path, contents) => guest.writeFileBytes(path, contents),
  };
  return {
    filesystem,
    io,
    run: (arguments_) => executeLinuxGit(arguments_, io),
  };
}

function expectSuccess(result: ReturnType<typeof executeLinuxGit>): void {
  expect(result).toMatchObject({ exitCode: 0, stderr: "" });
  expect(result.cpuCycles).toBeGreaterThan(0);
}

describe("CS System Git repository", (): void => {
  it("hashes exact byte parts with fixed-memory SHA-256", (): void => {
    const encoder = new TextEncoder();
    expect(sha256BytesHex(new Uint8Array())).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(
      sha256BytePartsHex([
        encoder.encode("a"),
        encoder.encode("b"),
        encoder.encode("c"),
      ]),
    ).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(
      sha256BytePartsHex([
        encoder.encode("x".repeat(63)),
        encoder.encode("y"),
        encoder.encode("z".repeat(65)),
      ]),
    ).toBe(
      sha256BytesHex(encoder.encode(`${"x".repeat(63)}y${"z".repeat(65)}`)),
    );
  });

  it("initializes an independently marked repository and commits binary-safe blobs", (): void => {
    const harness = gitHarness();

    expectSuccess(harness.run(["init"]));
    expect(harness.filesystem.readFile("/repo/.git/CS_SYSTEM_VCS")).toBe(
      "CS-SYSTEM-VCS 1\nobjectformat sha256\n",
    );
    expect(harness.filesystem.readFile("/repo/.git/config")).toContain(
      "computerSystemVcs = 1",
    );

    harness.filesystem.writeFileBytes(
      "/repo/data.bin",
      Uint8Array.from([0, 1, 2, 255]),
    );
    expectSuccess(harness.run(["add", "data.bin"]));
    const committed = harness.run(["commit", "-m", "store binary"]);
    expectSuccess(committed);
    expect(committed.stdout).toContain("store binary");
    expect(harness.run(["status", "--short"]).stdout).toBe("");
    expect(harness.run(["log", "--oneline"]).stdout).toContain("store binary");
    expect(harness.run(["show"]).stdout).toContain("Binary files");
  });

  it("switches snapshots and performs bounded disjoint three-way merges", (): void => {
    const harness = gitHarness();
    expectSuccess(harness.run(["init"]));
    harness.filesystem.writeFile("/repo/base.txt", "base\n");
    expectSuccess(harness.run(["add", "."]));
    expectSuccess(harness.run(["commit", "-m", "base"]));
    expectSuccess(harness.run(["branch", "feature"]));

    harness.filesystem.writeFile("/repo/main.txt", "main\n");
    expectSuccess(harness.run(["add", "."]));
    expectSuccess(harness.run(["commit", "-m", "main work"]));
    expectSuccess(harness.run(["switch", "feature"]));
    expect(harness.filesystem.exists("/repo/main.txt")).toBe(false);

    harness.filesystem.writeFile("/repo/feature.txt", "feature\n");
    expectSuccess(harness.run(["add", "."]));
    expectSuccess(harness.run(["commit", "-m", "feature work"]));
    expectSuccess(harness.run(["switch", "main"]));
    const merged = harness.run(["merge", "feature"]);

    expectSuccess(merged);
    expect(merged.stdout).toContain("Merge made commit");
    expect(harness.filesystem.readFile("/repo/main.txt")).toBe("main\n");
    expect(harness.filesystem.readFile("/repo/feature.txt")).toBe("feature\n");
    expect(harness.run(["log", "-n", "1"]).stdout).toContain("Merge 'feature'");
  });

  it("reports conflicts without partially changing refs, index, or worktree", (): void => {
    const harness = gitHarness();
    expectSuccess(harness.run(["init"]));
    harness.filesystem.writeFile("/repo/value.txt", "base\n");
    expectSuccess(harness.run(["add", "."]));
    expectSuccess(harness.run(["commit", "-m", "base"]));
    expectSuccess(harness.run(["branch", "feature"]));

    harness.filesystem.writeFile("/repo/value.txt", "main\n");
    expectSuccess(harness.run(["add", "."]));
    expectSuccess(harness.run(["commit", "-m", "main value"]));
    expectSuccess(harness.run(["switch", "feature"]));
    harness.filesystem.writeFile("/repo/value.txt", "feature\n");
    expectSuccess(harness.run(["add", "."]));
    expectSuccess(harness.run(["commit", "-m", "feature value"]));
    expectSuccess(harness.run(["switch", "main"]));

    const headBefore = harness.filesystem.readFile(
      "/repo/.git/refs/heads/main",
    );
    const indexBefore = harness.filesystem.readFile("/repo/.git/index");
    const merged = harness.run(["merge", "feature"]);

    expect(merged.exitCode).toBe(1);
    expect(merged.stderr).toContain("merge conflict; no files were changed");
    expect(harness.filesystem.readFile("/repo/value.txt")).toBe("main\n");
    expect(harness.filesystem.readFile("/repo/.git/refs/heads/main")).toBe(
      headBefore,
    );
    expect(harness.filesystem.readFile("/repo/.git/index")).toBe(indexBefore);
  });

  it("rejects unsafe ownership and corrupt content-addressed objects", (): void => {
    const harness = gitHarness();
    expectSuccess(harness.run(["init"]));
    harness.filesystem.writeFile("/repo/file.txt", "safe\n");
    expectSuccess(harness.run(["add", "."]));
    expectSuccess(harness.run(["commit", "-m", "safe"]));

    const headOid = harness.filesystem
      .readFile("/repo/.git/refs/heads/main")
      .trim();
    const prefix = headOid.slice(0, 2);
    const suffix = headOid.slice(2);
    const objectPath = `/repo/.git/objects/${prefix}/${suffix}`;
    const bytes = harness.filesystem.readFileBytes(objectPath);
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
    harness.filesystem.writeFileBytes(objectPath, bytes);
    expect(harness.run(["status"]).stderr).toMatch(
      /object hash mismatch|invalid JSON/u,
    );

    harness.filesystem.setMetadata("/repo/.git", { uid: 7 });
    expect(harness.run(["status"]).stderr).toContain(
      "unsafe repository ownership",
    );
  });

  it("stores remote metadata but fails network operations explicitly", (): void => {
    const harness = gitHarness();
    expectSuccess(harness.run(["init"]));
    expectSuccess(
      harness.run([
        "remote",
        "add",
        "origin",
        "cs+tcp://example.test/team/repo",
      ]),
    );
    expect(harness.run(["remote", "-v"]).stdout).toContain(
      "origin\tcs+tcp://example.test/team/repo (push)",
    );
    expect(harness.run(["push", "origin", "main"])).toMatchObject({
      exitCode: 1,
      stderr:
        "git: push: authenticated guest TCP/IP transport is not available in CS-Linux 1.0\n",
    });
    expect(
      harness.run(["remote", "add", "bad", "ssh://user@example.test/repo"])
        .stderr,
    ).toContain("must not contain inline credentials");
  });

  it("supports the complete bounded local porcelain and stable Unicode path ordering", (): void => {
    const harness = gitHarness();
    expectSuccess(harness.run(["init"]));
    expectSuccess(harness.run(["config", "user.name", "Ada Lovelace"]));
    expectSuccess(harness.run(["config", "user.email", "ada@cs.test"]));
    expect(harness.run(["config", "--get", "user.name"]).stdout).toBe(
      "Ada Lovelace\n",
    );

    harness.filesystem.writeFile("/repo/z.txt", "z\n");
    harness.filesystem.writeFile("/repo/é.txt", "unicode\n");
    expectSuccess(harness.run(["add", "."]));
    expectSuccess(harness.run(["commit", "-m", "ordered paths"]));
    const firstOid = harness.filesystem
      .readFile("/repo/.git/refs/heads/main")
      .trim();

    expectSuccess(harness.run(["tag", "v1"]));
    expectSuccess(harness.run(["branch", "d"]));
    expectSuccess(harness.run(["switch", "-c", "topic", "v1"]));
    expect(harness.run(["branch"]).stdout).toContain("* topic");
    expectSuccess(harness.run(["switch", "main"]));
    expectSuccess(harness.run(["checkout", "d"]));
    expectSuccess(harness.run(["checkout", firstOid]));
    expect(harness.run(["branch"]).stdout).not.toContain("*");
    expectSuccess(harness.run(["checkout", "main"]));
    expect(harness.run(["show", "v1"]).stdout).toContain("ordered paths");

    expectSuccess(
      harness.run(["remote", "add", "origin", "https://HOST.TEST/team/repo"]),
    );
    expect(harness.run(["remote", "get-url", "origin"]).stdout).toBe(
      "https://HOST.TEST/team/repo\n",
    );
    expectSuccess(
      harness.run([
        "remote",
        "set-url",
        "origin",
        "ssh://host.test:22/team/repo.git",
      ]),
    );
    expectSuccess(harness.run(["remote", "remove", "origin"]));

    expectSuccess(harness.run(["rm", "--cached", "z.txt"]));
    expect(harness.run(["diff", "--cached"]).stdout).toContain("-z");
    expectSuccess(harness.run(["add", "z.txt"]));
    expectSuccess(harness.run(["branch", "-d", "d"]));
    expectSuccess(harness.run(["branch", "-D", "topic"]));
    expectSuccess(harness.run(["tag", "-d", "v1"]));
    expectSuccess(harness.run(["config", "--unset", "user.name"]));
    expect(harness.run(["config", "--get", "user.name"]).exitCode).toBe(1);
    expectSuccess(harness.run(["rm", "z.txt"]));
    expect(harness.filesystem.exists("/repo/z.txt")).toBe(false);
  });

  it("rejects multiple merge bases explicitly without synthesizing a recursive base", (): void => {
    const harness = gitHarness();
    expectSuccess(harness.run(["init"]));
    harness.filesystem.writeFile("/repo/base.txt", "base\n");
    expectSuccess(harness.run(["add", "."]));
    expectSuccess(harness.run(["commit", "-m", "base"]));
    expectSuccess(harness.run(["branch", "side"]));

    harness.filesystem.writeFile("/repo/main.txt", "main\n");
    expectSuccess(harness.run(["add", "."]));
    expectSuccess(harness.run(["commit", "-m", "main one"]));
    const mainOne = harness.filesystem
      .readFile("/repo/.git/refs/heads/main")
      .trim();

    expectSuccess(harness.run(["switch", "side"]));
    harness.filesystem.writeFile("/repo/side.txt", "side\n");
    expectSuccess(harness.run(["add", "."]));
    expectSuccess(harness.run(["commit", "-m", "side one"]));
    expectSuccess(harness.run(["switch", "main"]));
    expectSuccess(harness.run(["merge", "side"]));
    expectSuccess(harness.run(["switch", "side"]));
    expectSuccess(harness.run(["merge", mainOne]));
    expectSuccess(harness.run(["switch", "main"]));

    const headBefore = harness.filesystem.readFile(
      "/repo/.git/refs/heads/main",
    );
    const indexBefore = harness.filesystem.readFile("/repo/.git/index");
    const merged = harness.run(["merge", "side"]);
    expect(merged.exitCode).toBe(1);
    expect(merged.stderr).toContain("multiple merge bases are not supported");
    expect(harness.filesystem.readFile("/repo/.git/refs/heads/main")).toBe(
      headBefore,
    );
    expect(harness.filesystem.readFile("/repo/.git/index")).toBe(indexBefore);
    expect(harness.filesystem.readFile("/repo/main.txt")).toBe("main\n");
    expect(harness.filesystem.readFile("/repo/side.txt")).toBe("side\n");
  });
});
