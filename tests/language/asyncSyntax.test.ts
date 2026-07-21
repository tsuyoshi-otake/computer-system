import { describe, expect, it } from "vitest";

import { LanguageSyntaxError } from "../../src/domain/language/errors.js";
import { parse } from "../../src/domain/language/parser.js";
import { analyzeScopes } from "../../src/domain/language/scope.js";

describe("Python async syntax and scope", (): void => {
  it("parses decorated async functions and await expressions", (): void => {
    const module = parse(`
@decorate
async def fetch(factory):
    result = await factory().value
    return result
`);
    const definition = module.body[0];
    expect(definition).toMatchObject({
      asynchronous: true,
      decorators: [{ kind: "IdentifierExpression", name: "decorate" }],
      kind: "FunctionDefinition",
      name: "fetch",
    });
    if (definition?.kind !== "FunctionDefinition") return;
    const assignment = definition.body[0];
    expect(assignment?.kind).toBe("AssignmentStatement");
    if (assignment?.kind !== "AssignmentStatement") return;
    expect(assignment.value).toMatchObject({
      kind: "AwaitExpression",
      value: {
        attribute: "value",
        kind: "AttributeExpression",
        object: { kind: "CallExpression" },
      },
    });

    const scope = analyzeScopes(module).functionScopes.get(definition);
    expect(scope?.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ binding: "local", name: "factory" }),
        expect.objectContaining({ binding: "local", name: "result" }),
      ]),
    );
  });

  it("parses async for and async with only inside coroutine scopes", (): void => {
    const module = parse(`
async def consume(source, manager):
    async for item in source:
        async with manager as entered:
            use(item, entered)
`);
    const definition = module.body[0];
    expect(definition?.kind).toBe("FunctionDefinition");
    if (definition?.kind !== "FunctionDefinition") return;
    const loop = definition.body[0];
    expect(loop).toMatchObject({
      asynchronous: true,
      kind: "ForStatement",
      target: { name: "item" },
    });
    if (loop?.kind !== "ForStatement") return;
    expect(loop.body[0]).toMatchObject({
      asynchronous: true,
      kind: "WithStatement",
      items: [{ target: { name: "entered" } }],
    });
    expect(() => analyzeScopes(module)).not.toThrow();
  });

  it("keeps await inside a comprehension owned by its async function", (): void => {
    const module = parse(`
async def gather(values):
    return [await transform(value) for value in values]
`);
    expect(() => analyzeScopes(module)).not.toThrow();
  });

  it("parses asynchronous comprehensions and generator expressions", (): void => {
    const module = parse(`
async def gather(source):
    values = [await transform(value) async for value in source if await allowed(value)]
    stream = (value async for value in source)
`);
    const definition = module.body[0];
    expect(definition?.kind).toBe("FunctionDefinition");
    if (definition?.kind !== "FunctionDefinition") return;
    const values = definition.body[0];
    const stream = definition.body[1];
    expect(values?.kind).toBe("AssignmentStatement");
    expect(stream?.kind).toBe("AssignmentStatement");
    if (
      values?.kind !== "AssignmentStatement" ||
      stream?.kind !== "AssignmentStatement"
    ) {
      return;
    }
    expect(values.value).toMatchObject({
      clauses: [
        { asynchronous: true, clauseKind: "for" },
        { clauseKind: "if", condition: { kind: "AwaitExpression" } },
      ],
      containerKind: "list",
      kind: "ComprehensionExpression",
    });
    expect(stream.value).toMatchObject({
      clauses: [{ asynchronous: true, clauseKind: "for" }],
      containerKind: "generator",
      kind: "ComprehensionExpression",
    });
    expect(() => analyzeScopes(module)).not.toThrow();
  });

  it("allows async generator expressions outside coroutine scopes", (): void => {
    expect(() =>
      analyzeScopes(
        parse(`
module_stream = (value async for value in source)
def make(values):
    return (await transform(value) for value in values)
`),
      ),
    ).not.toThrow();
  });

  it("rejects eager asynchronous comprehensions outside coroutine scopes", (): void => {
    expect(() =>
      analyzeScopes(parse("values = [value async for value in source]\n")),
    ).toThrow(/asynchronous comprehension outside async function/);
    expect(() =>
      analyzeScopes(
        parse(
          "def invalid(source):\n    return {value async for value in source}\n",
        ),
      ),
    ).toThrow(/asynchronous comprehension outside async function/);
  });

  it.each([
    ["module await", "result = await operation\n"],
    ["sync function await", "def invalid():\n    return await operation\n"],
    [
      "nested sync function await",
      "async def outer():\n    def inner():\n        return await operation\n",
    ],
    [
      "nested class await",
      "async def outer():\n    class Inner:\n        value = await operation\n",
    ],
    ["module async for", "async for item in values:\n    pass\n"],
    [
      "sync async with",
      "def invalid():\n    async with manager:\n        pass\n",
    ],
    [
      "yield from in async function",
      "async def invalid():\n    yield from values\n",
    ],
    [
      "return value in async generator",
      "async def invalid():\n    yield 1\n    return 2\n",
    ],
  ])("rejects %s", (_name, source): void => {
    expect(() => analyzeScopes(parse(source))).toThrow(LanguageSyntaxError);
  });

  it("rejects malformed async statement targets", (): void => {
    expect(() => parse("async class Invalid:\n    pass\n")).toThrow(
      /async must be followed by def, for, or with/,
    );
    expect(() => parse("@decorate\nasync class Invalid:\n    pass\n")).toThrow(
      /Decorator async target must be def/,
    );
    expect(() => parse("values = [value async if ready]\n")).toThrow(
      /Expected keyword for/,
    );
  });
});
