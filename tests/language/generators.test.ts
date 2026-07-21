import { describe, expect, it } from "vitest";

import { LanguageSyntaxError } from "../../src/domain/language/errors.js";
import { parse } from "../../src/domain/language/parser.js";
import { analyzeScopes } from "../../src/domain/language/scope.js";
import { preparePythonCs486Program } from "../../src/application/runtime/pythonCs486.js";
import { createNativeEnvironment } from "../../src/application/runtime/nativeModules.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";
import { TerminalBuffer } from "../../src/domain/terminal/terminalBuffer.js";

function prepare(source: string): void {
  const filesystem = new InMemoryFilesystem();
  const environment = createNativeEnvironment({
    computerId: 1,
    filesystem,
    terminal: new TerminalBuffer(),
  });
  preparePythonCs486Program({
    environment,
    filesystem: environment.filesystem,
    path: "/main.py",
    source,
  });
}

describe("Python generator syntax and scope", (): void => {
  it("parses bare and valued yield statements in function suites", (): void => {
    const module = parse(`
def generate(value):
    yield
    yield value, value + 1
`);
    const definition = module.body[0];
    expect(definition?.kind).toBe("FunctionDefinition");
    if (definition?.kind !== "FunctionDefinition") return;
    expect(definition.body.map(({ kind }) => kind)).toEqual([
      "YieldStatement",
      "YieldStatement",
    ]);
    const [bare, valued] = definition.body;
    expect(bare?.kind === "YieldStatement" && bare.value).toBeUndefined();
    expect(bare?.kind === "YieldStatement" && bare.delegate).toBe(false);
    expect(valued?.kind === "YieldStatement" && valued.value?.kind).toBe(
      "TupleExpression",
    );
    expect(valued?.kind === "YieldStatement" && valued.delegate).toBe(false);
  });

  it("collects yield values in the containing function scope", (): void => {
    const module = parse(`
outside = 1
def generate(seed):
    local = seed + outside
    yield local
`);
    const analysis = analyzeScopes(module);
    const definition = module.body[1];
    expect(definition?.kind).toBe("FunctionDefinition");
    if (definition?.kind !== "FunctionDefinition") return;
    const scope = analysis.functionScopes.get(definition);
    expect(scope?.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ binding: "local", name: "local" }),
        expect.objectContaining({ binding: "global", name: "outside" }),
      ]),
    );
  });

  it("parses yield expressions as assignment values and parenthesized operands", (): void => {
    const module = parse(`
def relay(seed):
    received = yield seed
    consume((yield received))
`);
    const definition = module.body[0];
    expect(definition?.kind).toBe("FunctionDefinition");
    if (definition?.kind !== "FunctionDefinition") return;

    const assignment = definition.body[0];
    expect(assignment?.kind).toBe("AssignmentStatement");
    if (assignment?.kind !== "AssignmentStatement") return;
    expect(assignment.value.kind).toBe("YieldExpression");
    if (assignment.value.kind !== "YieldExpression") return;
    expect(assignment.value.value).toMatchObject({
      kind: "IdentifierExpression",
      name: "seed",
    });

    const callStatement = definition.body[1];
    expect(callStatement?.kind).toBe("ExpressionStatement");
    if (
      callStatement?.kind !== "ExpressionStatement" ||
      callStatement.expression.kind !== "CallExpression"
    )
      return;
    expect(callStatement.expression.arguments[0]?.value).toMatchObject({
      kind: "YieldExpression",
      value: { kind: "IdentifierExpression", name: "received" },
    });

    const scope = analyzeScopes(module).functionScopes.get(definition);
    expect(scope?.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ binding: "local", name: "received" }),
        expect.objectContaining({ binding: "global", name: "consume" }),
      ]),
    );
  });

  it("parses yield-from statements and expressions in the containing scope", (): void => {
    const module = parse(`
def relay(values):
    yield from values
    result = (yield from fallback)
`);
    const definition = module.body[0];
    expect(definition?.kind).toBe("FunctionDefinition");
    if (definition?.kind !== "FunctionDefinition") return;
    const direct = definition.body[0];
    expect(direct).toMatchObject({
      delegate: true,
      kind: "YieldStatement",
      value: { kind: "IdentifierExpression", name: "values" },
    });
    const assignment = definition.body[1];
    expect(assignment?.kind).toBe("AssignmentStatement");
    if (assignment?.kind !== "AssignmentStatement") return;
    expect(assignment.value).toMatchObject({
      delegate: true,
      kind: "YieldExpression",
      value: { kind: "IdentifierExpression", name: "fallback" },
    });
    expect(
      analyzeScopes(module)
        .functionScopes.get(definition)
        ?.symbols.map(({ name }) => name),
    ).toEqual(expect.arrayContaining(["values", "fallback", "result"]));

    expect(() => parse("def generate():\n    yield from\n")).toThrow(
      /Expected expression after yield from/,
    );
  });

  it("accepts yield throughout try, except, else, and finally suites", (): void => {
    expect(() =>
      prepare(`
def generate(flag):
    try:
        received = yield "body"
        if flag:
            raise ValueError("handled")
    except ValueError:
        yield "except"
    else:
        yield received
    finally:
        yield "finally"
`),
    ).not.toThrow();
  });

  it.each([
    ["module", "yield 1\n"],
    ["module yield from", "yield from values\n"],
    ["class", "class Invalid:\n    yield 1\n"],
    ["class yield from", "class Invalid:\n    yield from values\n"],
    [
      "comprehension",
      "def invalid(values):\n    return [(yield value) for value in values]\n",
    ],
  ])("rejects yield in the invalid %s context", (_name, source): void => {
    expect(() => prepare(source)).toThrow(LanguageSyntaxError);
  });
});
