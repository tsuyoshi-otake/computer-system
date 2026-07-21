import { describe, expect, it } from "vitest";

import {
  fingerprintGuestMakeInput,
  fingerprintGuestMakeOutput,
  GUEST_MAKE_LIMITS,
  GUEST_MAKE_STATE_MARKER,
  GUEST_MAKE_TOOLCHAIN_ID,
  GuestMakeError,
  parseGuestMakeArguments,
  parseGuestMakefile,
  parseGuestMakeState,
  planGuestMakeBuild,
  serializeGuestMakeState,
} from "../../src/application/toolchain/guestMake.js";

function filesystem(entries: Readonly<Record<string, number>>): {
  exists(path: string): boolean;
  modifiedAt(path: string): number | undefined;
} {
  return {
    exists: (path): boolean => Object.hasOwn(entries, path),
    modifiedAt: (path): number | undefined => entries[path],
  };
}

describe("CS Make parser and planner", (): void => {
  it("parses bounded command-line options, overrides, and targets", (): void => {
    const parsed = parseGuestMakeArguments([
      "-nBs",
      "-C",
      "project",
      "-fBuildfile",
      "CC=c++",
      "all",
    ]);

    expect(parsed).toMatchObject({
      directory: "project",
      dryRun: true,
      force: true,
      makefile: "Buildfile",
      silent: true,
      targets: ["all"],
    });
    expect(parsed.variables.get("CC")).toBe("c++");
    expect(() => parseGuestMakeArguments(["-j4"])).toThrow(
      "unsupported option '-j'",
    );
  });

  it("expands variables and automatic variables in dependency order", (): void => {
    const source = [
      "CC ?= cc",
      "FLAGS = -O",
      "FLAGS += 2",
      "OUT := app.csx",
      ".PHONY: all clean",
      "all: $(OUT)",
      "\t@echo built $@ from $< and $^ $$HOME",
      "$(OUT): main.c util.o",
      "\t$(CC) $(FLAGS) -o $@ $^",
      "clean:",
      "\t$(RM) $(OUT)",
    ].join("\n");
    const variables = new Map([["CC", "c++"]]);
    const makefile = parseGuestMakefile(source, variables);
    const plan = planGuestMakeBuild(
      makefile,
      source,
      variables,
      filesystem({ "main.c": 2, "util.o": 2 }),
      ["all"],
    );

    expect(plan.targets.map(({ target }) => target)).toEqual([
      "app.csx",
      "all",
    ]);
    expect(plan.targets[0]?.recipes[0]?.command).toBe(
      "c++ -O 2 -o app.csx main.c util.o",
    );
    expect(plan.targets[1]?.recipes[0]).toEqual({
      command: "echo built all from app.csx and app.csx $HOME",
      silent: true,
    });
  });

  it("skips an up-to-date target and rebuilds a target with a newer prerequisite", (): void => {
    const source = "app.csx: main.c\n\tcc -o $@ $<";
    const makefile = parseGuestMakefile(source);

    expect(
      planGuestMakeBuild(
        makefile,
        source,
        new Map(),
        filesystem({ "app.csx": 5, "main.c": 4 }),
        [],
      ),
    ).toMatchObject({ targets: [], skippedTargets: ["app.csx"] });
    expect(
      planGuestMakeBuild(
        makefile,
        source,
        new Map(),
        filesystem({ "app.csx": 5, "main.c": 6 }),
        [],
      ).targets.map(({ target }) => target),
    ).toEqual(["app.csx"]);
  });

  it("plans pattern rules with includes, conditionals, dependency merging, and stems", (): void => {
    const source = [
      "MODE = debug",
      "ifeq ($(MODE),debug)",
      "CFLAGS = -O0",
      "else",
      "CFLAGS = -O1",
      "endif",
      "DEPS = main.d util.d",
      "-include $(DEPS)",
      "app: main.o util.o",
      "\tcc $^ -o $@",
      "%.o: %.c",
      "\tcc $(CFLAGS) -MMD -MF $*.d -c $< -o $@",
    ].join("\n");
    const included = new Map([
      ["main.d", "main.o: main.c common.h\n"],
      ["util.d", "util.o: util.c common.h\n"],
    ]);
    const makefile = parseGuestMakefile(source, new Map(), {
      include: ({ path }) => {
        const contents = included.get(path);
        return contents === undefined
          ? undefined
          : { identity: path, source: contents, sourceName: path };
      },
      sourceName: "Makefile",
    });
    const plan = planGuestMakeBuild(
      makefile,
      source,
      new Map(),
      filesystem({ "main.c": 2, "util.c": 2, "common.h": 2 }),
      ["app"],
    );

    expect(plan.targets.map(({ target }) => target)).toEqual([
      "main.o",
      "util.o",
      "app",
    ]);
    expect(plan.targets[0]).toMatchObject({
      prerequisites: ["main.c", "common.h"],
      recipes: [{ command: "cc -O0 -MMD -MF main.d -c main.c -o main.o" }],
    });
    expect(plan.targets[1]?.recipes[0]?.command).toContain("-MF util.d");
    expect(plan).toMatchObject({
      dependencyEdgesTraversed: 6,
      patternCandidatesExamined: 2,
    });
  });

  it("indexes and bounds pattern candidates at the documented rule limit", (): void => {
    const patterns = [
      ...Array.from(
        { length: GUEST_MAKE_LIMITS.rules - 1 },
        (_unused, index) => `p${String(index)}%.o: p${String(index)}%.c`,
      ),
      "%x.o: %x.c",
    ];
    const source = patterns.join("\n");
    const makefile = parseGuestMakefile(source);
    const plan = planGuestMakeBuild(
      makefile,
      source,
      new Map(),
      filesystem({ "filex.c": 1 }),
      ["filex.o"],
    );

    expect(plan.patternCandidatesExamined).toBe(GUEST_MAKE_LIMITS.rules);
    expect(makefile.patternIndex.get(".o")).toHaveLength(
      GUEST_MAKE_LIMITS.rules - 1,
    );
    expect(() => parseGuestMakefile(`${source}\nover%.o: over%.c\n`)).toThrow(
      /rule count exceeds/u,
    );
  });

  it("bounds and finalizes Makefile include and conditional errors", (): void => {
    expect(() =>
      parseGuestMakefile("include missing.mk\nall:\n\techo ok"),
    ).toThrow(/included Makefile not found/u);
    expect(() =>
      parseGuestMakefile("include self.mk\n", new Map(), {
        include: () => ({
          identity: "Makefile",
          source: "include self.mk\n",
          sourceName: "Makefile",
        }),
      }),
    ).toThrow(/circular Makefile include/u);
    expect(() => parseGuestMakefile("ifeq (a,a)\nall:\n\techo ok\n")).toThrow(
      /unterminated Make conditional/u,
    );
  });

  it("rejects cycles, missing prerequisites, unsupported recipe prefixes, and expansion cycles", (): void => {
    expect(() => {
      const source = "a: b\n\ttouch a\nb: a\n\ttouch b";
      planGuestMakeBuild(
        parseGuestMakefile(source),
        source,
        new Map(),
        filesystem({}),
        ["a"],
      );
    }).toThrow("dependency cycle: a -> b -> a");
    expect(() => {
      const source = "a: missing\n\ttouch a";
      planGuestMakeBuild(
        parseGuestMakefile(source),
        source,
        new Map(),
        filesystem({}),
        ["a"],
      );
    }).toThrow("no rule to make target 'missing'");
    expect(() => parseGuestMakefile("all:\n\t-rm missing")).toThrow(
      "recipe prefixes",
    );
    expect(() =>
      parseGuestMakefile("A=$(B)\nB=$(A)\nall:\n\techo $(A)"),
    ).not.toThrow();
    expect(() => {
      const source = "A=$(B)\nB=$(A)\nall:\n\techo $(A)";
      planGuestMakeBuild(
        parseGuestMakefile(source),
        source,
        new Map(),
        filesystem({}),
        [],
        true,
      );
    }).toThrow("recursive variable expansion");
  });

  it("enforces source, rule, edge, and graph depth limits", (): void => {
    expect(() =>
      parseGuestMakefile("x".repeat(GUEST_MAKE_LIMITS.sourceCharacters + 1)),
    ).toThrow(GuestMakeError);
    const tooManyEdges = `all: ${Array.from(
      { length: GUEST_MAKE_LIMITS.prerequisitesPerRule + 1 },
      (_, index) => `p${index}`,
    ).join(" ")}`;
    expect(() => parseGuestMakefile(tooManyEdges)).toThrow(
      "prerequisite count exceeds",
    );
    const tooManyPhonyTargets = `.PHONY: ${Array.from(
      { length: GUEST_MAKE_LIMITS.prerequisitesPerRule + 1 },
      (_, index) => `p${index}`,
    ).join(" ")}`;
    expect(() => parseGuestMakefile(tooManyPhonyTargets)).toThrow(
      "prerequisite count exceeds",
    );
    expect(() =>
      parseGuestMakeArguments([
        "x".repeat(GUEST_MAKE_LIMITS.pathCharacters + 1),
      ]),
    ).toThrow("requested target exceeds");
    const tooManyNodes = Array.from(
      { length: GUEST_MAKE_LIMITS.rules },
      (_, index) => (index === 0 ? "t0: p0 extra" : `t${index}: p${index}`),
    ).join("\n");
    expect(() => parseGuestMakefile(tooManyNodes)).toThrow(
      "dependency node count exceeds",
    );
    const deepSource = Array.from(
      { length: GUEST_MAKE_LIMITS.graphDepth + 1 },
      (_, index) => `t${index}: t${index + 1}\n\ttouch t${index}`,
    ).join("\n");
    expect(() => {
      planGuestMakeBuild(
        parseGuestMakefile(deepSource),
        deepSource,
        new Map(),
        filesystem({ [`t${GUEST_MAKE_LIMITS.graphDepth + 1}`]: 1 }),
        ["t0"],
      );
    }).toThrow("dependency graph exceeds depth");
  });
});

