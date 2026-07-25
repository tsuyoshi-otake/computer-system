import { assembleCs486 } from "../../src/application/toolchain/cs486Assembler.js";
import type { Cs486Executable } from "../../src/domain/cpu/cs486.js";

/**
 * Memory/stack benchmark corpus for the Issue #106 CS486 throughput
 * harness. It deliberately lives on the paths the issue-16 evidence marked as
 * un-accelerated by the TS hot burst: push/pop, call/ret, and strided
 * load/store traffic.
 *
 * The strided walk touches six 32-bit words 2048 bytes apart. On CS486DX/DX2
 * the L1 cache maps addresses to the same set every 128 sets x 16-byte lines
 * = 2048 bytes, so six conflicting lines overwhelm the 4-way set and force
 * LRU evictions on every pass. The odd 8-bit and even 16-bit accesses keep
 * the CS386SX two-versus-three bus-transfer penalty on the measured path. On
 * CS386SX (no cache) the walk degrades to plain main-memory traffic, which
 * is the intended profile difference, not a corpus error.
 *
 * The assembler declares cs-flat32 metadata with the default 64 KiB stack,
 * so the admitted linear space is aligned data (~4.1 KiB at address 18436)
 * plus that stack; a 64 KiB RAM option fails admission. 128 KiB keeps the
 * declared reservation admitted on every CPU profile.
 */
export const cs486MemStackCorpusMemoryBytes = 131_072;

const memStackSource = `
        mov edi, 0
main_loop:
        call touch_lines
        load8u ebx, [4097]
        add ebx, edi
        store8 [4097], ebx
        load16u edx, [4098]
        add edx, 1
        store16 [4098], edx
        add edi, 1
        jmp main_loop

touch_lines:
        push edi
        push esi
        mov esi, 8192
        mov ecx, 6
line_loop:
        load eax, [esi]
        add eax, edi
        store [esi], eax
        add esi, 2048
        sub ecx, 1
        cmp ecx, 0
        jg line_loop
        pop esi
        pop edi
        ret
`;

let cachedExecutable: Cs486Executable | undefined;

/** Assembles the corpus once and reuses the deterministic executable. */
export function cs486MemStackCorpusExecutable(): Cs486Executable {
  cachedExecutable ??= assembleCs486(memStackSource);
  return cachedExecutable;
}
