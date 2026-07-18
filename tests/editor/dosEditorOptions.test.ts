import { describe, expect, it } from "vitest";

import {
  defaultDosEditorProfileOptions,
  emptyDosEditorConfiguration,
  parseDosEditorConfiguration,
  resolveDosEditorOptions,
  serializeDosEditorConfiguration,
  updateDosEditorProfile,
} from "../../src/application/editor/dosEditorOptions.js";
import { DosEditSession } from "../../src/application/editor/dosEditSession.js";
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
      "[edit]\r\nnumber=on\r\nsyntax=on\r\n",
    );
    filesystem.writeFile("/drives/c/demo.c", "int main() {}\r\n");

    const opened = shell.submit("EDIT C:\\DEMO.C");
    expect(text(opened.terminalScreen?.rows[2] ?? [])).toMatch(/^│\s*1\s+int/u);
    shell.keys([
      "Alt+o",
      "d",
      "Tab",
      "Tab",
      "Tab",
      "ArrowRight",
      "Tab",
      "Enter",
    ]);
    shell.keys(["Alt+o", "s"]);
    const saved = parseDosEditorConfiguration(
      filesystem.readFile("/drives/c/editor.ini"),
    );
    expect(resolveDosEditorOptions(saved, "edit")).toMatchObject({
      number: true,
      tabstop: 9,
    });
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