describe("CS Make state", (): void => {
  const record = {
    inputFingerprint: "1".repeat(64),
    outputFingerprint: "2".repeat(64),
  };

  it("round-trips CSMAKE2 records and treats legacy or foreign state as untrusted", (): void => {
    const serialized = serializeGuestMakeState(
      new Map([["/work/app", record]]),
    );
    expect(serialized.startsWith(GUEST_MAKE_STATE_MARKER)).toBe(true);
    expect(parseGuestMakeState(serialized).get("/work/app")).toEqual(record);
    expect(parseGuestMakeState('CSMAKE1\n{"app":"1234abcd"}\n').size).toBe(0);
    expect(
      parseGuestMakeState(
        GUEST_MAKE_STATE_MARKER +
          JSON.stringify({
            records: { "/work/app": record },
            toolchain: GUEST_MAKE_TOOLCHAIN_ID + "-foreign",
          }),
      ).size,
    ).toBe(0);
    expect(parseGuestMakeState("CSMAKE2-PENDING\n").size).toBe(0);
  });

  it("rejects malformed and capacity-plus-one state without partial acceptance", (): void => {
    expect(() => parseGuestMakeState("CSMAKE2\n{")).toThrow(
      "invalid .cs-make-state JSON",
    );
    expect(() =>
      serializeGuestMakeState(
        new Map(
          Array.from(
            { length: GUEST_MAKE_LIMITS.stateRecords + 1 },
            (_, index) => ["/t" + String(index), record] as const,
          ),
        ),
      ),
    ).toThrow("invalid .cs-make-state entry");
  });

  it("fingerprints toolchain inputs and target output with SHA-256", (): void => {
    const recipes = [{ command: "cc -c main.c -o main.o", silent: false }];
    const input = fingerprintGuestMakeInput(
      "/work/main.o",
      ["/work/main.c"],
      recipes,
      (path) => ({
        contents: path + ":v1",
        kind: "file",
      }),
    );
    const changedInput = fingerprintGuestMakeInput(
      "/work/main.o",
      ["/work/main.c"],
      recipes,
      (path) => ({
        contents: path + ":v2",
        kind: "file",
      }),
    );
    const output = fingerprintGuestMakeOutput({
      contents: "object-v1",
      kind: "file",
    });
    expect(input).toMatch(/^[0-9a-f]{64}$/u);
    expect(output).toMatch(/^[0-9a-f]{64}$/u);
    expect(changedInput).not.toBe(input);
    expect(
      fingerprintGuestMakeOutput({ contents: "object-v2", kind: "file" }),
    ).not.toBe(output);
    expect(fingerprintGuestMakeOutput({ kind: "missing" })).not.toBe(output);
  });
});
