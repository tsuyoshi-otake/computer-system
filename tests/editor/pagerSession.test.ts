import { describe, expect, it } from "vitest";

import { PagerSession } from "../../src/application/editor/pagerSession.js";

describe("PagerSession", (): void => {
  it("renders the first screen and reports Top/Bot/All viewport labels for less", (): void => {
    const lines = Array.from(
      { length: 40 },
      (_, index) => `line ${String(index + 1)}`,
    );
    const pager = new PagerSession(
      "less",
      "/home/cs/demo.txt",
      lines.join("\n"),
      40,
      10,
    );

    const first = pager.screen();
    expect(rowText(first.rows[0]!)).toContain("line 1");
    expect(rowText(first.rows.at(-1)!)).toContain("Top");

    const paged = pager.key("Space");
    expect(paged.kind).toBe("continue");
    expect(rowText(paged.screen.rows[0]!)).toContain("line 10");

    let bottom = paged;
    for (let index = 0; index < 6; index += 1) bottom = pager.key("Space");
    expect(rowText(bottom.screen.rows.at(-1)!)).toContain("Bot");
  });

  it("supports less backward scrolling and top/bottom jumps", (): void => {
    const lines = Array.from(
      { length: 40 },
      (_, index) => `line ${String(index + 1)}`,
    );
    const pager = new PagerSession(
      "less",
      "demo.txt",
      lines.join("\n"),
      40,
      10,
    );

    pager.key("G");
    expect(rowText(pager.screen().rows.at(-1)!)).toContain("Bot");
    pager.key("g");
    expect(rowText(pager.screen().rows[0]!)).toContain("line 1");
    pager.key("PageDown");
    const afterDown = pager.screen();
    pager.key("PageUp");
    expect(rowText(pager.screen().rows[0]!)).toContain("line 1");
    expect(rowText(afterDown.rows[0]!)).not.toBe(
      rowText(pager.screen().rows[0]!),
    );
  });

  it("keeps more forward-only: PageUp/b/g/G do not move the viewport", (): void => {
    const lines = Array.from(
      { length: 40 },
      (_, index) => `line ${String(index + 1)}`,
    );
    const pager = new PagerSession(
      "more",
      "demo.txt",
      lines.join("\n"),
      40,
      10,
    );

    pager.key("Space");
    const afterForward = pager.screen();
    pager.key("PageUp");
    pager.key("b");
    pager.key("g");
    pager.key("G");
    expect(rowText(pager.screen().rows[0]!)).toBe(
      rowText(afterForward.rows[0]!),
    );
  });

  it("shows --More--(NN%) then --More--(END) for the more status line", (): void => {
    const lines = Array.from(
      { length: 15 },
      (_, index) => `line ${String(index + 1)}`,
    );
    const pager = new PagerSession(
      "more",
      "demo.txt",
      lines.join("\n"),
      40,
      10,
    );

    expect(rowText(pager.screen().rows.at(-1)!)).toContain("--More--(");
    expect(rowText(pager.screen().rows.at(-1)!)).not.toContain("END");
    pager.key("Space");
    expect(rowText(pager.screen().rows.at(-1)!)).toContain("--More--(END)");
  });

  it("advances one line at a time with Enter and stops at the end", (): void => {
    const pager = new PagerSession(
      "more",
      "demo.txt",
      "a\nb\nc\nd\ne\nf\ng\nh",
      40,
      6,
    );
    expect(rowText(pager.screen().rows[0]!)).toContain("a");
    pager.key("Enter");
    expect(rowText(pager.screen().rows[0]!)).toContain("b");
    for (let index = 0; index < 4; index += 1) pager.key("Enter");
    expect(rowText(pager.screen().rows[0]!)).toContain("d");
  });

  it("quits on q/Q/Escape and rejects further keys once closed", (): void => {
    const pager = new PagerSession("less", "demo.txt", "one\ntwo", 40, 10);
    const closed = pager.key("q");
    expect(closed.kind).toBe("closed");
    expect(() => pager.key("Space")).toThrow("pager session is already closed");
  });

  it("truncates long lines at the terminal width without wrapping", (): void => {
    const long = "x".repeat(200);
    const pager = new PagerSession("less", "demo.txt", long, 40, 10);
    expect(rowText(pager.screen().rows[0]!).trimEnd().length).toBe(40);
  });

  it("rejects a terminal smaller than the bounded minimum", (): void => {
    expect(
      () => new PagerSession("less", "demo.txt", "content", 10, 10),
    ).toThrow("pager terminal is too small");
    expect(
      () => new PagerSession("less", "demo.txt", "content", 40, 3),
    ).toThrow("pager terminal is too small");
  });

  it("rejects a document beyond the bounded line limit", (): void => {
    const huge = Array.from({ length: 1_000 }, (_, index) =>
      String(index),
    ).join("\n");
    expect(() => new PagerSession("less", "demo.txt", huge, 40, 10)).toThrow(
      "pager document line limit exceeded",
    );
  });

  it("clamps the viewport correctly after a resize", (): void => {
    const lines = Array.from(
      { length: 15 },
      (_, index) => `line ${String(index + 1)}`,
    );
    const pager = new PagerSession(
      "less",
      "demo.txt",
      lines.join("\n"),
      40,
      10,
    );
    pager.key("G");
    expect(rowText(pager.screen().rows.at(-1)!)).toContain("Bot");
    pager.resize(40, 20);
    expect(rowText(pager.screen().rows[0]!)).toContain("line 1");
  });

  it("reports keys-mode terminal interaction while viewing and unavailable once closed", (): void => {
    const pager = new PagerSession("less", "demo.txt", "one\ntwo", 40, 10);
    expect(pager.terminalInteraction()).toMatchObject({
      context: "less",
      inputMode: "keys",
    });
    pager.key("q");
    expect(pager.terminalInteraction()).toMatchObject({
      context: "unavailable",
      ctrlCAction: "none",
      inputMode: "none",
    });
  });

  it("appends bounded live stdin and changes the unknown-length status at EOF", (): void => {
    const pager = new PagerSession(
      "less",
      "(standard input)",
      "",
      40,
      10,
      true,
    );
    expect(rowText(pager.screen().rows.at(-1)!)).toContain("Live");
    pager.append("first\nsec");
    pager.append("ond\n");
    expect(rowText(pager.screen().rows[0]!)).toContain("first");
    expect(rowText(pager.screen().rows[1]!)).toContain("second");
    expect(pager.inputComplete).toBe(false);
    pager.finishInput();
    expect(pager.inputComplete).toBe(true);
    expect(rowText(pager.screen().rows.at(-1)!)).toContain("All");
    expect(() => pager.append("late")).toThrow(
      "pager input is already complete",
    );
  });

  it("normalizes CRLF split across live input chunks without adding a phantom line", (): void => {
    const pager = new PagerSession(
      "less",
      "(standard input)",
      "",
      40,
      10,
      true,
    );
    pager.append("first\r");
    pager.append("\nsecond\r");
    pager.finishInput();
    expect(rowText(pager.screen().rows[0]!).trimEnd()).toBe("first");
    expect(rowText(pager.screen().rows[1]!).slice(0, 7)).toBe("second\r");
    expect(rowText(pager.screen().rows[2]!).trimEnd()).toBe("");
  });
});

function rowText(row: readonly { readonly character: string }[]): string {
  return row.map(({ character }) => character).join("");
}
