import { describe, expect, it } from "vitest";

import {
  CS486_ARCHIVE_LIMITS,
  createCs486Archive,
  deleteCs486ArchiveMembers,
  parseCs486Archive,
  replaceCs486ArchiveMembers,
  selectCs486LinkInputs,
  serializeCs486Archive,
} from "../../src/application/toolchain/cs486Archive.js";
import { compileCs486Object } from "../../src/application/toolchain/highLevelCompilers.js";
import { linkCs486Objects } from "../../src/application/toolchain/cs486Linker.js";
import {
  cs486ExecutableMemoryRequirements,
  runCs486,
} from "../../src/domain/cpu/cs486.js";

describe("CS486AR static archives", (): void => {
  it("serializes canonically and extracts only demanded members", (): void => {
    const answer = compileCs486Object(
      "c",
      "extern int helper(void); int answer(void) { return helper(); }",
    );
    const helper = compileCs486Object("c", "int helper(void) { return 42; }");
    const unused = compileCs486Object("c", "int unused(void) { return 7; }");
    const main = compileCs486Object(
      "c",
      "extern int answer(void); int main(void) { return answer(); }",
    );
    const archive = createCs486Archive([
      { name: "unused.o", object: unused },
      { name: "helper.o", object: helper },
      { name: "answer.o", object: answer },
    ]);

    expect(archive.members.map(({ name }) => name)).toEqual([
      "answer.o",
      "helper.o",
      "unused.o",
    ]);
    expect(
      serializeCs486Archive(parseCs486Archive(serializeCs486Archive(archive))),
    ).toBe(serializeCs486Archive(archive));
    const selected = selectCs486LinkInputs([
      { kind: "object", object: main },
      { archive, kind: "archive" },
    ]);
    expect(selected.selectedArchiveMembers).toEqual(["answer.o", "helper.o"]);
    expect(selected.archiveMembersExamined).toBe(2);
    expect(selected.symbolIndexLookups).toBe(2);
    const executable = linkCs486Objects(selected.objects);
    const memory = cs486ExecutableMemoryRequirements(executable);
    if (memory.kind !== "declared") throw new Error("expected declared memory");
    expect(
      runCs486(executable, {
        memoryBytes: memory.linearAddressSpaceBytes,
      }).registers.eax,
    ).toBe(42);
  });

  it("preserves command-line archive ordering", (): void => {
    const main = compileCs486Object(
      "c",
      "extern int answer(void); int main(void) { return answer(); }",
    );
    const answer = compileCs486Object("c", "int answer(void) { return 42; }");
    const archive = createCs486Archive([{ name: "answer.o", object: answer }]);
    expect(
      selectCs486LinkInputs([
        { archive, kind: "archive" },
        { kind: "object", object: main },
      ]).selectedArchiveMembers,
    ).toEqual([]);
    expect(() =>
      linkCs486Objects(
        selectCs486LinkInputs([
          { archive, kind: "archive" },
          { kind: "object", object: main },
        ]).objects,
      ),
    ).toThrow(/unresolved symbol answer/u);
  });

  it("replaces/deletes atomically in memory and rejects corrupt indexes", (): void => {
    const one = compileCs486Object("c", "int one(void) { return 1; }");
    const two = compileCs486Object("c", "int two(void) { return 2; }");
    const initial = createCs486Archive([{ name: "one.o", object: one }]);
    const replaced = replaceCs486ArchiveMembers(initial, [
      { name: "two.o", object: two },
    ]);
    expect(replaced.members.map(({ name }) => name)).toEqual([
      "one.o",
      "two.o",
    ]);
    expect(deleteCs486ArchiveMembers(replaced, ["one.o"]).members).toHaveLength(
      1,
    );

    const corrupt = structuredClone(replaced) as unknown as {
      symbols: { member: string; name: string }[];
    };
    corrupt.symbols[0]!.member = "missing.o";
    expect(() =>
      parseCs486Archive(`CS486AR\n${JSON.stringify(corrupt)}`),
    ).toThrow(/symbol index/u);
  });

  it("rejects duplicate exports before publishing an archive", (): void => {
    const left = compileCs486Object("c", "int same(void) { return 1; }");
    const right = compileCs486Object("c", "int same(void) { return 2; }");
    expect(() =>
      createCs486Archive([
        { name: "left.o", object: left },
        { name: "right.o", object: right },
      ]),
    ).toThrow(/duplicate archive symbol/u);
  });

  it("rejects member and encoded capacity plus one before publication", (): void => {
    const object = compileCs486Object("c", "int one(void) { return 1; }");
    expect(() =>
      createCs486Archive(
        Array.from(
          { length: CS486_ARCHIVE_LIMITS.members + 1 },
          (_unused, index) => ({ name: `m${String(index)}.o`, object }),
        ),
      ),
    ).toThrow(/archive member limit exceeded/u);
    expect(() =>
      parseCs486Archive(
        `CS486AR\n${"x".repeat(CS486_ARCHIVE_LIMITS.encodedCharacters)}`,
      ),
    ).toThrow(/not a CS486AR archive/u);
  });
});
