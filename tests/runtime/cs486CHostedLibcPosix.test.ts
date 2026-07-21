import { beforeAll, describe, expect, it } from "vitest";

import { unrestrictedGuestFilesystem } from "../../src/application/os/guestFilesystem.js";
import { initialUserCredentials } from "../../src/application/os/linuxCredentials.js";
import { linuxFilesystemImage } from "../../src/application/os/osFilesystemImages.js";
import {
  CsAbiRuntime,
  prepareCsAbiStartup,
} from "../../src/application/runtime/csAbi.js";
import { compileCs486Object } from "../../src/application/toolchain/highLevelCompilers.js";
import { linkCs486Objects } from "../../src/application/toolchain/cs486Linker.js";
import {
  Cs486Process,
  cs486ExecutableMemoryRequirements,
  type Cs486Executable,
} from "../../src/domain/cpu/cs486.js";
import type { Cs486Object } from "../../src/domain/cpu/cs486Object.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";
import { TerminalBuffer } from "../../src/domain/terminal/terminalBuffer.js";

describe("CS-Linux hosted libc/POSIX profile", (): void => {
  const imageFiles = new Map<string, string>();
  let libc: Cs486Object;
  let curses: Cs486Object;

  beforeAll((): void => {
    for (const file of linuxFilesystemImage.files) {
      imageFiles.set(file.path, file.contents);
    }
    libc = compileImageSource("/usr/src/cs-libc/libc.c");
    curses = compileImageSource("/usr/src/libcs-curses/curses.c");
  });

  it("compiles the guest libc and curses sources deterministically", (): void => {
    expect(compileImageSource("/usr/src/cs-libc/libc.c")).toEqual(libc);
    expect(compileImageSource("/usr/src/libcs-curses/curses.c")).toEqual(
      curses,
    );
  });

  it("runs argv/environment parsing, callbacks, conversions, div, and atexit", (): void => {
    const application = compileApplication(
      "/tmp/text-filter.c",
      [
        "#include <errno.h>",
        "#include <getopt.h>",
        "#include <signal.h>",
        "#include <stdio.h>",
        "#include <stdlib.h>",
        "#include <string.h>",
        "int compare(void *left, void *right){return *(int *)left - *(int *)right;}",
        "int signal_count = 0; void on_signal(int value){signal_count = signal_count + value;}",
        'void cleanup(void){fputs("atexit\\n", stdout);}',
        "int main(int argc, char **argv){",
        "  if(atexit(cleanup) != 0) return 10;",
        "  if(signal(SIGINT, on_signal) != SIG_DFL || raise(SIGINT) != 0 || signal_count != SIGINT) return 17;",
        '  char *home = getenv("HOME"); if(home == (char *)0 || strcmp(home, "/home/cs") != 0) return 11;',
        '  int option = getopt(argc, argv, "n:"); if(option != 110 || optarg == (char *)0) return 12;',
        "  char *end = (char *)0; unsigned long parsed = strtoul(optarg, &end, 10);",
        "  if(parsed != 42U || *end != 0 || errno != 0) return 13;",
        "  int values[5] = {5, 1, 4, 2, 3}; qsort(values, 5, 1, compare);",
        "  int key = 4; int *found = (int *)bsearch(&key, values, 5, 1, compare);",
        "  if(found == (int *)0 || *found != 4 || values[0] != 1 || values[4] != 5) return 14;",
        "  div_t result; if(div(9, 4, &result) != 0 || result.quot != 2 || result.rem != 1) return 15;",
        '  char formatted[32]; if(snprintf(formatted, 32, "%08d|%-5s|%.3s|%4c", -42, "xy", "abcdef", 65) != 23) return 18;',
        '  if(strcmp(formatted, "-0000042|xy   |abc|   A") != 0) return 19;',
        '  if(printf("value=%d\\n", (int)parsed) != 9) return 16;',
        "  return 0;",
        "}",
      ].join("\n"),
    );
    const executable = linkCs486Objects([application, libc], { entry: "main" });
    const run = runHosted(executable, ["/tmp/text-filter", "-n", "42"]);

    expect(run.state).toEqual({ kind: "completed", value: 0 });
    expect(terminalText(run.terminal)).toContain("value=42");
    expect(terminalText(run.terminal)).toContain("atexit");
  });

  it("walks one directory snapshot and uses cwd/stat/temp-file wrappers", (): void => {
    const application = compileApplication(
      "/tmp/inventory.c",
      [
        "#include <dirent.h>",
        "#include <stdio.h>",
        "#include <string.h>",
        "#include <sys/stat.h>",
        "#include <unistd.h>",
        'char path[256]; char cwd[256]; char pattern[256] = "/tree/tmpXXXXXX";',
        "int main(void){",
        '  DIR *directory = opendir("/tree"); if(directory == (DIR *)0) return 20;',
        "  int files = 0; struct dirent *entry; struct stat status;",
        "  entry = readdir(directory); while(entry != (struct dirent *)0){",
        '    if(snprintf(path, 256, "/tree/%s", entry->d_name) < 0) return 21;',
        "    if(stat(path, &status) != 0) return 22; if(status.st_kind == S_IFREG) files = files + 1;",
        "    entry = readdir(directory);",
        "  }",
        "  if(closedir(directory) != 0 || files != 2) return 23;",
        '  if(chdir("/tree") != 0) return 24; if(getcwd(cwd, 256) == (char *)0 || strcmp(cwd, "/tree") != 0) return 25;',
        '  if(mkdir("scratch", 448) != 0 || access("scratch", X_OK) != 0) return 26;',
        "  int descriptor = mkstemp(pattern); if(descriptor < 0) return 27;",
        "  if(pattern[9] == 88) return 28;",
        '  if(unlink(pattern) != 0 || rmdir("scratch") != 0) return 29;',
        "  return 0;",
        "}",
      ].join("\n"),
    );
    const executable = linkCs486Objects([application, libc], { entry: "main" });
    const filesystem = unrestrictedGuestFilesystem(new InMemoryFilesystem());
    filesystem.makeDirectory("/tree");
    filesystem.writeFile("/tree/alpha", "a");
    filesystem.writeFile("/tree/beta", "bb");
    const run = runHosted(executable, ["/tmp/inventory"], filesystem);

    expect(run.state).toEqual({ kind: "completed", value: 0 });
    expect(filesystem.exists("/tree/scratch")).toBe(false);
    expect(filesystem.list("/tree")).toEqual(["alpha", "beta"]);
  });

  it("renders one bounded curses frame with callback-sorted data and key input", (): void => {
    const application = compileApplication(
      "/tmp/curses-demo.c",
      [
        "#include <curses.h>",
        "#include <errno.h>",
        "#include <stdlib.h>",
        "int compare(void *left, void *right){return *(int *)left - *(int *)right;}",
        "int main(void){",
        "  int values[3] = {3, 1, 2}; qsort(values, 3, 1, compare);",
        "  if(initscr() == (WINDOW *)0 || start_color() != OK) return 30;",
        "  if(init_pair(1, COLOR_GREEN, COLOR_BLACK) != OK || attron(COLOR_PAIR(1)) != OK) return 31;",
        '  if(mvprintw(0, 0, "sorted=%d%d%d", values[0], values[1], values[2]) < 0) return 32;',
        '  WINDOW *window = newwin(2, 12, 2, 0); if(window == (WINDOW *)0 || waddstr(window, "callback") != OK) return 33;',
        "  WINDOW *w2 = newwin(1, 1, 4, 0); WINDOW *w3 = newwin(1, 1, 5, 0); WINDOW *w4 = newwin(1, 1, 6, 0);",
        "  WINDOW *w5 = newwin(1, 1, 7, 0); WINDOW *w6 = newwin(1, 1, 8, 0); WINDOW *w7 = newwin(1, 1, 9, 0);",
        "  if(w2 == (WINDOW *)0 || w3 == (WINDOW *)0 || w4 == (WINDOW *)0 || w5 == (WINDOW *)0 || w6 == (WINDOW *)0 || w7 == (WINDOW *)0) return 37;",
        "  errno = 0; if(newwin(1, 1, 10, 0) != (WINDOW *)0 || errno != ENOMEM) return 38;",
        "  if(wrefresh(window) != OK || delwin(window) != OK || refresh() != OK) return 34;",
        "  int key = getch(); if(endwin() != OK) return 35; return key == 113 ? 0 : 36;",
        "}",
      ].join("\n"),
    );
    const executable = linkCs486Objects([application, curses, libc], {
      entry: "main",
    });
    const run = runHosted(
      executable,
      ["/tmp/curses-demo"],
      undefined,
      '[["q"]]',
    );

    expect(run.state).toEqual({ kind: "completed", value: 0 });
    expect(terminalText(run.terminal)).toContain("sorted=123");
    expect(terminalText(run.terminal)).toContain("callback");
  });

  function compileImageSource(path: string): Cs486Object {
    return compileCs486Object("c", imageFiles.get(path)!, {
      include,
      sourceName: path,
    });
  }

  function compileApplication(path: string, source: string): Cs486Object {
    return compileCs486Object("c", source, { include, sourceName: path });
  }

  function include(request: {
    readonly path: string;
  }): { readonly source: string; readonly sourceName: string } | undefined {
    const sourceName = `/usr/include/${request.path}`;
    const source = imageFiles.get(sourceName);
    return source === undefined ? undefined : { source, sourceName };
  }
});

