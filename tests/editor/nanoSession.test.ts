import { describe, expect, it } from "vitest";

import { NanoEditorSession } from "../../src/application/editor/nanoSession.js";

describe("NanoEditorSession", (): void => {
  it("edits the current line, advances, and saves an explicit revision", (): void => {
    const editor = new NanoEditorSession("demo.lua", "one\ntwo");

    const edited = editor.submit("ONE");
    expect(edited.kind).toBe("continue");
    expect(edited.snapshot.currentLine).toBe(1);
    expect(edited.snapshot.lines[0]).toBe("ONE");
    expect(edited.snapshot.dirty).toBe(true);

    const saved = editor.submit(":w");
    expect(saved.kind).toBe("saved");
    expect(saved.snapshot.revision).toBe(1);
    expect(saved.snapshot.dirty).toBe(false);

    const closed = editor.submit(":q");
    expect(closed).toMatchObject({
      kind: "closed",
      saved: false,
      discardedChanges: false,
    });
    expect(() => editor.submit("late")).toThrow("already closed");
  });

  it("blocks a normal quit with unsaved changes and makes forced discard observable", (): void => {
    const editor = new NanoEditorSession("demo.lua", "one");
    editor.submit("changed");

    expect(editor.submit(":q")).toMatchObject({
      kind: "blocked",
      reason: "unsaved_changes",
    });
    expect(editor.submit(":q!")).toMatchObject({
      kind: "closed",
      saved: false,
      discardedChanges: true,
    });
  });

  it("keeps navigation bounded and the active row visible", (): void => {
    const editor = new NanoEditorSession(
      "long.txt",
      Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join("\n"),
    );

    editor.submit(":up");
    expect(editor.snapshot.currentLine).toBe(0);
    for (let index = 0; index < 15; index += 1) editor.submit(":down");

    const rows = editor.visibleRows(8);
    expect(rows).toHaveLength(8);
    expect(rows.some((row) => row.active)).toBe(true);
    expect(() => editor.visibleRows(0)).toThrow(RangeError);
  });

  it("saves before closing with :wq and finalizes cancel explicitly", (): void => {
    const saved = new NanoEditorSession("saved.txt", "line");
    saved.submit("changed");
    expect(saved.submit(":wq")).toMatchObject({
      kind: "closed",
      saved: true,
      discardedChanges: false,
      snapshot: { revision: 1, state: "closed" },
    });

    const canceled = new NanoEditorSession("canceled.txt", "line");
    canceled.submit("changed");
    expect(canceled.cancel()).toMatchObject({
      kind: "closed",
      saved: false,
      discardedChanges: true,
    });
  });

  it("keeps visible line numbers within 999 and rejects line 1000", (): void => {
    const maximum = Array.from({ length: 999 }, (_, index) =>
      String(index + 1),
    ).join("\n");
    const editor = new NanoEditorSession("max.txt", maximum);
    for (let index = 1; index < 999; index += 1) editor.submit(":down");

    const rejected = editor.submit("last");
    expect(rejected.snapshot.lines).toHaveLength(999);
    expect(rejected.snapshot.status).toBe("Document line limit reached.");
    expect(editor.visibleRows().at(-1)?.lineNumber).toBe(999);

    const oversized = Array.from({ length: 1_000 }, () => "line").join("\n");
    expect(() => new NanoEditorSession("too-many.txt", oversized)).toThrow(
      "nano document line limit exceeded",
    );
  });
});
