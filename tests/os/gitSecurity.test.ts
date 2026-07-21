import { describe, expect, it } from "vitest";

import { executeLinuxGit } from "../../src/application/os/linuxGit.js";
import {
  linuxGitObjectOid,
  type LinuxGitIo,
} from "../../src/application/os/linuxGitRepository.js";
import { UnrestrictedGuestFilesystem } from "../../src/application/os/guestFilesystem.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";

function createHarness(): {
  readonly filesystem: InMemoryFilesystem;
  readonly run: (
    arguments_: readonly string[],
  ) => ReturnType<typeof executeLinuxGit>;
} {
  const filesystem = new InMemoryFilesystem();
  filesystem.makeDirectory("/repo");
  const guest = new UnrestrictedGuestFilesystem(filesystem);
  const io: LinuxGitIo = {
    computerName: "security-test",
    currentDirectory: "/repo",
    effectiveUserId: 1_000,
    filesystem: guest,
    loginName: "cs",
    nowMilliseconds: () => 1_800_000_000_000,
    readFile: (path) => guest.readFile(path),
    readFileBytes: (path) => guest.readFileBytes(path),
    readLink: (path) => guest.readLink(path),
    writeFile: (path, contents) => guest.writeFile(path, contents),
    writeFileBytes: (path, contents) => guest.writeFileBytes(path, contents),
  };
  return {
    filesystem,
    run: (arguments_) => executeLinuxGit(arguments_, io),
  };
}