function runHosted(
  executable: Cs486Executable,
  argv: readonly string[],
  filesystem = unrestrictedGuestFilesystem(new InMemoryFilesystem()),
  encodedKeys?: string,
): {
  readonly state: ReturnType<Cs486Process["runCpuSlice"]>["state"];
  readonly terminal: TerminalBuffer;
} {
  const startup = prepareCsAbiStartup(
    executable,
    {
      argv,
      cwd: "/",
      environment: [["HOME", "/home/cs"]],
    },
    initialUserCredentials,
  );
  const requirements = cs486ExecutableMemoryRequirements(executable);
  if (requirements.kind !== "declared")
    throw new Error("declared memory required");
  const terminal = new TerminalBuffer(80, 25);
  const runtime = new CsAbiRuntime({
    computerId: "posix-test",
    credentials: initialUserCredentials,
    currentTick: (): number => 123,
    currentWallTimeMilliseconds: (): number => Date.UTC(2026, 6, 20),
    cwd: "/",
    filesystem,
    heapBaseBytes: startup.heapBaseBytes,
    heapWords: startup.heapWords,
    runHostWork: (_lane, _units, action): boolean => {
      action();
      return true;
    },
    startupAddress: startup.startupAddress,
    terminal,
  });
  if (encodedKeys !== undefined) {
    for (const batch of JSON.parse(encodedKeys) as string[][]) {
      runtime.enqueueKeyBatch(JSON.stringify(batch));
    }
  }
  const process = new Cs486Process(executable, {
    memoryBytes: requirements.linearAddressSpaceBytes,
    syscallHandler: runtime.syscallHandler,
  });
  process.initializeProcessImage(startup.image);
  const state = process.runCpuSlice(200_000_000, 2_000_000).state;
  runtime.finalize();
  return { state, terminal };
}

function terminalText(terminal: TerminalBuffer): string {
  return Array.from({ length: terminal.height }, (_, row) =>
    terminal.line(row + 1),
  ).join("\n");
}
