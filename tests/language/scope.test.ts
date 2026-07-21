import { describe, expect, it } from "vitest";

import { parse } from "../../src/domain/language/parser.js";
import {
  analyzeScopes,
  type ScopeInfo,
  type ScopeSymbol,
} from "../../src/domain/language/scope.js";

function symbol(scope: ScopeInfo, name: string): ScopeSymbol | undefined {
  return scope.symbols.find((candidate) => candidate.name === name);
}

describe("Computer System Python scope analysis", (): void => {
  it("binds explicit from-import names and restricts wildcard imports to modules", (): void => {
    const analysis = analyzeScopes(
      parse(`
from package import value as answer, helper
from package import *
`),
    );

    expect(symbol(analysis.root, "answer")).toMatchObject({
      assigned: true,
      binding: "global",
    });
    expect(symbol(analysis.root, "helper")).toMatchObject({
      assigned: true,
      binding: "global",
    });
    expect(() =>
      analyzeScopes(
        parse(`
def invalid():
    from package import *
`),
      ),
    ).toThrow(/import \* is only allowed at module level/u);
  });

  it("classifies module globals, function locals, cells, and free variables", (): void => {
    const analysis = analyzeScopes(
      parse(`
x = 1
def outer(argument):
    captured = argument
    def inner():
        return x + captured
    return inner
`),
    );
    const outer = analysis.root.children[0]!;
    const inner = outer.children[0]!;

    expect(symbol(analysis.root, "x")).toMatchObject({ binding: "global" });
    expect(symbol(analysis.root, "outer")).toMatchObject({
      assigned: true,
      binding: "global",
    });
    expect(symbol(outer, "argument")).toMatchObject({
      binding: "local",
      parameter: true,
    });
    expect(symbol(outer, "captured")).toMatchObject({ binding: "cell" });
    expect(symbol(outer, "inner")).toMatchObject({ binding: "local" });
    expect(symbol(inner, "captured")).toMatchObject({ binding: "free" });
    expect(symbol(inner, "x")).toMatchObject({ binding: "global" });
  });

  it("propagates a closure binding through an intermediate function", (): void => {
    const analysis = analyzeScopes(
      parse(`
def outer():
    value = 1
    def middle():
        def inner():
            return value
        return inner
    return middle
`),
    );
    const outer = analysis.root.children[0]!;
    const middle = outer.children[0]!;
    const inner = middle.children[0]!;

    expect(symbol(outer, "value")).toMatchObject({ binding: "cell" });
    expect(symbol(middle, "value")).toMatchObject({ binding: "free" });
    expect(symbol(inner, "value")).toMatchObject({ binding: "free" });
  });

  it("treats defaults as parent references and assignments as whole-function locals", (): void => {
    const analysis = analyzeScopes(
      parse(`
fallback = 4
value = 1
def choose(argument=fallback):
    result = value
    value = argument
    return result
`),
    );
    const choose = analysis.root.children[0]!;

    expect(symbol(analysis.root, "fallback")).toMatchObject({
      binding: "global",
      referenced: true,
    });
    expect(symbol(choose, "value")).toMatchObject({
      assigned: true,
      binding: "local",
      referenced: true,
    });
  });

  it("bounds scope count, nesting, and unique symbols at exact capacity", (): void => {
    const module = parse(`
a = 1
b = 2
def outer():
    def inner():
        pass
    return inner
`);

    expect(
      analyzeScopes(module, {
        maxScopeNesting: 2,
        maxScopes: 3,
        maxSymbolsPerScope: 3,
      }).root.children,
    ).toHaveLength(1);
    expect(() => analyzeScopes(module, { maxScopes: 2 })).toThrow(
      /Scope count limit exceeded \(max 2\)/u,
    );
    expect(() => analyzeScopes(module, { maxScopeNesting: 1 })).toThrow(
      /Scope nesting limit exceeded \(max 1\)/u,
    );
    expect(() => analyzeScopes(module, { maxSymbolsPerScope: 2 })).toThrow(
      /Symbol limit exceeded \(max 2\)/u,
    );
  });

  it("rejects invalid instance-scoped analysis limits", (): void => {
    expect(() => analyzeScopes(parse("pass\n"), { maxScopes: 0 })).toThrow(
      RangeError,
    );
  });
});
