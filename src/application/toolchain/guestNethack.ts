import type { Cs486Executable } from "../../domain/cpu/cs486.js";
import type { FilesystemBaseImageFile } from "../../domain/filesystem/inMemoryFilesystem.js";
import { hostedCLibcFiles } from "../os/hostedCLibcImage.js";
import type { Cs486CFrontendOptions } from "./cs486CFrontend.js";
import type {
  Cs486CPreprocessorInclude,
  Cs486CPreprocessorIncludeRequest,
} from "./cs486CPreprocessor.js";
import { compileCs486Object } from "./highLevelCompilers.js";
import { linkCs486Objects } from "./cs486Linker.js";

const moduleNames = Object.freeze([
  "main",
  "world",
  "monsters",
  "items",
  "player",
  "display",
  "input",
  "save",
  "rng",
]);

export const guestNethackSourceFiles: ReadonlyMap<string, string> = new Map([
  ["nethack.h", nethackHeader()],
  ["main.c", mainSource()],
  ["world.c", worldSource()],
  ["monsters.c", monstersSource()],
  ["items.c", itemsSource()],
  ["player.c", playerSource()],
  ["display.c", displaySource()],
  ["input.c", inputSource()],
  ["save.c", saveSource()],
  ["rng.c", rngSource()],
  ["Makefile", makefileSource()],
]);

export function buildGuestNethackExecutable(): Cs486Executable {
  const includes = new Map<string, string>();
  for (const file of hostedCLibcFiles) {
    if (file.path.startsWith("/usr/include/"))
      includes.set(file.path.slice("/usr/include/".length), file.contents);
  }
  includes.set("nethack.h", guestNethackSourceFiles.get("nethack.h")!);
  const options = (sourceName: string): Cs486CFrontendOptions => ({
    include: (
      request: Cs486CPreprocessorIncludeRequest,
    ): Cs486CPreprocessorInclude | undefined => {
      const source = includes.get(request.path);
      return source === undefined
        ? undefined
        : {
            source,
            sourceName:
              request.path === "nethack.h"
                ? "/usr/src/nethack/nethack.h"
                : `/usr/include/${request.path}`,
          };
    },
    sourceName,
  });
  const objects = moduleNames.map((name) =>
    compileCs486Object(
      "c",
      guestNethackSourceFiles.get(`${name}.c`)!,
      options(`/usr/src/nethack/${name}.c`),
    ),
  );
  const libcSource = hostedCLibcFiles.find(
    ({ path }) => path === "/usr/src/cs-libc/libc.c",
  )?.contents;
  if (libcSource === undefined)
    throw new Error("CS libc source is unavailable");
  objects.push(
    compileCs486Object("c", libcSource, options("/usr/src/cs-libc/libc.c")),
  );
  return linkCs486Objects(objects, { entry: "main" });
}

export function guestNethackImageFiles(): readonly FilesystemBaseImageFile[] {
  const metadata = Object.freeze({ gid: 0, mode: 0o644, uid: 0 });
  const files: FilesystemBaseImageFile[] = [...guestNethackSourceFiles].map(
    ([name, contents]) =>
      Object.freeze({
        contents,
        metadata,
        path: `/usr/src/nethack/${name}`,
      }),
  );
  const executable = buildGuestNethackExecutable();
  files.push(
    Object.freeze({
      contents: `CS486\n${JSON.stringify(executable)}`,
      metadata: Object.freeze({ gid: 0, mode: 0o755, uid: 0 }),
      path: "/usr/games/nethack",
    }),
  );
  return Object.freeze(files);
}

function lines(values: readonly string[]): string {
  return `${values.join("\n")}\n`;
}

