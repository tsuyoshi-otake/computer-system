import { describe, expect, it } from "vitest";
import {
  parseBenchmarkArguments,
  summarize,
} from "../../tools/benchmark-cs486-interpreter.mjs";

describe("CS486 interpreter host-throughput benchmark", () => {
  it("parses bounded reproducible sample options", () => {
    expect(
      parseBenchmarkArguments(["--instructions", "250000", "--samples", "5"]),
    ).toEqual({ instructionCount: 250_000, samples: 5 });
    expect(() => parseBenchmarkArguments(["--instructions", "9999"])).toThrow(
      /between 10000 and 50000000/u,
    );
    expect(() => parseBenchmarkArguments(["--samples", "32"])).toThrow(
      /between 3 and 31/u,
    );
    expect(() => parseBenchmarkArguments(["--unknown"])).toThrow(
      /Unknown benchmark argument/u,
    );
  });

  it("reports deterministic nearest-rank median and p95 summaries", () => {
    expect(summarize([90, 10, 50, 20, 30])).toEqual({ median: 30, p95: 90 });
  });
});
