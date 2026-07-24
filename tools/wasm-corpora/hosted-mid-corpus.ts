import { compileCs486Source } from "../../src/application/toolchain/highLevelCompilers.js";
import type { Cs486Executable } from "../../src/domain/cpu/cs486.js";

/**
 * Hosted mid-size benchmark corpus for the Issue #106 wasm batch-executor
 * A/B harness: a small C program built by the real guest C frontend and
 * linker, so the measured instruction stream carries the production call
 * ABI (push/call/ret frames), global-array addressing, and data-dependent
 * branches instead of a hand-shaped synthetic loop.
 *
 * The program fills a global array from a fixed-seed LCG, insertion-sorts
 * it, prints one checksum line, then keeps re-filling and re-sorting
 * forever; the benchmark instruction budget bounds execution. One print
 * keeps the cold-exit bridge on the measured path a bounded number of
 * times without turning the corpus into an output benchmark.
 *
 * The guest linker declares cs-flat32 metadata with a 256 KiB heap and a
 * 64 KiB stack, so the admitted linear space is about 320 KiB; a 64 KiB
 * RAM option fails admission. 512 KiB keeps the declared reservation
 * admitted on every CPU profile.
 */
export const cs486HostedMidCorpusMemoryBytes = 524_288;

const hostedMidSource = `
int values[64];

int lcg_next(int seed) {
  return seed * 1103515245 + 12345;
}

void fill(int seed) {
  int i;
  int s;
  s = seed;
  for (i = 0; i < 64; i += 1) {
    s = lcg_next(s);
    values[i] = (s >> 8) & 1023;
  }
}

void sort_values(void) {
  int i;
  int j;
  int key;
  for (i = 1; i < 64; i += 1) {
    key = values[i];
    j = i - 1;
    while (j >= 0 && values[j] > key) {
      values[j + 1] = values[j];
      j = j - 1;
    }
    values[j + 1] = key;
  }
}

int checksum(void) {
  int i;
  int sum;
  sum = 0;
  for (i = 0; i < 64; i += 1) {
    sum = sum ^ (values[i] + i);
  }
  return sum;
}

int main(void) {
  int round;
  round = 0;
  fill(20260724);
  sort_values();
  printf("%d\\n", checksum());
  while (1) {
    fill(round);
    sort_values();
    round = round + checksum();
  }
  return 0;
}
`;

let cachedExecutable: Cs486Executable | undefined;

/** Compiles and links the corpus once and reuses the deterministic result. */
export function cs486HostedMidCorpusExecutable(): Cs486Executable {
  cachedExecutable ??= compileCs486Source("c", hostedMidSource);
  return cachedExecutable;
}
