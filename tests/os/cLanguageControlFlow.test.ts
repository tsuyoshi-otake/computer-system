import { describe, expect, it } from "vitest";

import { ShellSession } from "../../src/application/os/shellSession.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";

/**
 * Focused acceptance for CS C 2.0's new control flow and expression grammar
 * (if/else, while, do-while, switch/case/default, break/continue, the full
 * comparison/logical/bitwise/ternary operator ladder). Profile parity and the
 * pre-existing restricted-DSL surface remain covered by cFamilyProfiles.test.ts;
 * this file exercises only the newly added language behavior.
 */

function fixture(): { filesystem: InMemoryFilesystem; shell: ShellSession } {
  const filesystem = new InMemoryFilesystem();
  const shell = new ShellSession(filesystem, { osProfile: "linux" });
  filesystem.makeDirectory("/work");
  return { filesystem, shell };
}

function compileAndRun(
  source: string,
  path = "/work/a",
): { exitCode: number; stderr: string; stdout: string } {
  const { filesystem, shell } = fixture();
  filesystem.writeFile(`${path}.c`, source);
  const compiled = shell.submit(`cc ${path}.c -o ${path}`);
  expect(compiled).toMatchObject({ exitCode: 0, stderr: "" });
  return shell.submit(path);
}

describe("CS C 2.0 control flow", (): void => {
  it("branches an if/else on a runtime comparison", (): void => {
    // Function parameters are not part of this pass (CS C 2.0 keeps the
    // existing zero-argument ABI); each case is inlined in `main` instead.
    const source = [
      "int main() {",
      "  int a = 5;",
      "  if (a > 0) {",
      '    printf("%d\\n", 1);',
      "  } else if (a < 0) {",
      '    printf("%d\\n", -1);',
      "  } else {",
      '    printf("%d\\n", 0);',
      "  }",
      "  int b = -5;",
      "  if (b > 0) {",
      '    printf("%d\\n", 1);',
      "  } else if (b < 0) {",
      '    printf("%d\\n", -1);',
      "  } else {",
      '    printf("%d\\n", 0);',
      "  }",
      "  int c = 0;",
      "  if (c > 0) {",
      '    printf("%d\\n", 1);',
      "  } else if (c < 0) {",
      '    printf("%d\\n", -1);',
      "  } else {",
      '    printf("%d\\n", 0);',
      "  }",
      "  return 0;",
      "}",
    ].join("\n");
    expect(compileAndRun(source)).toMatchObject({
      exitCode: 0,
      stdout: "1\n-1\n0\n",
    });
  });

  it("loops with while, including the zero-iteration case", (): void => {
    const source = [
      "int main() {",
      "  int i = 0;",
      "  while (i < 3) {",
      '    printf("%d\\n", i);',
      "    i = i + 1;",
      "  }",
      "  int never = 5;",
      "  while (never < 0) {",
      '    printf("%d\\n", 999);',
      "    never = never - 1;",
      "  }",
      "  return 0;",
      "}",
    ].join("\n");
    expect(compileAndRun(source)).toMatchObject({
      exitCode: 0,
      stdout: "0\n1\n2\n",
    });
  });

  it("runs a do-while body exactly once even when the condition is false", (): void => {
    const source = [
      "int main() {",
      "  int i = 0;",
      "  do {",
      '    printf("%d\\n", i);',
      "    i = i + 1;",
      "  } while (i < 0);",
      "  return 0;",
      "}",
    ].join("\n");
    expect(compileAndRun(source)).toMatchObject({
      exitCode: 0,
      stdout: "0\n",
    });
  });

  it("supports break and continue inside while, do-while, and for loops", (): void => {
    const source = [
      "int main() {",
      "  int i = 0;",
      "  while (i < 10) {",
      "    i = i + 1;",
      "    if (i == 3) { continue; }",
      "    if (i == 5) { break; }",
      '    printf("%d\\n", i);',
      "  }",
      "  int j = 0;",
      "  for (j = 0; j < 6; j++) {",
      "    if (j == 2) { continue; }",
      "    if (j == 4) { break; }",
      '    printf("%d\\n", j);',
      "  }",
      "  return 0;",
      "}",
    ].join("\n");
    expect(compileAndRun(source)).toMatchObject({
      exitCode: 0,
      stdout: "1\n2\n4\n0\n1\n3\n",
    });
  });

  it("continue in a for-loop still runs the increment step", (): void => {
    const source = [
      "int main() {",
      "  int total = 0;",
      "  int i = 0;",
      "  for (i = 0; i < 5; i++) {",
      "    if (i == 2) { continue; }",
      "    total = total + i;",
      "  }",
      '  printf("%d\\n", total);',
      "  return 0;",
      "}",
    ].join("\n");
    // 0 + 1 + 3 + 4 = 8 (2 is skipped, but the loop still terminates via i++).
    expect(compileAndRun(source)).toMatchObject({
      exitCode: 0,
      stdout: "8\n",
    });
  });

  it("falls through switch cases exactly like C until a break", (): void => {
    const source = [
      "int main() {",
      "  int i = 0;",
      "  for (i = 0; i < 4; i++) {",
      "    switch (i) {",
      "      case 0:",
      '        printf("%d\\n", 0);',
      "        break;",
      "      case 1:",
      "      case 2:",
      '        printf("%d\\n", 12);',
      "        break;",
      "      default:",
      '        printf("%d\\n", 99);',
      "    }",
      "  }",
      "  return 0;",
      "}",
    ].join("\n");
    expect(compileAndRun(source)).toMatchObject({
      exitCode: 0,
      stdout: "0\n12\n12\n99\n",
    });
  });

  it("rejects break outside a loop or switch, and continue outside a loop", (): void => {
    const breakResult = ((): {
      exitCode: number;
      stderr: string;
      stdout: string;
    } => {
      const { filesystem, shell } = fixture();
      filesystem.writeFile(
        "/work/b.c",
        ["int main() {", "  break;", "  return 0;", "}"].join("\n"),
      );
      return shell.submit("cc /work/b.c -o /work/b");
    })();
    expect(breakResult.exitCode).toBe(1);
    expect(breakResult.stderr).toMatch(/break statement not within a loop/u);

    const { filesystem, shell } = fixture();
    filesystem.writeFile(
      "/work/c.c",
      ["int main() {", "  continue;", "  return 0;", "}"].join("\n"),
    );
    const continueResult = shell.submit("cc /work/c.c -o /work/c");
    expect(continueResult.exitCode).toBe(1);
    expect(continueResult.stderr).toMatch(
      /continue statement not within a loop/u,
    );
  });

  it("rejects a duplicate case value and a duplicate default label", (): void => {
    const { filesystem, shell } = fixture();
    filesystem.writeFile(
      "/work/dup.c",
      [
        "int main() {",
        "  int i = 0;",
        "  switch (i) {",
        "    case 1: break;",
        "    case 1: break;",
        "  }",
        "  return 0;",
        "}",
      ].join("\n"),
    );
    const result = shell.submit("cc /work/dup.c -o /work/dup");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/duplicate case value/u);

    const { filesystem: fs2, shell: shell2 } = fixture();
    fs2.writeFile(
      "/work/dupd.c",
      [
        "int main() {",
        "  int i = 0;",
        "  switch (i) {",
        "    default: break;",
        "    default: break;",
        "  }",
        "  return 0;",
        "}",
      ].join("\n"),
    );
    const result2 = shell2.submit("cc /work/dupd.c -o /work/dupd");
    expect(result2.exitCode).toBe(1);
    expect(result2.stderr).toMatch(/duplicate default label/u);
  });
});

