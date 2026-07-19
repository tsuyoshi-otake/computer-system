import { describe, expect, it } from "vitest";

import {
  DosIdeSession,
  type DosIdeLanguage,
  type DosIdeProduct,
} from "../../src/application/editor/qbasicSession.js";
import { dosTuiColor } from "../../src/application/editor/dosTuiTheme.js";
import type { EditorScreen } from "../../src/application/editor/editorScreen.js";

interface ProductFixture {
  readonly contents: string;
  readonly fileName: string;
  readonly language: DosIdeLanguage;
  readonly product: DosIdeProduct;
}

const products: readonly ProductFixture[] = [
  {
    contents: "PRINT 42",
    fileName: "C:\\DEMO.BAS",
    language: "basic",
    product: "qbasic",
  },
  {
    contents: "mov eax, 42\nhalt",
    fileName: "C:\\MAIN.ASM",
    language: "asm",
    product: "cs-asm",
  },
  {
    contents: "int main(void) { return 0; }",
    fileName: "C:\\MAIN.C",
    language: "c",
    product: "cs-cpp",
  },
] as const;

function cellsText(
  row: readonly { readonly character: string }[] | undefined,
): string {
  return row?.map(({ character }) => character).join("") ?? "";
}

function session(fixture: ProductFixture, showWelcome: boolean): DosIdeSession {
  return new DosIdeSession(
    fixture.fileName,
    fixture.contents,
    80,
    25,
    fixture.fileName,
    {
      language: fixture.language,
      product: fixture.product,
      showWelcome,
    },
  );
}

function expectSingleLineFrameAndShadow(screen: EditorScreen): void {
  const lines = screen.rows.map((row) => cellsText(row));
  const candidates: {
    readonly bottom: number;
    readonly left: number;
    readonly right: number;
    readonly top: number;
  }[] = [];
  for (const [top, line] of lines.entries()) {
    for (
      let left = line.indexOf("\u250c");
      left >= 0;
      left = line.indexOf("\u250c", left + 1)
    ) {
      const right = line.indexOf("\u2510", left + 1);
      if (right <= left) continue;
      const bottom = lines.findIndex(
        (candidate, index) =>
          index > top &&
          candidate[left] === "\u2514" &&
          candidate[right] === "\u2518",
      );
      if (bottom > top) candidates.push({ bottom, left, right, top });
    }
  }
  const frame = candidates.sort(
    (left, right) => right.right - right.left - (left.right - left.left),
  )[0];
  expect(frame).toBeDefined();
  const { bottom, left, right, top } = frame!;
  expect(
    lines.slice(top + 1, bottom).every((line) => line[left] === "\u2502"),
  ).toBe(true);
  expect(
    lines.slice(top + 1, bottom).every((line) => line[right] === "\u2502"),
  ).toBe(true);

  for (const shadowColumn of [right + 1, right + 2]) {
    expect(
      screen.rows
        .slice(top + 1, bottom + 2)
        .every(
          (row) =>
            row[shadowColumn]?.foreground === dosTuiColor.black &&
            row[shadowColumn]?.background === dosTuiColor.black,
        ),
    ).toBe(true);
  }
  expect(
    screen.rows[bottom + 1]!.slice(
      left + 2,
      Math.min(right + 3, screen.rows[bottom + 1]!.length),
    ).every(
      ({ foreground, background }) =>
        foreground === dosTuiColor.black && background === dosTuiColor.black,
    ),
  ).toBe(true);
  expect(lines.join("\n")).not.toMatch(/\+-{2,}\+/u);
}

function expectEditChromeAlignment(screen: EditorScreen): void {
  expect(cellsText(screen.rows[0])).toMatch(/^ {2}File\b/u);
  expect(cellsText(screen.rows.at(-1))).toMatch(/^ /u);
  expect(
    screen.rows.slice(2, -2).every((row) => row[0]?.character === "│"),
  ).toBe(true);
}

describe("shared DOS TUI theme", (): void => {
  it.each(products)(
    "renders $product welcome and menu surfaces like EDIT",
    (fixture): void => {
      const ide = session(fixture, true);
      expectSingleLineFrameAndShadow(ide.screen());

      const editing = ide.key("Enter");
      expectEditChromeAlignment(editing.screen);
      const menu = ide.key("Alt+f");
      expectSingleLineFrameAndShadow(menu.screen);
      expect(
        menu.screen.rows.some((row) => cellsText(row).includes("Open...")),
      ).toBe(true);
    },
  );

  it.each(products)(
    "keeps $product Display on the exact EDIT dialog path",
    (fixture): void => {
      const ide = session(fixture, false);
      ide.key("Alt+o");
      const displayed = ide.key("d");
      const dialog = displayed.screen.rows
        .map((row) => cellsText(row))
        .join("\n");
      expect(dialog).not.toContain("Foreground");
      expect(dialog).not.toContain("Background");
      expect(dialog).toContain("[X] Scroll Bars");
      expect(dialog).toContain("Tab Stops: 4");
      expectSingleLineFrameAndShadow(displayed.screen);

      ide.key("Tab");
      ide.key("Tab");
      const applied = ide.key("Enter");
      expect(applied.kind).toBe("continue");
      expect(
        applied.screen.rows.map((row) => cellsText(row)).join("\n"),
      ).not.toContain("Tab Stops: 4");
    },
  );
});
