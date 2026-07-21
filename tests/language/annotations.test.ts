import { describe, expect, it } from "vitest";

import type { FunctionDefinition } from "../../src/domain/language/ast.js";
import { parse } from "../../src/domain/language/parser.js";
import { analyzeScopes } from "../../src/domain/language/scope.js";

describe("Computer System Python 3.14 annotation syntax and scopes", (): void => {
  it("parses annotated assignments and deferred function annotations", (): void => {
    const module = parse(`
x: Later
y: Later = 1
items[0]: Later
def sample(a: A, /, *args: B, c: C = 1, **kwargs: D) -> Result:
    local: Ignored
    return c
`);

    expect(module.body.slice(0, 3)).toMatchObject([
      {
        kind: "AnnotatedAssignmentStatement",
        simpleTarget: true,
        target: { kind: "IdentifierExpression", name: "x" },
        value: undefined,
      },
      {
        kind: "AnnotatedAssignmentStatement",
        simpleTarget: true,
        target: { kind: "IdentifierExpression", name: "y" },
        value: { kind: "LiteralExpression", value: 1 },
      },
      {
        kind: "AnnotatedAssignmentStatement",
        simpleTarget: false,
        target: { kind: "SubscriptExpression" },
      },
    ]);
    const sample = module.body[3] as FunctionDefinition;
    expect(sample).toMatchObject({
      kind: "FunctionDefinition",
      parameters: [
        { annotation: { kind: "IdentifierExpression", name: "A" } },
        { annotation: { kind: "IdentifierExpression", name: "B" } },
        { annotation: { kind: "IdentifierExpression", name: "C" } },
        { annotation: { kind: "IdentifierExpression", name: "D" } },
      ],
      returnAnnotation: { kind: "IdentifierExpression", name: "Result" },
    });
    expect(sample.body[0]).toMatchObject({
      kind: "AnnotatedAssignmentStatement",
      target: { kind: "IdentifierExpression", name: "local" },
    });
  });

  it("keeps annotation scopes separate and grants class-namespace access", (): void => {
    const module = parse(`
module_value: ModuleType
def build():
    Local = 41
    def nested(value: Local) -> Local:
        local_only: NeverEvaluated
        return value
    return nested
class Sample:
    ClassType = 42
    field: ClassType
    def method(self, value: ClassType):
        return value
`);
    const analysis = analyzeScopes(module);
    const build = module.body[1] as FunctionDefinition;
    const nested = build.body[1] as FunctionDefinition;
    const sample = module.body[2];
    if (sample?.kind !== "ClassDefinition") throw new Error("missing class");
    const method = sample.body[2] as FunctionDefinition;

    expect(
      analysis.annotationScopes
        .get(nested)
        ?.symbols.find(({ name }) => name === "Local"),
    ).toMatchObject({ binding: "free", referenced: true });
    expect(
      analysis.functionScopes
        .get(build)
        ?.symbols.find(({ name }) => name === "Local"),
    ).toMatchObject({ binding: "cell" });
    expect(
      analysis.annotationScopes
        .get(sample)
        ?.symbols.find(({ name }) => name === "ClassType"),
    ).toMatchObject({ binding: "local" });
    expect(
      analysis.annotationScopes
        .get(method)
        ?.symbols.find(({ name }) => name === "ClassType"),
    ).toMatchObject({ binding: "local" });
    expect(
      analysis.functionScopes
        .get(nested)
        ?.symbols.find(({ name }) => name === "NeverEvaluated"),
    ).toBeUndefined();
  });

  it("rejects invalid targets and annotation-scope-only expressions", (): void => {
    expect(() => parse("left, right: Type\n")).toThrow(
      /Invalid annotated assignment target/u,
    );
    expect(() => parse("value: (captured := Type)\n")).toThrow(
      /Annotation expressions cannot contain/u,
    );
    expect(() => parse("value: (yield Type)\n")).toThrow(
      /Annotation expressions cannot contain/u,
    );
    expect(() => parse("value: (lambda: (captured := Type))\n")).not.toThrow();
  });

  it("counts annotation scopes against the exact shared scope ceiling", (): void => {
    const module = parse("value: Type\n");
    expect(() => analyzeScopes(module, { maxScopes: 2 })).not.toThrow();
    expect(() => analyzeScopes(module, { maxScopes: 1 })).toThrow(
      /Scope count limit exceeded/u,
    );
  });
});