describe("CS System Git security and capacity boundaries", (): void => {
  it("rolls back every object when tracked-entry capacity plus one is staged", (): void => {
    const { filesystem, run } = createHarness();
    expect(run(["init"]).exitCode).toBe(0);
    const indexBefore = filesystem.readFile("/repo/.git/index");
    for (let index = 0; index < 257; index += 1) {
      filesystem.writeFile(`/repo/f${String(index).padStart(3, "0")}`, "x");
    }

    const added = run(["add", "."]);

    expect(added.exitCode).toBe(1);
    expect(added.stderr).toContain("index entry limit exceeded");
    expect(filesystem.readFile("/repo/.git/index")).toBe(indexBefore);
    expect(filesystem.list("/repo/.git/objects")).toEqual([]);
  });

  it("rejects object-size overflow without changing the index", (): void => {
    const { filesystem, run } = createHarness();
    expect(run(["init"]).exitCode).toBe(0);
    const indexBefore = filesystem.readFile("/repo/.git/index");
    filesystem.writeFile("/repo/large.bin", "x".repeat(393_217));

    expect(run(["add", "large.bin"]).stderr).toContain(
      "file exceeds the Git object size limit",
    );
    expect(filesystem.readFile("/repo/.git/index")).toBe(indexBefore);
    expect(filesystem.list("/repo/.git/objects")).toEqual([]);
  });

  it("never follows control-directory or ignore-file symbolic links", (): void => {
    const { filesystem, run } = createHarness();
    expect(run(["init"]).exitCode).toBe(0);
    filesystem.writeFile("/repo/rules", "secret.txt\n");
    filesystem.createSymbolicLink("rules", "/repo/.gitignore");
    filesystem.writeFile("/repo/secret.txt", "tracked\n");
    expect(run(["status", "--short"]).stdout).toContain("?? secret.txt");

    filesystem.delete("/repo/.git/index");
    filesystem.createSymbolicLink("../rules", "/repo/.git/index");
    expect(run(["status"]).stderr).toContain(
      "symbolic links are forbidden inside .git",
    );

    filesystem.delete("/repo/.git");
    filesystem.makeDirectory("/other");
    filesystem.createSymbolicLink("/other", "/repo/.git");
    expect(run(["status"]).stderr).toContain(
      "symbolic links are forbidden inside .git",
    );
  });

  it("rejects symbolic-link repository roots and duplicate or executable config", (): void => {
    const linked = createHarness();
    linked.filesystem.delete("/repo");
    linked.filesystem.makeDirectory("/real");
    linked.filesystem.createSymbolicLink("/real", "/repo");
    expect(linked.run(["init"]).stderr).toContain(
      "repository root is not a real directory",
    );

    const configured = createHarness();
    expect(configured.run(["init"]).exitCode).toBe(0);
    const configPath = "/repo/.git/config";
    configured.filesystem.writeFile(
      configPath,
      `${configured.filesystem.readFile(configPath)}[core]\n    bare = false\n`,
    );
    expect(configured.run(["status"]).stderr).toContain(
      "duplicate config key: core.bare",
    );

    const included = createHarness();
    expect(included.run(["init"]).exitCode).toBe(0);
    included.filesystem.writeFile(
      "/repo/.git/config",
      `${included.filesystem.readFile("/repo/.git/config")}[include]\n    path = /secret\n`,
    );
    expect(included.run(["status"]).stderr).toContain(
      "unsupported config section: include",
    );
  });

  it("tracks executable mode and symlink targets without following the target", (): void => {
    const { filesystem, run } = createHarness();
    expect(run(["init"]).exitCode).toBe(0);
    filesystem.writeFile("/repo/script", "echo safe\n");
    filesystem.setMetadata("/repo/script", { mode: 0o755 });
    filesystem.createSymbolicLink("missing-target", "/repo/link");

    expect(run(["add", "."]).exitCode).toBe(0);
    expect(run(["commit", "-m", "modes"]).exitCode).toBe(0);
    filesystem.setMetadata("/repo/script", { mode: 0o644 });
    filesystem.delete("/repo/link");
    filesystem.createSymbolicLink("different-target", "/repo/link");

    expect(run(["status", "--short"]).stdout).toBe(" M link\n M script\n");
    expect(run(["diff"]).stdout).toContain("old mode 100755");
    expect(run(["diff"]).stdout).toContain("-missing-target");
    expect(run(["diff"]).stdout).toContain("+different-target");
  });

  it("bounds ignore reads, text rendering, binary summaries, and history output", (): void => {
    const { filesystem, run } = createHarness();
    expect(run(["init"]).exitCode).toBe(0);
    filesystem.writeFile("/repo/.gitignore", "x".repeat(16_385));
    expect(run(["status"]).stderr).toContain("ignore file exceeds 16384 bytes");
    filesystem.delete("/repo/.gitignore");

    filesystem.writeFile("/repo/large.txt", "a".repeat(40_000));
    expect(run(["add", "large.txt"]).exitCode).toBe(0);
    expect(run(["commit", "-m", "large text"]).exitCode).toBe(0);
    filesystem.writeFile("/repo/large.txt", "b".repeat(40_000));
    expect(run(["diff"]).stderr).toContain(
      "diff input is too large for bounded text rendering",
    );

    const binaryBefore = new Uint8Array(140_000);
    binaryBefore.fill(1);
    binaryBefore[0] = 0;
    filesystem.writeFileBytes("/repo/large.bin", binaryBefore);
    expect(run(["add", "large.bin"]).exitCode).toBe(0);
    const binaryOid = linuxGitObjectOid("blob", binaryBefore);
    expect(run(["show", binaryOid]).stdout).toContain(
      "Blob exceeds the 131072 byte display limit",
    );
    expect(run(["commit", "-m", "large binary"]).exitCode).toBe(0);
    const binaryAfter = new Uint8Array(140_000);
    binaryAfter.fill(2);
    binaryAfter[0] = 0;
    filesystem.writeFileBytes("/repo/large.bin", binaryAfter);
    expect(run(["diff", "large.bin"])).toMatchObject({
      exitCode: 0,
      stderr: "",
    });
    expect(run(["diff", "large.bin"]).stdout).toContain("Binary files");

    filesystem.writeFileBytes("/repo/large.bin", binaryBefore);
    filesystem.writeFile("/repo/large.txt", "a".repeat(40_000));
    for (let index = 0; index < 33; index += 1) {
      filesystem.writeFile("/repo/counter", String(index));
      expect(run(["add", "counter"]).exitCode).toBe(0);
      expect(
        run([
          "commit",
          "-m",
          `${"m".repeat(4_080)}-${String(index).padStart(2, "0")}`,
        ]).exitCode,
      ).toBe(0);
    }
    expect(run(["log"]).stderr).toContain("log output limit exceeded");
  });
});
