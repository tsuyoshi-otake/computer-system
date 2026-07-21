import { describe, expect, it } from "vitest";

import { LanguageSyntaxError } from "../../src/domain/language/errors.js";
import { parse, parseExpression } from "../../src/domain/language/parser.js";

describe("Computer System Python unpacking syntax", (): void => {
  it("retains starred list and tuple display items", (): void => {
    expect(parseExpression("[first, *middle, last]")).toMatchObject({
      kind: "ListExpression",
      elements: [
        { name: "first" },
        { kind: "StarredExpression", value: { name: "middle" } },
        { name: "last" },
      ],
    });
    expect(parseExpression("first, *middle, last")).toMatchObject({
      kind: "TupleExpression",
      elements: [
        { name: "first" },
        { kind: "StarredExpression", value: { name: "middle" } },
        { name: "last" },
      ],
    });
  });

  it("retains pair and mapping-unpack dictionary entries in source order", (): void => {
    expect(parseExpression('{"first": 1, **middle, "last": 3}')).toMatchObject({
      kind: "DictionaryExpression",
      entries: [
        { entryKind: "pair" },
        { entryKind: "mapping_unpack", value: { name: "middle" } },
        { entryKind: "pair" },
      ],
    });
  });

  it("accepts nested and single-starred assignment targets", (): void => {
    expect(
      parse("first, *middle, [last, *tail] = values\n").body[0],
    ).toMatchObject({
      kind: "AssignmentStatement",
      targets: [
        {
          kind: "TupleExpression",
          elements: [
            { name: "first" },
            { kind: "StarredExpression", value: { name: "middle" } },
            {
              kind: "ListExpression",
              elements: [
                { name: "last" },
                { kind: "StarredExpression", value: { name: "tail" } },
              ],
            },
          ],
        },
      ],
    });
  });

  it.each([
    ["standalone starred expression", "value = *items\n"],
    ["two starred targets", "first, *left, *right = values\n"],
    ["augmented sequence", "[first, second] += values\n"],
    ["invalid nested target", "[first, call()] = values\n"],
  ])("rejects %s", (_name, source): void => {
    expect(() => parse(source)).toThrow(LanguageSyntaxError);
  });
});
