import type { FilesystemBaseImageFile } from "../../domain/filesystem/inMemoryFilesystem.js";
import { guestNethackExecutableContents } from "./generated/guestNethackExecutableContents.js";

const nethackModuleNames = Object.freeze([
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
  files.push(
    Object.freeze({
      contents: guestNethackExecutableContents,
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
    "#define NH_INVENTORY 16",
    "#define NH_ROOMS 5",
    "#define NH_SAVE_WORDS 2191",
    "extern int nh_map[1638];",
    "extern int nh_explored[1638];",
    "extern int nh_frame[1638];",
    "extern int nh_room[1638];",
    "extern int nh_visible[1638];",
    "extern int nh_level_explored[16380];",
    "extern int nh_level_seed[10];",
    "extern int nh_level_visited[10];",
    "extern int nh_level_player_x[10];",
    "extern int nh_level_player_y[10];",
    "extern int nh_up_x;",
    "extern int nh_up_y;",
    "extern int nh_down_x;",
    "extern int nh_down_y;",
    "extern int nh_entry_from_down;",
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
    "extern int nh_level_monster_active[320];",
    "extern int nh_level_monster_x[320];",
    "extern int nh_level_monster_y[320];",
    "extern int nh_level_monster_type[320];",
    "extern int nh_level_monster_hp[320];",
    "extern int nh_item_active[64];",
    "extern int nh_item_x[64];",
    "extern int nh_item_y[64];",
    "extern int nh_item_type[64];",
    "extern int nh_level_item_active[640];",
    "extern int nh_level_item_x[640];",
    "extern int nh_level_item_y[640];",
    "extern int nh_level_item_type[640];",
    "extern int nh_inventory_type[16];",
    "extern int nh_inventory_qty[16];",
    "extern int nh_inventory_count;",
    "extern int nh_weapon_bonus;",
    "extern int nh_armor_bonus;",
    "void nh_initialize();",
    "void nh_generate_level(int depth);",
    "void nh_change_level(int depth);",
    "void nh_store_level();",
    "void nh_restore_level();",
    "void nh_update_visibility();",
    "int nh_try_move(int dx, int dy);",
    "void nh_monsters_initialize();",
    "void nh_monsters_store();",
    "void nh_monsters_restore();",
    "void nh_monsters_turn();",
    "int nh_monster_at(int x, int y);",
    "void nh_attack_monster(int index);",
    "void nh_items_initialize();",
    "void nh_items_store();",
    "void nh_items_restore();",
    "void nh_pickup_item();",
    "void nh_use_item();",
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
    'if(strcmp(argv[1], "--help") == 0){fputs("usage: nethack [--help|--version]\\nkeys: hjklyubn move, , pickup, i inventory, a use, S save, #quit (or q) abandons\\n", stdout); return 0;}',
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
    "int nh_room[1638];",
    "int nh_visible[1638];",
    "int nh_level_explored[16380];",
    "int nh_level_seed[10];",
    "int nh_level_visited[10];",
    "int nh_level_player_x[10];",
    "int nh_level_player_y[10];",
    "int nh_up_x = 2; int nh_up_y = 2; int nh_down_x = 75; int nh_down_y = 18;",
    "int nh_entry_from_down = 0;",
    "int nh_depth = 0;",
    "int nh_turn = 0;",
    "void nh_initialize(){",
    "nh_player_new(); nh_seed(cs_clock_ticks() + 486);",
    "int i = 0; while(i < 10){nh_level_seed[i] = nh_random(2147483000); nh_level_visited[i] = 0; nh_level_player_x[i] = 3; nh_level_player_y[i] = 3; i = i + 1;}",
    "int loaded = nh_load(); if(loaded != 0){nh_depth = 0; nh_turn = 0;}",
    "nh_entry_from_down = 0; nh_generate_level(nh_depth);",
    "}",
    "void nh_generate_level(int depth){",
    "int seed = nh_level_seed[depth]; int i = 0; int x = 0; int y = 0; int room = 0; int width = 0; int height = 0; int left = 0; int top = 0; int right = 0; int bottom = 0;",
    "while(i < NH_CELLS){nh_map[i] = 35; nh_room[i] = -1; nh_visible[i] = 0; nh_explored[i] = 0; i = i + 1;}",
    "room = 0; while(room < NH_ROOMS){width = 8 + ((seed + room * 17) % 9); height = 4 + ((seed / 7 + room * 11) % 4); left = 2 + ((seed + room * 23) % 56); top = 2 + ((seed / 5 + room * 13) % 12); right = left + width; bottom = top + height; if(right > 75) right = 75; if(bottom > 19) bottom = 19; y = top; while(y <= bottom){x = left; while(x <= right){if(x > 0 && x < 77 && y > 0 && y < 20){nh_map[y * NH_WIDTH + x] = 46; nh_room[y * NH_WIDTH + x] = room;} x = x + 1;} y = y + 1;} room = room + 1;}",
    "room = 1; while(room < NH_ROOMS){int a = room - 1; int ax = 2 + ((seed + a * 23) % 56) + (8 + ((seed + a * 17) % 9)) / 2; int ay = 2 + ((seed / 5 + a * 13) % 12) + (4 + ((seed / 7 + a * 11) % 4)) / 2; int bx = 2 + ((seed + room * 23) % 56) + (8 + ((seed + room * 17) % 9)) / 2; int by = 2 + ((seed / 5 + room * 13) % 12) + (4 + ((seed / 7 + room * 11) % 4)) / 2; x = ax; while(x != bx){if(x < bx) x = x + 1; else x = x - 1; if(x > 0 && x < 77){nh_map[ay * NH_WIDTH + x] = 46; if(nh_room[ay * NH_WIDTH + x] < 0) nh_room[ay * NH_WIDTH + x] = a;}} y = ay; while(y != by){if(y < by) y = y + 1; else y = y - 1; if(y > 0 && y < 20){nh_map[y * NH_WIDTH + bx] = 46; if(nh_room[y * NH_WIDTH + bx] < 0) nh_room[y * NH_WIDTH + bx] = room;}} room = room + 1;}",
    "nh_up_x = 2 + ((seed + 23) % 56) + (8 + ((seed + 17) % 9)) / 2; nh_up_y = 2 + ((seed / 5 + 13) % 12) + (4 + ((seed / 7 + 11) % 4)) / 2; nh_down_x = 2 + ((seed + 4 * 23) % 56) + (8 + ((seed + 4 * 17) % 9)) / 2; nh_down_y = 2 + ((seed / 5 + 4 * 13) % 12) + (4 + ((seed / 7 + 4 * 11) % 4)) / 2; nh_map[nh_up_y * NH_WIDTH + nh_up_x] = 60; nh_map[nh_down_y * NH_WIDTH + nh_down_x] = 62;",
    "if(nh_level_visited[depth]){nh_restore_level(); nh_player_x = nh_level_player_x[depth]; nh_player_y = nh_level_player_y[depth];} else {nh_level_visited[depth] = 1; nh_player_x = nh_entry_from_down ? nh_up_x : nh_up_x; nh_player_y = nh_up_y; int continuation = nh_rng_state; nh_seed(seed + depth * 91); nh_monsters_initialize(); nh_items_initialize(); nh_rng_state = continuation;}",
    "nh_update_visibility();",
    "}",
    "void nh_store_level(){int base = nh_depth * NH_CELLS; int i = 0; while(i < NH_CELLS){nh_level_explored[base + i] = nh_explored[i]; i = i + 1;} nh_level_player_x[nh_depth] = nh_player_x; nh_level_player_y[nh_depth] = nh_player_y; nh_monsters_store(); nh_items_store(); nh_level_visited[nh_depth] = 1;}",
    "void nh_restore_level(){int base = nh_depth * NH_CELLS; int i = 0; while(i < NH_CELLS){nh_explored[i] = nh_level_explored[base + i]; i = i + 1;} nh_monsters_restore(); nh_items_restore();}",
    "void nh_change_level(int depth){nh_store_level(); nh_depth = depth; if(nh_turn < 1000000) nh_turn = nh_turn + 1; nh_generate_level(depth);}",
    "void nh_update_visibility(){int i = 0; int x = 0; int y = 0; int dx = 0; int dy = 0; int current_room = nh_room[nh_player_y * NH_WIDTH + nh_player_x]; int base = nh_depth * NH_CELLS; while(i < NH_CELLS){nh_visible[i] = 0; x = i % NH_WIDTH; y = i / NH_WIDTH; dx = x - nh_player_x; if(dx < 0) dx = -dx; dy = y - nh_player_y; if(dy < 0) dy = -dy; if(nh_map[i] != 35 && (nh_room[i] == current_room || dx + dy <= 5)){nh_visible[i] = 1; nh_explored[i] = 1; nh_level_explored[base + i] = 1;} else if(nh_level_explored[base + i]) nh_explored[i] = 1; i = i + 1;}}",
    "int nh_try_move(int dx, int dy){",
    "int x = nh_player_x + dx; int y = nh_player_y + dy; if(x < 1 || y < 1 || x >= NH_WIDTH - 1 || y >= NH_HEIGHT - 1) return 0;",
    "int monster = nh_monster_at(x, y); if(monster >= 0){nh_attack_monster(monster); if(nh_turn < 1000000) nh_turn = nh_turn + 1; nh_player_turn(); nh_monsters_turn(); nh_update_visibility(); return 1;}",
    "if(nh_map[y * NH_WIDTH + x] == 35) return 0; nh_player_x = x; nh_player_y = y; nh_pickup_item(); if(nh_turn < 1000000) nh_turn = nh_turn + 1; nh_player_turn(); nh_monsters_turn(); nh_update_visibility(); return 1;",
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
    "int nh_level_monster_active[320];",
    "int nh_level_monster_x[320];",
    "int nh_level_monster_y[320];",
    "int nh_level_monster_type[320];",
    "int nh_level_monster_hp[320];",
    "void nh_monsters_initialize(){int i = 0; while(i < 32){nh_monster_active[i] = 0; i = i + 1;} int count = 4 + nh_depth * 2; if(count > 18) count = 18; i = 0; int attempts = 0; while(i < count && attempts < 160){int x = 1 + nh_random(76); int y = 1 + nh_random(19); attempts = attempts + 1; if(nh_map[y * NH_WIDTH + x] != 35 && nh_monster_at(x, y) < 0 && !(x == nh_up_x && y == nh_up_y) && !(x == nh_down_x && y == nh_down_y)){nh_monster_active[i] = 1; nh_monster_type[i] = nh_random(18); int max_type = 2 + nh_depth * 2; if(nh_monster_type[i] > max_type) nh_monster_type[i] = max_type; nh_monster_x[i] = x; nh_monster_y[i] = y; nh_monster_hp[i] = 2 + nh_monster_type[i] + nh_depth; i = i + 1;}} while(i < 32){nh_monster_active[i] = 0; i = i + 1;}}",
    "void nh_monsters_store(){int base = nh_depth * NH_MONSTERS; int i = 0; while(i < NH_MONSTERS){nh_level_monster_active[base + i] = nh_monster_active[i]; nh_level_monster_x[base + i] = nh_monster_x[i]; nh_level_monster_y[base + i] = nh_monster_y[i]; nh_level_monster_type[base + i] = nh_monster_type[i]; nh_level_monster_hp[base + i] = nh_monster_hp[i]; i = i + 1;}}",
    "void nh_monsters_restore(){int base = nh_depth * NH_MONSTERS; int i = 0; while(i < NH_MONSTERS){nh_monster_active[i] = nh_level_monster_active[base + i]; nh_monster_x[i] = nh_level_monster_x[base + i]; nh_monster_y[i] = nh_level_monster_y[base + i]; nh_monster_type[i] = nh_level_monster_type[base + i]; nh_monster_hp[i] = nh_level_monster_hp[base + i]; i = i + 1;}}",
    "int nh_monster_at(int x, int y){int i = 0; while(i < 32){if(nh_monster_active[i] && nh_monster_x[i] == x && nh_monster_y[i] == y) return i; i = i + 1;} return -1;}",
    "void nh_attack_monster(int index){int damage = 1 + nh_player_level + nh_weapon_bonus + nh_random(4); nh_monster_hp[index] = nh_monster_hp[index] - damage; if(nh_monster_hp[index] <= 0){nh_monster_active[index] = 0; nh_player_gain_xp(2 + nh_monster_type[index]);}}",
    "void nh_monsters_turn(){int i = 0; while(i < 32){if(nh_monster_active[i]){int index = nh_monster_y[i] * NH_WIDTH + nh_monster_x[i]; if(nh_visible[index]){int dx = 0; int dy = 0; if(nh_monster_x[i] < nh_player_x) dx = 1; else if(nh_monster_x[i] > nh_player_x) dx = -1; if(nh_monster_y[i] < nh_player_y) dy = 1; else if(nh_monster_y[i] > nh_player_y) dy = -1; int distance = nh_monster_x[i] - nh_player_x; if(distance < 0) distance = -distance; int vertical = nh_monster_y[i] - nh_player_y; if(vertical < 0) vertical = -vertical; if(distance + vertical <= 1) nh_player_damage(1 + nh_monster_type[i] / 6); else {int nx = nh_monster_x[i] + dx; int ny = nh_monster_y[i] + dy; if(nx > 0 && nx < 77 && ny > 0 && ny < 20 && nh_map[ny * NH_WIDTH + nx] != 35 && nh_monster_at(nx, ny) < 0 && !(nx == nh_player_x && ny == nh_player_y)){nh_monster_x[i] = nx; nh_monster_y[i] = ny;}}}} i = i + 1;}}",
  ]);
}

function itemsSource(): string {
  return lines([
    '#include "nethack.h"',
    "int nh_item_active[64];",
    "int nh_item_x[64];",
    "int nh_item_y[64];",
    "int nh_item_type[64];",
    "int nh_level_item_active[640];",
    "int nh_level_item_x[640];",
    "int nh_level_item_y[640];",
    "int nh_level_item_type[640];",
    "int nh_inventory_type[16];",
    "int nh_inventory_qty[16];",
    "int nh_inventory_count = 0;",
    "void nh_items_initialize(){int i = 0; while(i < 64){nh_item_active[i] = 0; i = i + 1;} int count = 6 + nh_depth * 2; if(count > 24) count = 24; i = 0; int attempts = 0; while(i < count && attempts < 180){int x = 1 + nh_random(76); int y = 1 + nh_random(19); attempts = attempts + 1; if(nh_map[y * NH_WIDTH + x] != 35 && nh_item_at(x, y) < 0 && nh_monster_at(x, y) < 0){nh_item_active[i] = 1; nh_item_type[i] = nh_random(24); nh_item_x[i] = x; nh_item_y[i] = y; i = i + 1;}} if(nh_depth == 9){nh_item_active[63] = 1; nh_item_type[63] = 24; nh_item_x[63] = nh_down_x; nh_item_y[63] = nh_down_y;}}",
    "void nh_items_store(){int base = nh_depth * NH_ITEMS; int i = 0; while(i < NH_ITEMS){nh_level_item_active[base + i] = nh_item_active[i]; nh_level_item_x[base + i] = nh_item_x[i]; nh_level_item_y[base + i] = nh_item_y[i]; nh_level_item_type[base + i] = nh_item_type[i]; i = i + 1;}}",
    "void nh_items_restore(){int base = nh_depth * NH_ITEMS; int i = 0; while(i < NH_ITEMS){nh_item_active[i] = nh_level_item_active[base + i]; nh_item_x[i] = nh_level_item_x[base + i]; nh_item_y[i] = nh_level_item_y[base + i]; nh_item_type[i] = nh_level_item_type[base + i]; i = i + 1;}}",
    "int nh_item_at(int x, int y){int i = 0; while(i < 64){if(nh_item_active[i] && nh_item_x[i] == x && nh_item_y[i] == y) return i; i = i + 1;} return -1;}",
    "int nh_inventory_add(int type){int i = 0; while(i < nh_inventory_count){if(nh_inventory_type[i] == type){nh_inventory_qty[i] = nh_inventory_qty[i] + 1; return 1;} i = i + 1;} if(nh_inventory_count >= NH_INVENTORY) return 0; nh_inventory_type[nh_inventory_count] = type; nh_inventory_qty[nh_inventory_count] = 1; nh_inventory_count = nh_inventory_count + 1; return 1;}",
    'void nh_pickup_item(){int index = nh_item_at(nh_player_x, nh_player_y); if(index < 0) return; int type = nh_item_type[index]; if(type != 24 && nh_inventory_add(type) == 0){fputs("Your pack is full.\\n", stdout); return;} nh_item_active[index] = 0; if(type == 24){nh_has_amulet = 1; fputs("You take the Amulet of Yendor.\\n", stdout);} else fputs("You pick up an item.\\n", stdout);}',
    'void nh_use_item(){if(nh_inventory_count <= 0){fputs("Your pack is empty.\\n", stdout); return;} int type = nh_inventory_type[0]; nh_inventory_qty[0] = nh_inventory_qty[0] - 1; if(nh_inventory_qty[0] <= 0){int i = 0; while(i + 1 < nh_inventory_count){nh_inventory_type[i] = nh_inventory_type[i + 1]; nh_inventory_qty[i] = nh_inventory_qty[i + 1]; i = i + 1;} nh_inventory_count = nh_inventory_count - 1;} if(type % 5 == 0){nh_hunger = nh_hunger - 80; if(nh_hunger < 0) nh_hunger = 0; fputs("You eat the food.\\n", stdout);} else if(type % 5 == 1){nh_player_hp = nh_player_hp + 5; if(nh_player_hp > nh_player_max_hp) nh_player_hp = nh_player_max_hp; fputs("You drink a healing potion.\\n", stdout);} else if(type % 5 == 2){nh_player_gain_xp(3); fputs("The scroll sharpens your mind.\\n", stdout);} else if(type % 5 == 3){nh_weapon_bonus = nh_weapon_bonus + 1; fputs("You wield a stronger weapon.\\n", stdout);} else {nh_armor_bonus = nh_armor_bonus + 1; fputs("You put on protective armor.\\n", stdout);}}',
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
    "int nh_weapon_bonus = 0;",
    "int nh_armor_bonus = 0;",
    "void nh_player_new(){nh_player_x = 3; nh_player_y = 3; nh_player_hp = 20; nh_player_max_hp = 20; nh_player_xp = 0; nh_player_level = 1; nh_hunger = 0; nh_has_amulet = 0; nh_weapon_bonus = 0; nh_armor_bonus = 0; nh_inventory_count = 0; int i = 0; while(i < NH_INVENTORY){nh_inventory_type[i] = 0; nh_inventory_qty[i] = 0; i = i + 1;}}",
    "void nh_player_damage(int amount){int reduced = amount - nh_armor_bonus; if(reduced < 1) reduced = 1; nh_player_hp = nh_player_hp - reduced;}",
    'void nh_player_gain_xp(int amount){nh_player_xp = nh_player_xp + amount; if(nh_player_xp > 1800) nh_player_xp = 1800; while(nh_player_level < 15 && nh_player_xp >= nh_player_level * nh_player_level * 8){nh_player_level = nh_player_level + 1; nh_player_max_hp = nh_player_max_hp + 3; nh_player_hp = nh_player_hp + 3; fputs("You advance a level.\\n", stdout);}}',
    'void nh_player_turn(){int previous = nh_hunger / 50; if(nh_hunger < 300) nh_hunger = nh_hunger + 1; int stage = nh_hunger / 50; if(stage > 5) stage = 5; if(stage != previous){if(stage == 0) fputs("You are satiated.\\n", stdout); else if(stage == 1) fputs("You feel hungry.\\n", stdout); else if(stage == 2) fputs("You are weak from hunger.\\n", stdout); else if(stage == 3) fputs("You are faint from hunger.\\n", stdout); else if(stage == 4) fputs("You are starving.\\n", stdout); else fputs("You are near death from starvation.\\n", stdout);} if(stage >= 4 && nh_turn % 4 == 0) nh_player_damage(stage - 3);}',
  ]);
}

function displaySource(): string {
  return lines([
    '#include "nethack.h"',
    `int nh_frame[1638] = {${nethackFrameWords().join(",")}};`,
    "void nh_render(){int i = 0; while(i < NH_CELLS){int character = 32; int color = 7; if(nh_visible[i]){character = nh_map[i]; color = nh_map[i] == 35 ? 8 : 7;} else if(nh_explored[i]){character = nh_map[i]; color = 8;} nh_frame[i] = character | (color << 16) | (15 << 20); i = i + 1;} int item = 0; while(item < NH_ITEMS){if(nh_item_active[item]){int index = nh_item_y[item] * NH_WIDTH + nh_item_x[item]; if(nh_visible[index]){int character = nh_item_type[item] == 24 ? 38 : 33 + (nh_item_type[item] % 10); nh_frame[index] = character | (14 << 16) | (15 << 20);}} item = item + 1;} int monster = 0; while(monster < NH_MONSTERS){if(nh_monster_active[monster]){int index = nh_monster_y[monster] * NH_WIDTH + nh_monster_x[monster]; if(nh_visible[index]) nh_frame[index] = (65 + nh_monster_type[monster]) | (12 << 16) | (15 << 20);} monster = monster + 1;} nh_frame[nh_player_y * NH_WIDTH + nh_player_x] = 64 | (15 << 16) | (15 << 20); int cursor = (nh_player_x & 255) | ((nh_player_y & 255) << 8) | 65536; int dimensions = NH_WIDTH | (NH_HEIGHT << 16); int attempts = 0; while(attempts < 4){int result = cs_term_present(nh_frame, dimensions, cursor); if(result >= 0 || errno != EAGAIN) return; cs_sleep_ticks(1); attempts = attempts + 1;}}",
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
    'else if(key == 44) nh_pickup_item(); else if(key == 105){int i = 0; fputs("Inventory:\\n", stdout); while(i < nh_inventory_count){fputs(" item\\n", stdout); i = i + 1;}} else if(key == 97) nh_use_item();',
    "else if(key == 62 && nh_depth < 9 && nh_player_x == nh_down_x && nh_player_y == nh_down_y){nh_entry_from_down = 1; nh_change_level(nh_depth + 1);} else if(key == 60 && nh_player_x == nh_up_x && nh_player_y == nh_up_y && nh_depth > 0){nh_entry_from_down = 0; nh_change_level(nh_depth - 1);} else if(key == 60 && nh_depth == 0 && nh_player_x == nh_up_x && nh_player_y == nh_up_y && nh_has_amulet) return 3;",
    "return 0;",
    "}",
  ]);
}

function saveSource(): string {
  return lines([
    '#include "nethack.h"',
    "char nh_save_path[256];",
    "char nh_temp_path[256];",
    "int nh_save_words[2191];",
    'int nh_paths(){char *home = getenv("HOME"); if(home == (char *)0 || home[0] != 47) return -1; int length = strlen(home); if(length < 1 || length > 220) return -1; int i = 0; while(i < length){if(home[i] == 46 && home[i + 1] == 46) return -1; nh_save_path[i] = home[i]; nh_temp_path[i] = home[i]; i = i + 1;} char *tail = "/.nethack.sav"; int j = 0; while(tail[j] != 0){nh_save_path[i + j] = tail[j]; nh_temp_path[i + j] = tail[j]; j = j + 1;} nh_save_path[i + j] = 0; char *suffix = ".tmp"; int k = 0; while(suffix[k] != 0){nh_temp_path[i + j + k] = suffix[k]; k = k + 1;} nh_temp_path[i + j + k] = 0; return 0;}',
    "void nh_encode(){nh_store_level(); int i = 0; int level = 0; int bit = 0; int packed = 0; int offset = 0; nh_save_words[0] = 67; nh_save_words[1] = 83; nh_save_words[2] = 78; nh_save_words[3] = 72; nh_save_words[4] = 2; nh_save_words[5] = nh_rng_state; nh_save_words[6] = nh_turn; nh_save_words[7] = nh_depth; nh_save_words[8] = nh_player_hp; nh_save_words[9] = nh_player_max_hp; nh_save_words[10] = nh_player_xp; nh_save_words[11] = nh_player_level; nh_save_words[12] = nh_hunger; nh_save_words[13] = nh_has_amulet; nh_save_words[14] = nh_player_x; nh_save_words[15] = nh_player_y; nh_save_words[16] = nh_weapon_bonus; nh_save_words[17] = nh_armor_bonus; nh_save_words[18] = nh_inventory_count; i = 0; while(i < NH_INVENTORY){nh_save_words[19 + i] = nh_inventory_type[i]; nh_save_words[35 + i] = nh_inventory_qty[i]; i = i + 1;} i = 0; while(i < NH_LEVELS){nh_save_words[51 + i] = nh_level_seed[i]; nh_save_words[61 + i] = nh_level_visited[i]; nh_save_words[71 + i] = nh_level_player_x[i]; nh_save_words[81 + i] = nh_level_player_y[i]; i = i + 1;} level = 0; while(level < NH_LEVELS){offset = 91 + level * 82; bit = 0; while(bit < 82){packed = 0; i = 0; while(i < 20){int cell = bit * 20 + i; if(cell < NH_CELLS && nh_level_explored[level * NH_CELLS + cell]) packed = packed | (1 << i); i = i + 1;} nh_save_words[offset + bit] = packed; bit = bit + 1;} level = level + 1;} offset = 911; level = 0; while(level < NH_LEVELS){i = 0; while(i < NH_MONSTERS){int base = level * NH_MONSTERS + i; int packed_monster = (nh_level_monster_active[base] & 1) | ((nh_level_monster_type[base] & 31) << 1) | ((nh_level_monster_x[base] & 127) << 6) | ((nh_level_monster_y[base] & 31) << 13); nh_save_words[offset] = packed_monster; nh_save_words[offset + 1] = nh_level_monster_hp[base]; offset = offset + 2; i = i + 1;} i = 0; while(i < NH_ITEMS){int base_item = level * NH_ITEMS + i; int packed_item = (nh_level_item_active[base_item] & 1) | ((nh_level_item_type[base_item] & 31) << 1) | ((nh_level_item_x[base_item] & 127) << 6) | ((nh_level_item_y[base_item] & 31) << 13); nh_save_words[offset] = packed_item; offset = offset + 1; i = i + 1;} level = level + 1;}}",
    "int nh_save(){if(nh_paths() != 0){errno = EINVAL; return -1;} nh_encode(); int fd = cs_open(nh_temp_path, CS_O_WRITE | CS_O_CREATE | CS_O_TRUNCATE, 384); if(fd < 0) return -1; int offset = 0; while(offset < NH_SAVE_WORDS){int chunk = NH_SAVE_WORDS - offset; if(chunk > 16) chunk = 16; int written = cs_write(fd, nh_save_words + offset, chunk); if(written != chunk){cs_close(fd); cs_remove(nh_temp_path); return -1;} offset = offset + chunk;} if(cs_close(fd) != 0){cs_remove(nh_temp_path); return -1;} if(cs_rename(nh_temp_path, nh_save_path) != 0){cs_remove(nh_temp_path); return -1;} return 0;}",
    'int nh_load(){if(nh_paths() != 0) return -1; int fd = cs_open(nh_save_path, CS_O_READ, 0); if(fd < 0) return -1; int count = cs_read(fd, nh_save_words, NH_SAVE_WORDS); int closed = cs_close(fd); if(count != NH_SAVE_WORDS || closed != 0 || nh_save_words[0] != 67 || nh_save_words[1] != 83 || nh_save_words[2] != 78 || nh_save_words[3] != 72 || nh_save_words[4] != 2){fputs("nethack: corrupt or unsupported save\\n", stderr); return -1;} nh_rng_state = nh_save_words[5]; nh_turn = nh_save_words[6]; nh_depth = nh_save_words[7]; nh_player_hp = nh_save_words[8]; nh_player_max_hp = nh_save_words[9]; nh_player_xp = nh_save_words[10]; nh_player_level = nh_save_words[11]; nh_hunger = nh_save_words[12]; nh_has_amulet = nh_save_words[13]; nh_player_x = nh_save_words[14]; nh_player_y = nh_save_words[15]; nh_weapon_bonus = nh_save_words[16]; nh_armor_bonus = nh_save_words[17]; nh_inventory_count = nh_save_words[18]; int i = 0; while(i < NH_INVENTORY){nh_inventory_type[i] = nh_save_words[19 + i]; nh_inventory_qty[i] = nh_save_words[35 + i]; i = i + 1;} i = 0; while(i < NH_LEVELS){nh_level_seed[i] = nh_save_words[51 + i]; nh_level_visited[i] = nh_save_words[61 + i]; nh_level_player_x[i] = nh_save_words[71 + i]; nh_level_player_y[i] = nh_save_words[81 + i]; i = i + 1;} int level = 0; int offset = 0; int bit = 0; while(level < NH_LEVELS){offset = 91 + level * 82; bit = 0; while(bit < 82){int word = nh_save_words[offset + bit]; i = 0; while(i < 20){int cell = bit * 20 + i; if(cell < NH_CELLS) nh_level_explored[level * NH_CELLS + cell] = (word >> i) & 1; i = i + 1;} bit = bit + 1;} level = level + 1;} offset = 911; level = 0; while(level < NH_LEVELS){i = 0; while(i < NH_MONSTERS){int base = level * NH_MONSTERS + i; int packed_monster = nh_save_words[offset]; nh_level_monster_active[base] = packed_monster & 1; nh_level_monster_type[base] = (packed_monster >> 1) & 31; nh_level_monster_x[base] = (packed_monster >> 6) & 127; nh_level_monster_y[base] = (packed_monster >> 13) & 31; nh_level_monster_hp[base] = nh_save_words[offset + 1]; offset = offset + 2; i = i + 1;} i = 0; while(i < NH_ITEMS){int base_item = level * NH_ITEMS + i; int packed_item = nh_save_words[offset]; nh_level_item_active[base_item] = packed_item & 1; nh_level_item_type[base_item] = (packed_item >> 1) & 31; nh_level_item_x[base_item] = (packed_item >> 6) & 127; nh_level_item_y[base_item] = (packed_item >> 13) & 31; offset = offset + 1; i = i + 1;} level = level + 1;} nh_monsters_restore(); nh_items_restore(); return 0;}',
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
  const objectNames = [
    ...nethackModuleNames.map((name) => `${name}.o`),
    "libc.o",
  ];
  return lines([
    `OBJECTS=${objectNames.join(" ")}`,
    "PREFIX=/usr/local",
    "all: nethack",
    "",
    "nethack: $(OBJECTS)",
    "\tld -o nethack $(OBJECTS)",
    "",
    ...nethackModuleNames.flatMap((name) => [
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
    if (index === 3 * 78 + 3) return 64 | (15 << 16) | (15 << 20);
    return explored[index] === 1
      ? character | (7 << 16) | (15 << 20)
      : 32 | (15 << 20);
  });
}
