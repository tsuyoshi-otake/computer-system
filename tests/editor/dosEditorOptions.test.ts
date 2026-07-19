import { describe, expect, it } from "vitest";

import {
  defaultDosEditorProfileOptions,
  emptyDosEditorConfiguration,
  parseDosEditorConfiguration,
  resolveDosEditorOptions,
  serializeDosEditorConfiguration,
  updateDosEditorProfile,
} from "../../src/application/editor/dosEditorOptions.js";
import {
  DosEditSession,
  dosTuiColor,
} from "../../src/application/editor/dosEditSession.js";
import type { ViExternalDocument } from "../../src/application/editor/viCompletion.js";
import { QBasicSession } from "../../src/application/editor/qbasicSession.js";
import {
  indexViDocument,
  lexViLine,
  resolveViFiletype,
} from "../../src/application/editor/viLanguage.js";
import { ShellSession } from "../../src/application/os/shellSession.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";

function text(row: readonly { readonly character: string }[]): string {
  return row.map(({ character }) => character).join("");
}

describe("DOS editor options and language services", (): void => {
  it("loads common and product settings atomically", (): void => {
    const configuration = parseDosEditorConfiguration(
      [
        "[common]",
        "syntax=on",
        "number=on",
        "tabstop=8",
        "completesources=current,buffers,symbols,keywords",
        "",
        "[qbasic]",
        "filetype=basic",
        "autoindent=on",
        "",
        "[pwb]",
        "filetype=cpp",
      ].join("\r\n"),
    );

    expect(resolveDosEditorOptions(configuration, "qbasic")).toMatchObject({
      autoindent: true,
      filetype: "basic",
      number: true,
      tabstop: 8,
    });
    expect(resolveDosEditorOptions(configuration, "pwb")).toMatchObject({
      filetype: "cpp",
      number: true,
    });
    expect(() =>
      parseDosEditorConfiguration("[common]\r\nnumber=on\r\ntabstop=99"),
    ).toThrow("EDITOR.INI line 3");
    expect(() =>
      parseDosEditorConfiguration(
        Array.from({ length: 65 }, () => ";").join("\n"),
      ),
    ).toThrow("64 lines");
    expect(() => parseDosEditorConfiguration(" ".repeat(4_097))).toThrow(
      "4096 characters",
    );
  });

  it("preserves other product sections when one profile is saved", (): void => {
    const original = parseDosEditorConfiguration(
      "[qbasic]\r\nnumber=on\r\n\r\n[pwb]\r\nrainbow=on\r\n",
    );
    const updated = updateDosEditorProfile(original, "edit", {
      ...defaultDosEditorProfileOptions("edit"),
      wrap: true,
    });
    const reloaded = parseDosEditorConfiguration(
      serializeDosEditorConfiguration(updated),
    );

    expect(resolveDosEditorOptions(reloaded, "qbasic").number).toBe(true);
    expect(resolveDosEditorOptions(reloaded, "pwb").rainbow).toBe(true);
    expect(resolveDosEditorOptions(reloaded, "edit").wrap).toBe(true);
  });

  it("recognizes and indexes bounded CS QBASIC syntax", (): void => {
    expect(resolveViFiletype("auto", "C:\\WORK\\DEMO.BAS")).toBe("basic");
    const lexed = lexViLine("basic", "PRINT value ' comment", 80);
    expect(lexed.tokens.some(({ kind }) => kind === "keyword")).toBe(true);
    expect(lexed.tokens.some(({ kind }) => kind === "comment")).toBe(true);

    const index = indexViDocument(
      "basic",
      "C:\\WORK\\DEMO.BAS",
      "SUB Hello\nEND SUB\nTYPE Point\nEND TYPE\nStart:\n",
    );
    expect(index.symbols.map(({ name }) => name)).toEqual([
      "Hello",
      "Point",
      "Start",
    ]);
  });

  it("renders configured source options and applies auto-indent and tabs", (): void => {
    const configuration = parseDosEditorConfiguration(
      "[edit]\r\nnumber=on\r\nsyntax=on\r\nautoindent=on\r\ntabstop=2\r\n",
    );
    const editor = new DosEditSession(
      "C:\\WORK\\DEMO.C",
      "  int main() {",
      51,
      19,
      "DEMO.C",
      true,
      undefined,
      { configuration, profile: "edit" },
    );

    expect(text(editor.screen().rows[2]!)).toMatch(/^│\s*1\s{3}int/u);
    expect(
      editor
        .screen()
        .rows[2]!.slice(1, 5)
        .every(({ foreground }) => foreground === dosTuiColor.activeLineNumber),
    ).toBe(true);
    editor.key("End");
    editor.key("Enter");
    expect(editor.cursor.column).toBe(2);
    editor.key("Tab");
    expect(editor.contents).toBe("  int main() {\n    ");
  });

  it("completes BASIC keywords and jumps through the local symbol index", (): void => {
    const configuration = emptyDosEditorConfiguration();
    const completion = new DosEditSession(
      "C:\\WORK\\DEMO.BAS",
      "pri",
      51,
      19,
      "DEMO.BAS",
      true,
      undefined,
      { configuration, profile: "qbasic" },
    );
    completion.key("End");
    completion.key("Ctrl+Space");
    expect(completion.mode).toBe("completion");
    completion.key("Enter");
    expect(completion.contents).toBe("PRINT");

    const navigation = new DosEditSession(
      "C:\\WORK\\JUMP.BAS",
      "SUB Hello\nEND SUB\nhello",
      51,
      19,
      "JUMP.BAS",
      true,
      undefined,
      { configuration, profile: "qbasic" },
    );
    navigation.key("Ctrl+End");
    navigation.key("Home");
    navigation.key("F12");
    expect(navigation.cursor).toEqual({ column: 4, line: 0 });
    navigation.key("Alt+Left");
    expect(navigation.cursor).toEqual({ column: 0, line: 2 });
  });

  it("uses bounded recent-buffer and opted-in direct-include candidates", (): void => {
    const configuration = parseDosEditorConfiguration(
      "[edit]\r\ncompletesources=current,buffers,symbols,keywords,includes\r\ndefinitionsources=current,buffers,includes\r\n",
    );
    const editor = new DosEditSession(
      "C:\\WORK\\ONE.C",
      "int BufferWord;",
      51,
      19,
      "ONE.C",
      true,
      undefined,
      {
        configuration,
        profile: "edit",
        externalContext: (): readonly ViExternalDocument[] => [
          {
            contents: "int HeaderSymbol() { return 1; }\n",
            path: "C:\\INCLUDE\\DEMO.H",
          },
        ],
      },
    );
    editor.completeOpen("C:\\WORK\\TWO.C", "Buff", "TWO.C");
    editor.key("End");
    editor.key("Ctrl+Space");
    editor.key("Enter");
    expect(editor.contents).toBe("BufferWord");

    editor.completeOpen(
      "C:\\WORK\\THREE.C",
      '#include "DEMO.H"\nHead',
      "THREE.C",
    );
    editor.key("Ctrl+End");
    editor.key("Ctrl+Space");
    editor.key("Enter");
    expect(editor.contents).toContain("HeaderSymbol");
    editor.completeOpen(
      "C:\\WORK\\THREE.C",
      '#include "DEMO.H"\nHeaderSymbol',
      "THREE.C",
    );
    editor.key("Ctrl+End");
    const definition = editor.key("F12");
    expect(definition).toMatchObject({
      kind: "navigate",
      line: 0,
      path: "C:\\INCLUDE\\DEMO.H",
    });
  });

  it("applies the correct product profile to QBASIC, PWB, and CSASM", (): void => {
    const configuration = parseDosEditorConfiguration(
      [
        "[qbasic]",
        "number=on",
        "[pwb]",
        "filetype=cpp",
        "rainbow=on",
        "[csasm]",
        "filetype=asm",
        "list=on",
      ].join("\r\n"),
    );
    const qbasic = new QBasicSession("C:\\A.BAS", "PRINT 1", 51, 19, "A.BAS", {
      editorConfiguration: configuration,
      language: "basic",
      product: "qbasic",
    });
    const pwb = new QBasicSession("C:\\A.CPP", "int x;", 51, 19, "A.CPP", {
      editorConfiguration: configuration,
      language: "cpp",
      product: "cs-cpp",
    });
    const csasm = new QBasicSession("C:\\A.ASM", "start:", 51, 19, "A.ASM", {
      editorConfiguration: configuration,
      language: "asm",
      product: "cs-asm",
    });

    expect(qbasic.editorOptions).toMatchObject({
      filetype: "basic",
      number: true,
    });
    expect(pwb.editorOptions).toMatchObject({ filetype: "cpp", rainbow: true });
    expect(csasm.editorOptions).toMatchObject({ filetype: "asm", list: true });
  });

  it.each([
    {
      fileName: "C:\\A.BAS",
      language: "basic",
      product: "qbasic",
      source: "PRINT 1",
    },
    {
      fileName: "C:\\A.CPP",
      language: "cpp",
      product: "cs-cpp",
      source: "int x;",
    },
    {
      fileName: "C:\\A.ASM",
      language: "asm",
      product: "cs-asm",
      source: "start:",
    },
  ] as const)(
    "applies shared Options through the $product menu wrapper",
    ({ fileName, language, product, source }): void => {
      const session = new QBasicSession(fileName, source, 51, 19, fileName, {
        language,
        product,
      });

      session.key("Alt+o");
      session.key("e");
      session.key(" ");
      session.key("Shift+Tab");
      session.key("ArrowLeft");
      session.key("Enter");

      expect(session.editorOptions.syntax).toBe(false);
    },
  );

  it.each([
    { height: 19, width: 51 },
    { height: 25, width: 80 },
  ])(
    "renders every Editing option and explicit terminal action at $width x $height",
    ({ height, width }): void => {
      const editor = new DosEditSession(
        "C:\\WORK\\DEMO.C",
        "int main(void) {}",
        width,
        height,
      );
      const opened = editor.invoke("editing-options");
      const lines = opened.screen.rows.map((row) => text(row));
      const visible = lines.join("\n");

      expect(lines).toHaveLength(height);
      expect(lines.every((line) => line.length === width)).toBe(true);
      expect(visible).toContain("Syntax Highlight");
      expect(visible).toContain("Line Numbers");
      expect(visible).toContain("Rainbow Indent");
      expect(visible).toContain("Whitespace Marks");
      expect(visible).toContain("Line Wrapping");
      expect(visible).toContain("Auto Indent");
      expect(visible).toContain("Expand Tabs");
      expect(visible).toContain("Tab Width");
      expect(visible).toContain("Indent Width");
      expect(visible).toContain("< OK >");
      expect(visible).toContain("< Cancel >");
    },
  );

  it("keeps the compact Display dialog on its single bounded OK/Cancel path", (): void => {
    const editor = new DosEditSession("C:\\WORK\\DEMO.TXT", "", 51, 19);
    const opened = editor.invoke("display-options");
    const visible = opened.screen.rows.map((row) => text(row)).join("\n");

    expect(visible.match(/\bOK\s+Apply\b/gu) ?? []).toHaveLength(1);
    expect(visible.match(/\bCancel\s+Revert\b/gu) ?? []).toHaveLength(1);
    expect(visible).not.toContain("< OK >");
    expect(visible).not.toContain("< Cancel >");
    editor.key("Tab");
    editor.key("ArrowRight");
    editor.key("Tab");
    const applied = editor.key("Enter");
    expect(editor.mode).toBe("editing");
    expect(editor.options.tabstop).toBe(9);
    expect(text(applied.screen.rows.at(-1)!)).toContain(
      "Display options applied",
    );
  });

  it("applies and cancels every generic Options page by keyboard and pointer", (): void => {
    const editor = new DosEditSession(
      "C:\\WORK\\DEMO.C",
      "int main(void) {}",
      51,
      19,
    );

    editor.invoke("editing-options");
    for (const key of [
      " ",
      "ArrowDown",
      " ",
      "ArrowDown",
      " ",
      "ArrowDown",
      " ",
      "ArrowDown",
      " ",
      "ArrowDown",
      " ",
      "ArrowDown",
      " ",
      "ArrowDown",
      "ArrowRight",
      "ArrowDown",
      "ArrowLeft",
      "ArrowDown",
    ]) {
      editor.key(key);
    }
    const editingApplied = editor.key("Enter");
    expect(editor.mode).toBe("editing");
    expect(text(editingApplied.screen.rows.at(-1)!)).toContain(
      "Editing options applied",
    );
    expect(editor.options).toMatchObject({
      autoindent: true,
      expandtab: false,
      list: true,
      number: true,
      rainbow: true,
      shiftwidth: 3,
      syntax: false,
      tabstop: 9,
      wrap: true,
    });

    editor.invoke("editing-options");
    editor.key(" ");
    const editingCancelled = editor.key("Escape");
    expect(text(editingCancelled.screen.rows.at(-1)!)).toContain(
      "Options cancelled",
    );
    expect(editor.options.syntax).toBe(false);

    editor.invoke("completion-options");
    editor.key(" ");
    editor.key("Shift+Tab");
    editor.key("ArrowLeft");
    editor.key("Enter");
    expect(editor.options.complete).toBe(false);

    editor.invoke("language-options");
    const languageChanged = editor.key("ArrowRight");
    const languageLines = languageChanged.screen.rows.map((row) => text(row));
    const okRow = languageLines.findIndex((line) => line.includes("< OK >"));
    const okColumn = languageLines[okRow]!.indexOf("< OK >");
    editor.pointerDown(okColumn + 1, okRow + 1);
    expect(editor.mode).toBe("editing");
    expect(editor.options.filetype).toBe("text");

    editor.invoke("language-options");
    const languageCancelled = editor.key("ArrowRight");
    const cancelLines = languageCancelled.screen.rows.map((row) => text(row));
    const cancelRow = cancelLines.findIndex((line) =>
      line.includes("< Cancel >"),
    );
    const cancelColumn = cancelLines[cancelRow]!.indexOf("< Cancel >");
    editor.pointerDown(cancelColumn + 1, cancelRow + 1);
    expect(editor.mode).toBe("editing");
    expect(editor.options.filetype).toBe("text");
  });

  it("commits and serializes Options independently for all four products", (): void => {
    for (const profile of ["edit", "qbasic", "pwb", "csasm"] as const) {
      const editor = new DosEditSession(
        "C:\\WORK\\DEMO.TXT",
        "",
        51,
        19,
        "DEMO.TXT",
        true,
        undefined,
        { profile },
      );
      editor.invoke("editing-options");
      editor.key("ArrowDown");
      editor.key(" ");
      for (let index = 0; index < 8; index += 1) editor.key("Tab");
      editor.key("Enter");
      const request = editor.invoke("save-settings");

      expect(request.kind).toBe("settings-save");
      if (request.kind === "settings-save") {
        const saved = parseDosEditorConfiguration(request.contents);
        expect(resolveDosEditorOptions(saved, profile).number).toBe(true);
        for (const other of ["edit", "qbasic", "pwb", "csasm"] as const) {
          if (other !== profile) {
            expect(resolveDosEditorOptions(saved, other).number).toBe(false);
          }
        }
      }
    }
  });

  it("reloads persisted settings and keeps Restore Defaults session-scoped until save", (): void => {
    const configured = parseDosEditorConfiguration(
      "[edit]\r\nsyntax=off\r\nnumber=on\r\n",
    );
    const editor = new DosEditSession(
      "C:\\WORK\\DEMO.TXT",
      "",
      51,
      19,
      "DEMO.TXT",
      true,
      undefined,
      { configuration: configured, profile: "edit" },
    );

    editor.invoke("default-settings");
    expect(editor.options).toMatchObject({ number: false, syntax: true });
    expect(editor.invoke("reload-settings").kind).toBe("settings-reload");
    editor.completeSettingsReload(configured);
    expect(editor.options).toMatchObject({ number: true, syntax: false });

    editor.invoke("default-settings");
    const request = editor.invoke("save-settings");
    expect(request.kind).toBe("settings-save");
    if (request.kind === "settings-save") {
      const saved = parseDosEditorConfiguration(request.contents);
      expect(resolveDosEditorOptions(saved, "edit")).toMatchObject({
        number: false,
        syntax: true,
      });
    }
  });

  it("emits bounded settings and guest-command requests", (): void => {
    const editor = new DosEditSession("C:\\WORK\\DEMO.TXT", "before");
    const settings = editor.invoke("save-settings");
    expect(settings.kind).toBe("settings-save");
    if (settings.kind === "settings-save") {
      expect(settings.contents.length).toBeLessThanOrEqual(4_096);
    }

    editor.key("Alt+f");
    editor.key("i");
    for (const key of "ECHO after") editor.key(key);
    const request = editor.key("Enter");
    expect(request).toMatchObject({
      command: "ECHO after",
      insertOutput: true,
      kind: "shell",
    });
    editor.completeShellCommand(0, "after\r\n", "", true);
    expect(editor.contents).toBe("before\nafter");
    editor.key("Ctrl+Z");
    expect(editor.contents).toBe("before");
  });

  it("loads and saves C:\\EDITOR.INI through the DOS editor", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem, { osProfile: "dos" });
    filesystem.writeFile(
      "/drives/c/editor.ini",
      "[edit]\r\nnumber=on\r\nsyntax=on\r\n\r\n[qbasic]\r\nrainbow=on\r\n",
    );
    filesystem.writeFile("/drives/c/demo.c", "int main() {}\r\n");

    const opened = shell.submit("EDIT C:\\DEMO.C");
    expect(text(opened.terminalScreen?.rows[2] ?? [])).toMatch(/^│\s*1\s+int/u);
    shell.keys([
      "Alt+o",
      "e",
      " ",
      "ArrowDown",
      " ",
      "ArrowDown",
      " ",
      "ArrowDown",
      " ",
      "ArrowDown",
      " ",
      "ArrowDown",
      " ",
      "ArrowDown",
      " ",
      "ArrowDown",
      "ArrowRight",
      "ArrowDown",
      "ArrowLeft",
      "ArrowDown",
      "Enter",
    ]);
    shell.keys(["Alt+o", "s"]);
    const saved = parseDosEditorConfiguration(
      filesystem.readFile("/drives/c/editor.ini"),
    );
    expect(resolveDosEditorOptions(saved, "edit")).toMatchObject({
      autoindent: true,
      expandtab: false,
      list: true,
      number: false,
      rainbow: true,
      shiftwidth: 3,
      syntax: false,
      tabstop: 9,
      wrap: true,
    });
    expect(resolveDosEditorOptions(saved, "qbasic").rainbow).toBe(true);

    shell.keys(["Alt+f", "x"]);
    shell.submit("EDIT C:\\DEMO.C");
    const reopened = shell.keys(["Alt+o", "e"]);
    const reopenedText = reopened.terminalScreen?.rows
      .map((row) => text(row))
      .join("\n");
    expect(reopenedText).toContain("Syntax Highlight       Off");
    expect(reopenedText).toContain("Line Numbers           Off");
    expect(reopenedText).toContain("Rainbow Indent         On");
    expect(reopenedText).toContain("Tab Width              9");
  });

  it("runs only bounded guest DOS commands and inserts undoable output", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem, { osProfile: "dos" });
    shell.submit("MD C:\\WORK");
    filesystem.writeFile("/drives/c/work/demo.txt", "before\r\n");
    shell.submit("CD C:\\WORK");
    shell.submit("SET SAMPLE=before");
    shell.submit("EDIT C:\\WORK\\DEMO.TXT");

    const output = shell.keys(["Alt+f", "d", ..."ECHO hello", "Enter"]);
    expect(
      output.terminalScreen?.rows.some((row) => text(row).includes("hello")),
    ).toBe(true);
    shell.keys(["Escape"]);

    const rejected = shell.keys(["Alt+f", "d", ..."EDIT", "Enter"]);
    expect(
      rejected.terminalScreen?.rows.map((row) => text(row)).join("\n"),
    ).toContain("cannot run in a pipeline or redirect");
    shell.keys(["Escape"]);

    shell.keys(["Ctrl+End", "Alt+f", "i", ..."ECHO inserted", "Enter", "F2"]);
    expect(filesystem.readFile("/drives/c/work/demo.txt")).toContain(
      "inserted",
    );
    shell.keys(["Alt+f", "x"]);
    expect(shell.submit("CD").stdout).toContain("C:\\WORK");
    expect(shell.submit("ECHO %SAMPLE%").stdout).toContain("before");
  });
});
