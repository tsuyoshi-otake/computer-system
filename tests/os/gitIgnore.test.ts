import { describe, expect, it } from "vitest";

import { executeLinuxGit } from "../../src/application/os/linuxGit.js";
import {
  linuxGitPathIgnored,
  linuxGitIgnoreLimits,
  matchesIgnorePattern,
  parseLinuxGitIgnore,
} from "../../src/application/os/linuxGitIgnore.js";
import type { LinuxGitIo } from "../../src/application/os/linuxGitRepository.js";
import { UnrestrictedGuestFilesystem } from "../../src/application/os/guestFilesystem.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";

describe("CS System Git ignore matching", (): void => {
  it("supports anchored, ranged, escaped-space, directory, and negated patterns", (): void => {
    const budget = { files: 0, rules: 0 };
    const rules = parseLinuxGitIgnore(
      "/root.txt\nlogs/\nfile[0-9].txt\nimportant\\ \n*.tmp\n!keep.tmp\n",
      "",
      ".gitignore",
      budget,
    );

    expect(linuxGitPathIgnored(rules, "root.txt", false)).toBe(true);
    expect(linuxGitPathIgnored(rules, "nested/root.txt", false)).toBe(false);
    expect(linuxGitPathIgnored(rules, "logs", true)).toBe(true);
    expect(linuxGitPathIgnored(rules, "file7.txt", false)).toBe(true);
    expect(linuxGitPathIgnored(rules, "important ", false)).toBe(true);
    expect(linuxGitPathIgnored(rules, "drop.tmp", false)).toBe(true);
    expect(linuxGitPathIgnored(rules, "keep.tmp", false)).toBe(false);
    expect(
      matchesIgnorePattern("src/**/generated?.ts", "src/a/b/generated1.ts"),
    ).toBe(true);
    expect(
      matchesIgnorePattern("src/**/generated?.ts", "src/generated1.ts"),
    ).toBe(true);
    expect(matchesIgnorePattern("literal[", "literal[")).toBe(true);
  });

  it("bounds files, rules, patterns, and matching work", (): void => {
    expect(() =>
      parseLinuxGitIgnore("x".repeat(257), "", ".gitignore", {
        files: 0,
        rules: 0,
      }),
    ).toThrow("ignore pattern exceeds 256 bytes");
    expect(() =>
      parseLinuxGitIgnore("x\n", "", ".gitignore", {
        files: 64,
        rules: 0,
      }),
    ).toThrow("ignore file count limit exceeded");
    expect(() =>
      matchesIgnorePattern("*", "value", false, {
        steps: linuxGitIgnoreLimits.maximumOperationMatchSteps,
      }),
    ).toThrow("ignore operation match step limit exceeded");
  });

  it("applies info/exclude, nested rules, parent exclusion, and add -f", (): void => {
    const filesystem = new InMemoryFilesystem();
    filesystem.makeDirectory("/repo");
    const guest = new UnrestrictedGuestFilesystem(filesystem);
    const io: LinuxGitIo = {
      computerName: "cs-test",
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
    const run = (
      arguments_: readonly string[],
    ): ReturnType<typeof executeLinuxGit> => executeLinuxGit(arguments_, io);
    expect(run(["init"]).exitCode).toBe(0);
    filesystem.writeFile("/repo/.git/info/exclude", "local.txt\n");
    filesystem.writeFile("/repo/.gitignore", "build/\n*.tmp\n");
    filesystem.makeDirectory("/repo/build");
    filesystem.writeFile("/repo/build/.gitignore", "!keep.txt\n");
    filesystem.writeFile("/repo/build/keep.txt", "blocked by parent\n");
    filesystem.writeFile("/repo/local.txt", "local\n");
    filesystem.writeFile("/repo/drop.tmp", "temp\n");
    filesystem.writeFile("/repo/source.txt", "source\n");

    expect(run(["status", "--short"]).stdout).toBe(
      "?? .gitignore\n?? source.txt\n",
    );
    expect(run(["add", "build/keep.txt"]).stderr).toContain("ignored by");
    expect(run(["add", "-f", "build/keep.txt"]).exitCode).toBe(0);
    expect(run(["status", "--short"]).stdout).toContain("A  build/keep.txt");
    expect(run(["add", ".git"]).stderr).toContain(
      "reserved repository metadata",
    );
  });
});
