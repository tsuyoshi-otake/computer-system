import { describe, expect, it } from "vitest";

import {
  applyViSet,
  defaultViOptions,
  formatViOptions,
  parseViConfiguration,
} from "../../src/application/editor/viOptions.js";

describe("vi options", (): void => {
  it("starts display and automatic editing features disabled", (): void => {
    expect(defaultViOptions).toEqual({
      autoindent: false,
      complete: true,
      completecase: "smart",
      completeprefix: 2,
      completesources: ["current", "buffers", "symbols", "keywords"],
      definitionsources: ["current", "buffers"],
      expandtab: true,
      filetype: "auto",
      list: false,
      number: false,
      rainbow: false,
      shiftwidth: 2,
      syntax: false,
      tabstop: 2,
      wrap: false,
    });
  });

  it("applies boolean, inverse, query, and numeric options atomically", (): void => {
    const configured = applyViSet(defaultViOptions, [
      "number",
      "rainbow",
      "autoindent",
      "list",
      "wrap",
      "noexpandtab",
      "tabstop=8",
      "shiftwidth=4",
      "number?",
    ]);

    expect(configured.options).toMatchObject({
      autoindent: true,
      expandtab: false,
      list: true,
      number: true,
      rainbow: true,
      shiftwidth: 4,
      tabstop: 8,
      wrap: true,
    });
    expect(configured.messages).toEqual(["number"]);
    expect(() =>
      applyViSet(configured.options, ["nonumber", "tabstop=0"]),
    ).toThrow("tabstop must be an integer from 1 to 16");
    expect(configured.options.number).toBe(true);
  });

  it("loads a bounded vimrc without partially applying an invalid line", (): void => {
    expect(
      parseViConfiguration(
        '" user settings\nsyntax on\nset number rainbow tabstop=4 sw=3\n',
      ),
    ).toMatchObject({
      number: true,
      rainbow: true,
      shiftwidth: 3,
      syntax: true,
      tabstop: 4,
    });
    expect(() =>
      parseViConfiguration("set number\nset tabstop=99\nset wrap"),
    ).toThrow(".vimrc line 2");
    expect(() =>
      parseViConfiguration(
        Array.from({ length: 32 }, () => "set number").join("\n") + "\n",
      ),
    ).not.toThrow();
  });

  it("configures completion, definition, case, prefix, and filetype options", (): void => {
    const configured = applyViSet(defaultViOptions, [
      "nocomplete",
      "completecase=insensitive",
      "completeprefix=3",
      "completesources=current,includes",
      "definitionsources=current,buffers,includes",
      "ft=asm",
    ]).options;
    expect(configured).toMatchObject({
      complete: false,
      completecase: "insensitive",
      completeprefix: 3,
      completesources: ["current", "includes"],
      definitionsources: ["current", "buffers", "includes"],
      filetype: "asm",
    });
    expect(() =>
      applyViSet(configured, ["completesources=current,current"]),
    ).toThrow("duplicate");
    expect(() => applyViSet(configured, ["completeprefix=9"])).toThrow(
      "from 1 to 8",
    );
  });

  it("formats every supported option for set all", (): void => {
    expect(formatViOptions(defaultViOptions)).toEqual([
      "noautoindent",
      "complete",
      "completecase=smart",
      "completeprefix=2",
      "completesources=current,buffers,symbols,keywords",
      "definitionsources=current,buffers",
      "expandtab",
      "filetype=auto",
      "nolist",
      "nonumber",
      "norainbow",
      "nosyntax",
      "nowrap",
      "shiftwidth=2",
      "tabstop=2",
    ]);
  });
});