function nethackHeader(): string {
  return lines([
    "#ifndef CS_NETHACK_H",
    "#define CS_NETHACK_H 1",
    "#include <stdlib.h>",
    "#include <string.h>",
    "#include <stdio.h>",
    "#include <errno.h>",
    "#include <cs/term.h>",
    "#include <cs/fs.h>",
    "#define NH_WIDTH 78",
    "#define NH_HEIGHT 21",
    "#define NH_CELLS 1638",
    "#define NH_LEVELS 10",
    "#define NH_MONSTERS 32",
    "#define NH_ITEMS 64",
    "extern int nh_map[1638];",
    "extern int nh_explored[1638];",
    "extern int nh_frame[1638];",
    "extern int nh_level_seed[10];",
    "extern int nh_level_visited[10];",
    "extern int nh_depth;",
    "extern int nh_turn;",
    "extern int nh_player_x;",
    "extern int nh_player_y;",
    "extern int nh_player_hp;",
    "extern int nh_player_max_hp;",
    "extern int nh_player_xp;",
    "extern int nh_player_level;",
    "extern int nh_hunger;",
    "extern int nh_has_amulet;",
    "extern int nh_rng_state;",
    "extern int nh_monster_active[32];",
    "extern int nh_monster_x[32];",
    "extern int nh_monster_y[32];",
    "extern int nh_monster_type[32];",
    "extern int nh_monster_hp[32];",
    "extern int nh_item_active[64];",
    "extern int nh_item_x[64];",
    "extern int nh_item_y[64];",
    "extern int nh_item_type[64];",
    "void nh_initialize();",
    "void nh_generate_level(int depth);",
    "int nh_try_move(int dx, int dy);",
    "void nh_monsters_initialize();",
    "void nh_monsters_turn();",
    "int nh_monster_at(int x, int y);",
    "void nh_attack_monster(int index);",
    "void nh_items_initialize();",
    "void nh_pickup_item();",
    "int nh_item_at(int x, int y);",
    "void nh_player_new();",
    "void nh_player_turn();",
    "void nh_player_damage(int amount);",
    "void nh_player_gain_xp(int amount);",
    "void nh_render();",
    "int nh_handle_key(int key);",
    "int nh_save();",
    "int nh_load();",
    "void nh_remove_save();",
    "void nh_seed(int seed);",
    "int nh_random(int bound);",
    "#endif",
  ]);
}

function mainSource(): string {
  return lines([
    '#include "nethack.h"',
    "int main(int argc, char **argv){",
    'if(argc > 2){fputs("nethack: too many arguments\\n", stderr); return 2;}',
    "if(argc == 2){",
    'if(strcmp(argv[1], "--help") == 0){fputs("usage: nethack [--help|--version]\\nkeys: hjklyubn move, S save, #quit (or q) abandons\\n", stdout); return 0;}',
    'if(strcmp(argv[1], "--version") == 0){fputs("NetHack for CS-Linux 1.0\\n", stdout); return 0;}',
    'fputs("nethack: unknown argument\\n", stderr); return 2;',
    "}",
    "nh_initialize();",
    "while(nh_player_hp > 0){",
    "nh_render();",
    "int key = cs_key_wait();",
    'if(key < 0){fputs("nethack: input failed\\n", stderr); return 3;}',
    "int action = nh_handle_key(key);",
    "if(action == 1) return 0;",
    'if(action == 2){if(nh_save() == 0){fputs("Game saved.\\n", stdout); return 0;} fputs("Save failed; previous save preserved.\\n", stderr);}',
    'if(action == 3){fputs("You ascend with the Amulet!\\n", stdout); nh_remove_save(); return 0;}',
    "}",
    'fputs("You die.\\n", stdout); nh_remove_save(); return 1;',
    "}",
  ]);
}