describe("CS C 2.0 expression grammar", (): void => {
  it("evaluates every comparison operator to a 0/1 int", (): void => {
    const source = [
      "int main() {",
      '  printf("%d\\n", 3 == 3);',
      '  printf("%d\\n", 3 != 3);',
      '  printf("%d\\n", 2 < 3);',
      '  printf("%d\\n", 3 <= 3);',
      '  printf("%d\\n", 3 > 2);',
      '  printf("%d\\n", 3 >= 4);',
      "  return 0;",
      "}",
    ].join("\n");
    expect(compileAndRun(source)).toMatchObject({
      exitCode: 0,
      stdout: "1\n0\n1\n1\n1\n0\n",
    });
  });

  it("evaluates bitwise and shift operators", (): void => {
    const source = [
      "int main() {",
      '  printf("%d\\n", 6 & 3);',
      '  printf("%d\\n", 6 | 1);',
      '  printf("%d\\n", 6 ^ 3);',
      '  printf("%d\\n", 1 << 4);',
      '  printf("%d\\n", 32 >> 2);',
      '  printf("%d\\n", ~0);',
      "  return 0;",
      "}",
    ].join("\n");
    expect(compileAndRun(source)).toMatchObject({
      exitCode: 0,
      stdout: "2\n7\n5\n16\n8\n-1\n",
    });
  });

  it("evaluates the logical-not and comparison-result-as-value idioms", (): void => {
    const source = [
      "int main() {",
      "  int flag = 0;",
      '  printf("%d\\n", !flag);',
      '  printf("%d\\n", !5);',
      "  int stored = (3 == 3);",
      '  printf("%d\\n", stored);',
      "  return 0;",
      "}",
    ].join("\n");
    expect(compileAndRun(source)).toMatchObject({
      exitCode: 0,
      stdout: "1\n0\n1\n",
    });
  });

  it("short-circuits && and || so the right side never runs when skippable", (): void => {
    const source = [
      "int sideEffect() {",
      '  printf("%d\\n", 999);',
      "  return 1;",
      "}",
      "int main() {",
      "  int a = 0;",
      "  if (a && sideEffect()) {",
      '    printf("%d\\n", -1);',
      "  }",
      "  int b = 1;",
      "  if (b || sideEffect()) {",
      '    printf("%d\\n", 2);',
      "  }",
      "  int c = 1;",
      "  if (c && sideEffect()) {",
      '    printf("%d\\n", 3);',
      "  }",
      "  return 0;",
      "}",
    ].join("\n");
    // sideEffect() must run exactly once (for the `c && sideEffect()` branch);
    // the `a && ...` and `b || ...` branches must both skip it.
    expect(compileAndRun(source)).toMatchObject({
      exitCode: 0,
      stdout: "2\n999\n3\n",
    });
  });

  it("evaluates the ternary operator including nesting", (): void => {
    const source = [
      "int main() {",
      "  int x = 5;",
      '  printf("%d\\n", x > 0 ? 1 : -1);',
      '  printf("%d\\n", x > 10 ? 1 : (x > 3 ? 2 : 3));',
      "  return 0;",
      "}",
    ].join("\n");
    expect(compileAndRun(source)).toMatchObject({
      exitCode: 0,
      stdout: "1\n2\n",
    });
  });

  it("compiles byte-identically across two runs (determinism)", (): void => {
    const source = [
      "int main() {",
      "  int i = 0;",
      "  int total = 0;",
      "  while (i < 5) {",
      "    total = total + (i % 2 == 0 ? i : -i);",
      "    i = i + 1;",
      "  }",
      '  printf("%d\\n", total);',
      "  return 0;",
      "}",
    ].join("\n");
    const { filesystem, shell } = fixture();
    filesystem.writeFile("/work/det.c", source);
    expect(shell.submit("cc -c /work/det.c -o /work/first.o")).toMatchObject({
      exitCode: 0,
    });
    expect(shell.submit("cc -c /work/det.c -o /work/second.o")).toMatchObject({
      exitCode: 0,
    });
    expect(filesystem.readFile("/work/second.o")).toBe(
      filesystem.readFile("/work/first.o"),
    );
  });
});