function worldSource(): string {
  return lines([
    '#include "nethack.h"',
    `int nh_map[1638] = {${nethackMapWords().join(",")}};`,
    `int nh_explored[1638] = {${nethackExploredWords().join(",")}};`,
    "int nh_level_seed[10];",
    "int nh_level_visited[10];",
    "int nh_depth = 0;",
    "int nh_turn = 0;",
    "void nh_initialize(){",
    "nh_player_new(); nh_seed(cs_clock_ticks() + 486);",
    "int i = 0; while(i < 10){nh_level_seed[i] = nh_random(2147483000); nh_level_visited[i] = 0; i = i + 1;}",
    "int loaded = nh_load(); int saved_x = nh_player_x; int saved_y = nh_player_y; if(loaded != 0){nh_depth = 0; nh_turn = 0;}",
    "nh_generate_level(nh_depth); if(loaded == 0){nh_player_x = saved_x; nh_player_y = saved_y;}",
    "}",
    "void nh_generate_level(int depth){",
    "int seed = nh_level_seed[depth];",
    "nh_player_x = 3; nh_player_y = 3; nh_level_visited[depth] = 1;",
    "int continuation = nh_rng_state; nh_seed(seed); nh_monsters_initialize(); nh_items_initialize(); nh_rng_state = continuation;",
    "}",
    "int nh_try_move(int dx, int dy){",
    "int x = nh_player_x + dx; int y = nh_player_y + dy; if(x < 1 || y < 1 || x >= NH_WIDTH - 1 || y >= NH_HEIGHT - 1) return 0;",
    "int monster = nh_monster_at(x, y); if(monster >= 0){nh_attack_monster(monster); nh_monsters_turn(); nh_player_turn(); return 1;}",
    "if(nh_map[y * NH_WIDTH + x] == 35) return 0; nh_frame[nh_player_y * NH_WIDTH + nh_player_x] = nh_map[nh_player_y * NH_WIDTH + nh_player_x] | (7 << 16); nh_player_x = x; nh_player_y = y; nh_pickup_item(); nh_turn = nh_turn + 1; nh_player_turn(); nh_monsters_turn(); return 1;",
    "}",
  ]);
}

function monstersSource(): string {
  return lines([
    '#include "nethack.h"',
    "int nh_monster_active[32];",
    "int nh_monster_x[32];",
    "int nh_monster_y[32];",
    "int nh_monster_type[32];",
    "int nh_monster_hp[32];",
    "void nh_monsters_initialize(){int i = 0; while(i < 32){if(nh_monster_active[i]) nh_frame[nh_monster_y[i] * NH_WIDTH + nh_monster_x[i]] = nh_map[nh_monster_y[i] * NH_WIDTH + nh_monster_x[i]] | (7 << 16); nh_monster_active[i] = 0; i = i + 1;} int count = 4 + nh_depth; if(count > 14) count = 14; i = 0; while(i < count){nh_monster_active[i] = 1; nh_monster_type[i] = nh_random(18); if(nh_monster_type[i] > nh_depth + 8) nh_monster_type[i] = nh_depth + 8; nh_monster_x[i] = 6 + nh_random(66); nh_monster_y[i] = 4 + nh_random(14); nh_monster_hp[i] = 2 + nh_monster_type[i] + nh_depth; i = i + 1;}}",
    "int nh_monster_at(int x, int y){int i = 0; while(i < 32){if(nh_monster_active[i] && nh_monster_x[i] == x && nh_monster_y[i] == y) return i; i = i + 1;} return -1;}",
    "void nh_attack_monster(int index){int damage = 1 + nh_player_level + nh_random(4); nh_monster_hp[index] = nh_monster_hp[index] - damage; if(nh_monster_hp[index] <= 0){nh_monster_active[index] = 0; nh_frame[nh_monster_y[index] * NH_WIDTH + nh_monster_x[index]] = nh_map[nh_monster_y[index] * NH_WIDTH + nh_monster_x[index]] | (7 << 16); nh_player_gain_xp(2 + nh_monster_type[index]);}}",
    "void nh_monsters_turn(){int i = 0; while(i < 32){if(nh_monster_active[i]){int dx = 0; int dy = 0; if(nh_monster_x[i] < nh_player_x) dx = 1; else if(nh_monster_x[i] > nh_player_x) dx = -1; if(nh_monster_y[i] < nh_player_y) dy = 1; else if(nh_monster_y[i] > nh_player_y) dy = -1; int distance = nh_monster_x[i] - nh_player_x; if(distance < 0) distance = -distance; int vertical = nh_monster_y[i] - nh_player_y; if(vertical < 0) vertical = -vertical; if(distance + vertical <= 1) nh_player_damage(1 + nh_monster_type[i] / 6); else {int nx = nh_monster_x[i] + dx; int ny = nh_monster_y[i] + dy; if(nh_map[ny * NH_WIDTH + nx] != 35 && nh_monster_at(nx, ny) < 0){nh_frame[nh_monster_y[i] * NH_WIDTH + nh_monster_x[i]] = nh_map[nh_monster_y[i] * NH_WIDTH + nh_monster_x[i]] | (7 << 16); nh_monster_x[i] = nx; nh_monster_y[i] = ny;}}} i = i + 1;}}",
  ]);
}

function itemsSource(): string {
  return lines([
    '#include "nethack.h"',
    "int nh_item_active[64];",
    "int nh_item_x[64];",
    "int nh_item_y[64];",
    "int nh_item_type[64];",
    "void nh_items_initialize(){int i = 0; while(i < 64){if(nh_item_active[i]) nh_frame[nh_item_y[i] * NH_WIDTH + nh_item_x[i]] = nh_map[nh_item_y[i] * NH_WIDTH + nh_item_x[i]] | (7 << 16); nh_item_active[i] = 0; i = i + 1;} int count = 8 + nh_depth; i = 0; while(i < count){nh_item_active[i] = 1; nh_item_type[i] = nh_random(25); nh_item_x[i] = 4 + nh_random(70); nh_item_y[i] = 3 + nh_random(16); i = i + 1;} if(nh_depth == 9){nh_item_active[63] = 1; nh_item_type[63] = 24; nh_item_x[63] = NH_WIDTH / 2; nh_item_y[63] = NH_HEIGHT / 2;}}",
    "int nh_item_at(int x, int y){int i = 0; while(i < 64){if(nh_item_active[i] && nh_item_x[i] == x && nh_item_y[i] == y) return i; i = i + 1;} return -1;}",
    'void nh_pickup_item(){int index = nh_item_at(nh_player_x, nh_player_y); if(index < 0) return; int type = nh_item_type[index]; nh_item_active[index] = 0; nh_frame[nh_player_y * NH_WIDTH + nh_player_x] = nh_map[nh_player_y * NH_WIDTH + nh_player_x] | (7 << 16); if(type == 24){nh_has_amulet = 1; fputs("You take the Amulet of Yendor.\\n", stdout);} else if(type % 5 == 0){nh_hunger = nh_hunger - 80; if(nh_hunger < 0) nh_hunger = 0;} else if(type % 5 == 1){nh_player_hp = nh_player_hp + 4; if(nh_player_hp > nh_player_max_hp) nh_player_hp = nh_player_max_hp;} else nh_player_gain_xp(1);}',
  ]);
}

function playerSource(): string {
  return lines([
    '#include "nethack.h"',
    "int nh_player_x = 3;",
    "int nh_player_y = 3;",
    "int nh_player_hp = 20;",
    "int nh_player_max_hp = 20;",
    "int nh_player_xp = 0;",
    "int nh_player_level = 1;",
    "int nh_hunger = 0;",
    "int nh_has_amulet = 0;",
    "void nh_player_new(){nh_player_x = 3; nh_player_y = 3; nh_player_hp = 20; nh_player_max_hp = 20; nh_player_xp = 0; nh_player_level = 1; nh_hunger = 0; nh_has_amulet = 0;}",
    "void nh_player_damage(int amount){nh_player_hp = nh_player_hp - amount;}",
    "void nh_player_gain_xp(int amount){nh_player_xp = nh_player_xp + amount; while(nh_player_level < 15 && nh_player_xp >= nh_player_level * nh_player_level * 8){nh_player_level = nh_player_level + 1; nh_player_max_hp = nh_player_max_hp + 2; nh_player_hp = nh_player_hp + 2;}}",
    "void nh_player_turn(){nh_hunger = nh_hunger + 1; int stage = nh_hunger / 50; if(stage > 5) stage = 5; if(stage >= 4 && nh_turn % 8 == 0) nh_player_damage(stage - 3);}",
  ]);
}

function displaySource(): string {
  return lines([
    '#include "nethack.h"',
    `int nh_frame[1638] = {${nethackFrameWords().join(",")}};`,
    "void nh_render(){int item = 0; while(item < NH_ITEMS){if(nh_item_active[item]){int index = nh_item_y[item] * NH_WIDTH + nh_item_x[item]; int character = nh_item_type[item] == 24 ? 38 : 33; nh_frame[index] = character | (14 << 16);} item = item + 1;} int monster = 0; while(monster < NH_MONSTERS){if(nh_monster_active[monster]){int index = nh_monster_y[monster] * NH_WIDTH + nh_monster_x[monster]; nh_frame[index] = (65 + nh_monster_type[monster]) | (12 << 16);} monster = monster + 1;} nh_frame[nh_player_y * NH_WIDTH + nh_player_x] = 64 | (15 << 16); int cursor = (nh_player_x & 255) | ((nh_player_y & 255) << 8) | 65536; int dimensions = NH_WIDTH | (NH_HEIGHT << 16); while(cs_term_present(nh_frame, dimensions, cursor) < 0){if(errno != EAGAIN) return; cs_sleep_ticks(1);}}",
  ]);
}

function inputSource(): string {
  return lines([
    '#include "nethack.h"',
    "int nh_handle_key(int key){",
    "if(key == 113) return 1; if(key == 83) return 2;",
    "if(key == 35){int q = cs_key_wait(); int u = cs_key_wait(); int i = cs_key_wait(); int t = cs_key_wait(); if(q == 113 && u == 117 && i == 105 && t == 116) return 1; return 0;}",
    "if(key == 104 || key == CS_KEY_LEFT) nh_try_move(-1, 0);",
    "else if(key == 108 || key == CS_KEY_RIGHT) nh_try_move(1, 0);",
    "else if(key == 107 || key == CS_KEY_UP) nh_try_move(0, -1);",
    "else if(key == 106 || key == CS_KEY_DOWN) nh_try_move(0, 1);",
    "else if(key == 121) nh_try_move(-1, -1); else if(key == 117) nh_try_move(1, -1); else if(key == 98) nh_try_move(-1, 1); else if(key == 110) nh_try_move(1, 1);",
    "else if(key == 62 && nh_depth < 9){nh_depth = nh_depth + 1; nh_generate_level(nh_depth);} else if(key == 60 && nh_depth > 0){nh_depth = nh_depth - 1; nh_generate_level(nh_depth);} else if(key == 60 && nh_depth == 0 && nh_has_amulet) return 3;",
    "return 0;",
    "}",
  ]);
}

function saveSource(): string {
  return lines([
    '#include "nethack.h"',
    "char nh_save_path[256];",
    "char nh_temp_path[256];",
    "int nh_save_words[40];",
    'int nh_paths(){char *home = getenv("HOME"); if(home == (char *)0 || home[0] != 47) return -1; int length = strlen(home); if(length < 1 || length > 220) return -1; int i = 0; while(i < length){if(home[i] == 0 || (home[i] == 46 && home[i + 1] == 46)) return -1; nh_save_path[i] = home[i]; nh_temp_path[i] = home[i]; i = i + 1;} char *tail = "/.nethack.sav"; int j = 0; while(tail[j] != 0){nh_save_path[i + j] = tail[j]; nh_temp_path[i + j] = tail[j]; j = j + 1;} nh_save_path[i + j] = 0; char *suffix = ".tmp"; int k = 0; while(suffix[k] != 0){nh_temp_path[i + j + k] = suffix[k]; k = k + 1;} nh_temp_path[i + j + k] = 0; return 0;}',
    "void nh_encode(){nh_save_words[0] = 67; nh_save_words[1] = 83; nh_save_words[2] = 78; nh_save_words[3] = 72; nh_save_words[4] = 1; nh_save_words[5] = nh_rng_state; nh_save_words[6] = nh_turn; nh_save_words[7] = nh_depth; nh_save_words[8] = nh_player_hp; nh_save_words[9] = nh_player_max_hp; nh_save_words[10] = nh_player_xp; nh_save_words[11] = nh_player_level; nh_save_words[12] = nh_hunger; nh_save_words[13] = nh_has_amulet; int i = 0; while(i < 10){nh_save_words[14 + i] = nh_level_seed[i]; nh_save_words[24 + i] = nh_level_visited[i]; i = i + 1;} nh_save_words[34] = nh_player_x; nh_save_words[35] = nh_player_y;}",
    "int nh_save(){if(nh_paths() != 0){errno = EINVAL; return -1;} nh_encode(); int fd = cs_open(nh_temp_path, CS_O_WRITE | CS_O_CREATE | CS_O_TRUNCATE, 384); if(fd < 0) return -1; int written = cs_write(fd, nh_save_words, 36); if(written != 36){cs_close(fd); cs_remove(nh_temp_path); return -1;} if(cs_close(fd) != 0){cs_remove(nh_temp_path); return -1;} if(cs_rename(nh_temp_path, nh_save_path) != 0){cs_remove(nh_temp_path); return -1;} return 0;}",
    'int nh_load(){if(nh_paths() != 0) return -1; int fd = cs_open(nh_save_path, CS_O_READ, 0); if(fd < 0) return -1; int count = cs_read(fd, nh_save_words, 36); cs_close(fd); if(count != 36 || nh_save_words[0] != 67 || nh_save_words[1] != 83 || nh_save_words[2] != 78 || nh_save_words[3] != 72 || nh_save_words[4] != 1){fputs("nethack: corrupt or unsupported save\\n", stderr); return -1;} nh_rng_state = nh_save_words[5]; nh_turn = nh_save_words[6]; nh_depth = nh_save_words[7]; nh_player_hp = nh_save_words[8]; nh_player_max_hp = nh_save_words[9]; nh_player_xp = nh_save_words[10]; nh_player_level = nh_save_words[11]; nh_hunger = nh_save_words[12]; nh_has_amulet = nh_save_words[13]; int i = 0; while(i < 10){nh_level_seed[i] = nh_save_words[14 + i]; nh_level_visited[i] = nh_save_words[24 + i]; i = i + 1;} nh_player_x = nh_save_words[34]; nh_player_y = nh_save_words[35]; return 0;}',
    "void nh_remove_save(){if(nh_paths() == 0) cs_remove(nh_save_path);}",
  ]);
}

function rngSource(): string {
  return lines([
    '#include "nethack.h"',
    "int nh_rng_state = 1;",
    "void nh_seed(int seed){seed = seed & 32767; if(seed == 0) seed = 1; nh_rng_state = seed;}",
    "int nh_random(int bound){if(bound <= 0) return 0; nh_rng_state = (nh_rng_state * 1103515245 + 12345) & 32767; return nh_rng_state % bound;}",
  ]);
}

function makefileSource(): string {
  const objectNames = [...moduleNames.map((name) => `${name}.o`), "libc.o"];
  return lines([
    `OBJECTS=${objectNames.join(" ")}`,
    "PREFIX=/usr/local",
    "all: nethack",
    "",
    "nethack: $(OBJECTS)",
    "\tld -o nethack $(OBJECTS)",
    "",
    ...moduleNames.flatMap((name) => [
      `${name}.o: ${name}.c nethack.h`,
      `\tcc -c ${name}.c -o ${name}.o`,
      "",
    ]),
    "libc.o: /usr/src/cs-libc/libc.c",
    "\tcc -c /usr/src/cs-libc/libc.c -o libc.o",
    "",
    "install: nethack",
    "\tmkdir -p $(PREFIX)/games",
    "\tcp nethack $(PREFIX)/games/nethack",
    "\tchmod 755 $(PREFIX)/games/nethack",
    "",
    "clean:",
    "\trm -f main.o world.o monsters.o items.o player.o display.o input.o save.o rng.o libc.o nethack",
  ]);
}

function nethackMapWords(): readonly number[] {
  const words: number[] = [];
  for (let y = 0; y < 21; y += 1) {
    for (let x = 0; x < 78; x += 1) {
      const border = x === 0 || y === 0 || x === 77 || y === 20;
      words.push(border ? 35 : 46);
    }
  }
  words[2 * 78 + 2] = 60;
  words[18 * 78 + 75] = 62;
  return words;
}

function nethackExploredWords(): readonly number[] {
  return nethackMapWords().map((_value, index) => {
    const x = index % 78;
    const y = Math.floor(index / 78);
    return Math.abs(x - 3) <= 10 && Math.abs(y - 3) <= 6 ? 1 : 0;
  });
}

function nethackFrameWords(): readonly number[] {
  const map = nethackMapWords();
  const explored = nethackExploredWords();
  return map.map((character, index) => {
    if (index === 3 * 78 + 3) return 64 | (15 << 16);
    return explored[index] === 1 ? character | (7 << 16) : 32;
  });
}
