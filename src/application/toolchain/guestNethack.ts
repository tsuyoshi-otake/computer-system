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
    "#define NH_DIRTY_MAX 256",
    "#define NH_CORRIDOR 1",
    "extern int nh_map[1638];",
    "extern int nh_explored[1638];",
    "extern int nh_frame[1638];",
    "extern int nh_room[1638];",
    "extern int nh_visible[1638];",
    "extern int nh_frame_full;",
    "extern int nh_cell_dirty[1638];",
    "extern int nh_dirty_list[256];",
    "extern int nh_dirty_count;",
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
    "void nh_copy_words(int *destination, int *source, int count);",
    "int nh_room_left(int seed, int room);",
    "int nh_room_top(int seed, int room);",
    "int nh_room_width(int seed, int room);",
    "int nh_room_height(int seed, int room);",
    "int nh_room_cx(int seed, int room);",
    "int nh_room_cy(int seed, int room);",
    "void nh_dig(int x, int y, int room);",
    "int nh_pack_entity(int active, int type, int x, int y);",
    "int nh_clamp(int value, int low, int high);",
    "void nh_vis_cell(int x, int y, int current_room, int base);",
    "void nh_wall_expose(int x, int y, int base, int vis);",
    "void nh_update_visibility();",
    "void nh_update_visibility_local(int old_x, int old_y);",
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
    "void nh_render_cell(int index);",
    "void nh_render_overlays(int only_dirty);",
    "int nh_wall_glyph(int index);",
    "int nh_wall_lit(int index);",
    "int nh_status_put(int col, int character);",
    "int nh_status_label(int col, char *text);",
    "int nh_status_number(int col, int value);",
    "int nh_status_update();",
    "void nh_help_line(int row, char *text);",
    "void nh_show_help();",
    "void nh_touch(int index);",
    "void nh_message_char(int character);",
    "void nh_message(char *text);",
    "void nh_clear_message();",
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
    'if(strcmp(argv[1], "--help") == 0){fputs("usage: nethack [--help|--version]\\nkeys: hjklyubn move, , pickup, i inventory, a use, < > stairs, ? help, S save, #quit (or q) abandons\\n", stdout); return 0;}',
    'if(strcmp(argv[1], "--version") == 0){fputs("NetHack for CS-Linux 1.0\\n", stdout); return 0;}',
    'fputs("nethack: unknown argument\\n", stderr); return 2;',
    "}",
    "nh_initialize();",
    "while(nh_player_hp > 0){",
    "nh_render();",
    "int key = cs_key_wait();",
    'if(key < 0){fputs("nethack: input failed\\n", stderr); return 3;}',
    "nh_clear_message();",
    "int action = nh_handle_key(key);",
    "if(action == 1) return 0;",
    'if(action == 2){if(nh_save() == 0){fputs("Game saved.\\n", stdout); return 0;} nh_message("Save failed; previous save preserved.");}',
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
    "void nh_copy_words(int *destination, int *source, int count){int i = 0; while(i < count){destination[i] = source[i]; i = i + 1;}}",
    "int nh_room_left(int seed, int room){return 2 + ((seed + room * 23) % 56);}",
    "int nh_room_top(int seed, int room){return 2 + ((seed / 5 + room * 13) % 12);}",
    "int nh_room_width(int seed, int room){return 8 + ((seed + room * 17) % 9);}",
    "int nh_room_height(int seed, int room){return 4 + ((seed / 7 + room * 11) % 4);}",
    "int nh_room_cx(int seed, int room){return nh_room_left(seed, room) + nh_room_width(seed, room) / 2;}",
    "int nh_room_cy(int seed, int room){return nh_room_top(seed, room) + nh_room_height(seed, room) / 2;}",
    "void nh_dig(int x, int y, int room){if(x > 0 && x < 77 && y > 0 && y < 20){int i = y * NH_WIDTH + x; if(nh_map[i] == 35) nh_map[i] = NH_CORRIDOR; if(nh_room[i] < 0) nh_room[i] = room;}}",
    "void nh_initialize(){",
    "nh_player_new(); nh_seed(cs_clock_ticks() + 486);",
    "int i = 0; while(i < 10){nh_level_seed[i] = nh_random(2147483000); nh_level_visited[i] = 0; nh_level_player_x[i] = 3; nh_level_player_y[i] = 3; i = i + 1;}",
    "int loaded = nh_load(); if(loaded != 0){nh_depth = 0; nh_turn = 0;}",
    "nh_entry_from_down = 0; nh_generate_level(nh_depth);",
    "}",
    "void nh_generate_level(int depth){",
    "int seed = nh_level_seed[depth]; int i = 0; int x = 0; int y = 0; int room = 0; int width = 0; int height = 0; int left = 0; int top = 0; int right = 0; int bottom = 0;",
    "while(i < NH_CELLS){nh_map[i] = 35; nh_room[i] = -1; nh_visible[i] = 0; nh_explored[i] = 0; i = i + 1;}",
    "room = 0; while(room < NH_ROOMS){width = nh_room_width(seed, room); height = nh_room_height(seed, room); left = nh_room_left(seed, room); top = nh_room_top(seed, room); right = left + width; bottom = top + height; if(right > 75) right = 75; if(bottom > 19) bottom = 19; y = top; while(y <= bottom){x = left; while(x <= right){if(x > 0 && x < 77 && y > 0 && y < 20){nh_map[y * NH_WIDTH + x] = 46; nh_room[y * NH_WIDTH + x] = room;} x = x + 1;} y = y + 1;} room = room + 1;}",
    "room = 1; while(room < NH_ROOMS){int a = room - 1; int ax = nh_room_cx(seed, a); int ay = nh_room_cy(seed, a); int bx = nh_room_cx(seed, room); int by = nh_room_cy(seed, room); x = ax; while(x != bx){if(x < bx) x = x + 1; else x = x - 1; nh_dig(x, ay, a);} y = ay; while(y != by){if(y < by) y = y + 1; else y = y - 1; nh_dig(bx, y, room);} room = room + 1;}",
    "nh_up_x = nh_room_cx(seed, 1); nh_up_y = nh_room_cy(seed, 1); nh_down_x = nh_room_cx(seed, 4); nh_down_y = nh_room_cy(seed, 4); nh_map[nh_up_y * NH_WIDTH + nh_up_x] = 60; nh_map[nh_down_y * NH_WIDTH + nh_down_x] = 62;",
    "if(nh_level_visited[depth]){nh_restore_level(); nh_player_x = nh_level_player_x[depth]; nh_player_y = nh_level_player_y[depth];} else {nh_level_visited[depth] = 1; nh_player_x = nh_up_x; nh_player_y = nh_up_y; int continuation = nh_rng_state; nh_seed(seed + depth * 91); nh_monsters_initialize(); nh_items_initialize(); nh_rng_state = continuation;}",
    "nh_frame_full = 1; nh_update_visibility();",
    "}",
    "void nh_store_level(){nh_copy_words(nh_level_explored + nh_depth * NH_CELLS, nh_explored, NH_CELLS); nh_level_player_x[nh_depth] = nh_player_x; nh_level_player_y[nh_depth] = nh_player_y; nh_monsters_store(); nh_items_store(); nh_level_visited[nh_depth] = 1;}",
    "void nh_restore_level(){nh_copy_words(nh_explored, nh_level_explored + nh_depth * NH_CELLS, NH_CELLS); nh_monsters_restore(); nh_items_restore();}",
    "void nh_change_level(int depth){nh_store_level(); nh_depth = depth; if(nh_turn < 1000000) nh_turn = nh_turn + 1; nh_generate_level(depth);}",
    "int nh_clamp(int value, int low, int high){if(value < low) return low; if(value > high) return high; return value;}",
    "void nh_wall_expose(int x, int y, int base, int vis){int dy = -1; while(dy <= 1){int dx = -1; while(dx <= 1){int nx = x + dx; int ny = y + dy; if(nx >= 0 && nx < NH_WIDTH && ny >= 0 && ny < NH_HEIGHT){int n = ny * NH_WIDTH + nx; if(nh_map[n] == 35){if(vis && !nh_explored[n]){nh_explored[n] = 1; nh_level_explored[base + n] = 1;} nh_touch(n);}} dx = dx + 1;} dy = dy + 1;}}",
    "void nh_vis_cell(int x, int y, int current_room, int base){int i = y * NH_WIDTH + x; int dx = x - nh_player_x; if(dx < 0) dx = -dx; int dy = y - nh_player_y; if(dy < 0) dy = -dy; int vis = 0; if(nh_map[i] != 35 && (nh_room[i] == current_room || dx + dy <= 5)) vis = 1; if(vis != nh_visible[i]){nh_visible[i] = vis; nh_touch(i); if(vis){nh_explored[i] = 1; nh_level_explored[base + i] = 1;} nh_wall_expose(x, y, base, vis);}}",
    "void nh_update_visibility(){int current_room = nh_room[nh_player_y * NH_WIDTH + nh_player_x]; int base = nh_depth * NH_CELLS; int y = 0; while(y < NH_HEIGHT){int x = 0; while(x < NH_WIDTH){nh_vis_cell(x, y, current_room, base); x = x + 1;} y = y + 1;}}",
    "void nh_update_visibility_local(int old_x, int old_y){int current_room = nh_room[nh_player_y * NH_WIDTH + nh_player_x]; int base = nh_depth * NH_CELLS; int x0 = nh_clamp((old_x < nh_player_x ? old_x : nh_player_x) - 5, 0, NH_WIDTH - 1); int x1 = nh_clamp((old_x > nh_player_x ? old_x : nh_player_x) + 5, 0, NH_WIDTH - 1); int y0 = nh_clamp((old_y < nh_player_y ? old_y : nh_player_y) - 5, 0, NH_HEIGHT - 1); int y1 = nh_clamp((old_y > nh_player_y ? old_y : nh_player_y) + 5, 0, NH_HEIGHT - 1); int y = y0; while(y <= y1){int x = x0; while(x <= x1){nh_vis_cell(x, y, current_room, base); x = x + 1;} y = y + 1;}}",
    "int nh_try_move(int dx, int dy){",
    "int x = nh_player_x + dx; int y = nh_player_y + dy; if(x < 1 || y < 1 || x >= NH_WIDTH - 1 || y >= NH_HEIGHT - 1) return 0;",
    "int monster = nh_monster_at(x, y); if(monster >= 0){nh_attack_monster(monster); if(nh_turn < 1000000) nh_turn = nh_turn + 1; nh_player_turn(); nh_monsters_turn(); return 1;}",
    "if(nh_map[y * NH_WIDTH + x] == 35) return 0; int old_x = nh_player_x; int old_y = nh_player_y; nh_player_x = x; nh_player_y = y; nh_touch(old_y * NH_WIDTH + old_x); nh_pickup_item(); if(nh_turn < 1000000) nh_turn = nh_turn + 1; nh_player_turn(); nh_monsters_turn(); if(nh_room[y * NH_WIDTH + x] != nh_room[old_y * NH_WIDTH + old_x]) nh_update_visibility(); else nh_update_visibility_local(old_x, old_y); return 1;",
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
    "void nh_monsters_store(){int base = nh_depth * NH_MONSTERS; nh_copy_words(nh_level_monster_active + base, nh_monster_active, NH_MONSTERS); nh_copy_words(nh_level_monster_x + base, nh_monster_x, NH_MONSTERS); nh_copy_words(nh_level_monster_y + base, nh_monster_y, NH_MONSTERS); nh_copy_words(nh_level_monster_type + base, nh_monster_type, NH_MONSTERS); nh_copy_words(nh_level_monster_hp + base, nh_monster_hp, NH_MONSTERS);}",
    "void nh_monsters_restore(){int base = nh_depth * NH_MONSTERS; nh_copy_words(nh_monster_active, nh_level_monster_active + base, NH_MONSTERS); nh_copy_words(nh_monster_x, nh_level_monster_x + base, NH_MONSTERS); nh_copy_words(nh_monster_y, nh_level_monster_y + base, NH_MONSTERS); nh_copy_words(nh_monster_type, nh_level_monster_type + base, NH_MONSTERS); nh_copy_words(nh_monster_hp, nh_level_monster_hp + base, NH_MONSTERS);}",
    "int nh_monster_at(int x, int y){int i = 0; while(i < 32){if(nh_monster_active[i] && nh_monster_x[i] == x && nh_monster_y[i] == y) return i; i = i + 1;} return -1;}",
    "void nh_attack_monster(int index){int damage = 1 + nh_player_level + nh_weapon_bonus + nh_random(4); nh_monster_hp[index] = nh_monster_hp[index] - damage; if(nh_monster_hp[index] <= 0){nh_monster_active[index] = 0; nh_touch(nh_monster_y[index] * NH_WIDTH + nh_monster_x[index]); nh_player_gain_xp(2 + nh_monster_type[index]);}}",
    "void nh_monsters_turn(){int i = 0; while(i < 32){if(nh_monster_active[i]){int index = nh_monster_y[i] * NH_WIDTH + nh_monster_x[i]; if(nh_visible[index]){int dx = 0; int dy = 0; if(nh_monster_x[i] < nh_player_x) dx = 1; else if(nh_monster_x[i] > nh_player_x) dx = -1; if(nh_monster_y[i] < nh_player_y) dy = 1; else if(nh_monster_y[i] > nh_player_y) dy = -1; int distance = nh_monster_x[i] - nh_player_x; if(distance < 0) distance = -distance; int vertical = nh_monster_y[i] - nh_player_y; if(vertical < 0) vertical = -vertical; if(distance + vertical <= 1) nh_player_damage(1 + nh_monster_type[i] / 6); else {int nx = nh_monster_x[i] + dx; int ny = nh_monster_y[i] + dy; if(nx > 0 && nx < 77 && ny > 0 && ny < 20 && nh_map[ny * NH_WIDTH + nx] != 35 && nh_monster_at(nx, ny) < 0 && !(nx == nh_player_x && ny == nh_player_y)){nh_touch(nh_monster_y[i] * NH_WIDTH + nh_monster_x[i]); nh_monster_x[i] = nx; nh_monster_y[i] = ny; nh_touch(ny * NH_WIDTH + nx);}}}} i = i + 1;}}",
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
    "void nh_items_store(){int base = nh_depth * NH_ITEMS; nh_copy_words(nh_level_item_active + base, nh_item_active, NH_ITEMS); nh_copy_words(nh_level_item_x + base, nh_item_x, NH_ITEMS); nh_copy_words(nh_level_item_y + base, nh_item_y, NH_ITEMS); nh_copy_words(nh_level_item_type + base, nh_item_type, NH_ITEMS);}",
    "void nh_items_restore(){int base = nh_depth * NH_ITEMS; nh_copy_words(nh_item_active, nh_level_item_active + base, NH_ITEMS); nh_copy_words(nh_item_x, nh_level_item_x + base, NH_ITEMS); nh_copy_words(nh_item_y, nh_level_item_y + base, NH_ITEMS); nh_copy_words(nh_item_type, nh_level_item_type + base, NH_ITEMS);}",
    "int nh_item_at(int x, int y){int i = 0; while(i < 64){if(nh_item_active[i] && nh_item_x[i] == x && nh_item_y[i] == y) return i; i = i + 1;} return -1;}",
    "int nh_inventory_add(int type){int i = 0; while(i < nh_inventory_count){if(nh_inventory_type[i] == type){nh_inventory_qty[i] = nh_inventory_qty[i] + 1; return 1;} i = i + 1;} if(nh_inventory_count >= NH_INVENTORY) return 0; nh_inventory_type[nh_inventory_count] = type; nh_inventory_qty[nh_inventory_count] = 1; nh_inventory_count = nh_inventory_count + 1; return 1;}",
    'void nh_pickup_item(){int index = nh_item_at(nh_player_x, nh_player_y); if(index < 0) return; int type = nh_item_type[index]; if(type != 24 && nh_inventory_add(type) == 0){nh_message("Your pack is full."); return;} nh_item_active[index] = 0; nh_touch(nh_item_y[index] * NH_WIDTH + nh_item_x[index]); if(type == 24){nh_has_amulet = 1; nh_message("You take the Amulet of Yendor.");} else nh_message("You pick up an item.");}',
    'void nh_use_item(){if(nh_inventory_count <= 0){nh_message("Your pack is empty."); return;} int type = nh_inventory_type[0]; nh_inventory_qty[0] = nh_inventory_qty[0] - 1; if(nh_inventory_qty[0] <= 0){int i = 0; while(i + 1 < nh_inventory_count){nh_inventory_type[i] = nh_inventory_type[i + 1]; nh_inventory_qty[i] = nh_inventory_qty[i + 1]; i = i + 1;} nh_inventory_count = nh_inventory_count - 1;} if(type % 5 == 0){nh_hunger = nh_hunger - 80; if(nh_hunger < 0) nh_hunger = 0; nh_message("You eat the food.");} else if(type % 5 == 1){nh_player_hp = nh_player_hp + 5; if(nh_player_hp > nh_player_max_hp) nh_player_hp = nh_player_max_hp; nh_message("You drink a healing potion.");} else if(type % 5 == 2){nh_player_gain_xp(3); nh_message("The scroll sharpens your mind.");} else if(type % 5 == 3){nh_weapon_bonus = nh_weapon_bonus + 1; nh_message("You wield a stronger weapon.");} else {nh_armor_bonus = nh_armor_bonus + 1; nh_message("You put on protective armor.");}}',
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
    'void nh_player_gain_xp(int amount){nh_player_xp = nh_player_xp + amount; if(nh_player_xp > 1800) nh_player_xp = 1800; while(nh_player_level < 15 && nh_player_xp >= nh_player_level * nh_player_level * 8){nh_player_level = nh_player_level + 1; nh_player_max_hp = nh_player_max_hp + 3; nh_player_hp = nh_player_hp + 3; nh_message("You advance a level.");}}',
    'void nh_player_turn(){int previous = nh_hunger / 50; if(nh_hunger < 300) nh_hunger = nh_hunger + 1; int stage = nh_hunger / 50; if(stage > 5) stage = 5; if(stage != previous){if(stage == 0) nh_message("You are satiated."); else if(stage == 1) nh_message("You feel hungry."); else if(stage == 2) nh_message("You are weak from hunger."); else if(stage == 3) nh_message("You are faint from hunger."); else if(stage == 4) nh_message("You are starving."); else nh_message("You are near death from starvation.");} if(stage >= 4 && nh_turn % 4 == 0) nh_player_damage(stage - 3);}',
  ]);
}

function displaySource(): string {
  return lines([
    '#include "nethack.h"',
    `int nh_frame[1638] = {${nethackFrameWords().join(",")}};`,
    "int nh_frame_full = 1;",
    "int nh_cell_dirty[1638];",
    "int nh_dirty_list[256];",
    "int nh_dirty_count = 0;",
    "int nh_message_text[78];",
    "int nh_message_len = 0;",
    "int nh_message_dirty = 0;",
    "void nh_touch(int index){if(index < 0 || index >= NH_CELLS) return; if(nh_frame_full) return; if(nh_cell_dirty[index]) return; if(nh_dirty_count >= NH_DIRTY_MAX){nh_frame_full = 1; return;} nh_cell_dirty[index] = 1; nh_dirty_list[nh_dirty_count] = index; nh_dirty_count = nh_dirty_count + 1;}",
    "void nh_message_char(int character){if(character == 10) character = 32; if(nh_message_len < NH_WIDTH){nh_message_text[nh_message_len] = character; nh_message_len = nh_message_len + 1;} nh_message_dirty = 1;}",
    "void nh_message(char *text){int i = 0; while(text[i] != 0){nh_message_char(text[i]); i = i + 1;}}",
    "void nh_clear_message(){int i = 0; while(i < nh_message_len){nh_touch(i); i = i + 1;} nh_message_len = 0;}",
    "int nh_status_prev[8];",
    "int nh_status_valid = 0;",
    "int nh_status_digits[12];",
    "int nh_wall_glyph(int index){int x = index % NH_WIDTH; int y = index / NH_WIDTH; if(y > 0 && nh_map[index - NH_WIDTH] != 35) return 45; if(y < NH_HEIGHT - 1 && nh_map[index + NH_WIDTH] != 35) return 45; if(x > 0 && nh_map[index - 1] != 35) return 124; if(x < NH_WIDTH - 1 && nh_map[index + 1] != 35) return 124; return 45;}",
    "int nh_wall_lit(int index){int x = index % NH_WIDTH; int y = index / NH_WIDTH; if(y > 0 && nh_visible[index - NH_WIDTH]) return 1; if(y < NH_HEIGHT - 1 && nh_visible[index + NH_WIDTH]) return 1; if(x > 0 && nh_visible[index - 1]) return 1; if(x < NH_WIDTH - 1 && nh_visible[index + 1]) return 1; return 0;}",
    "int nh_map_glyph(int index){int character = nh_map[index]; return character == NH_CORRIDOR ? 35 : character;}",
    "void nh_render_cell(int index){if(index >= 1560) return; int character = 32; int color = 0; if(nh_map[index] == 35){if(nh_explored[index]){character = nh_wall_glyph(index); color = nh_wall_lit(index) ? 0 : 7;}} else if(nh_visible[index]){character = nh_map_glyph(index); color = 0;} else if(nh_explored[index]){character = nh_map_glyph(index); color = 7;} nh_frame[index] = character | (color << 16) | (15 << 20);}",
    "int nh_status_put(int col, int character){if(col < NH_WIDTH) nh_frame[1560 + col] = character | (0 << 16) | (15 << 20); return col + 1;}",
    "int nh_status_label(int col, char *text){int i = 0; while(text[i] != 0){col = nh_status_put(col, text[i]); i = i + 1;} return col;}",
    "int nh_status_number(int col, int value){int count = 0; if(value < 0) value = 0; while(value >= 10){nh_status_digits[count] = value % 10; value = value / 10; count = count + 1;} col = nh_status_put(col, 48 + value); while(count > 0){count = count - 1; col = nh_status_put(col, 48 + nh_status_digits[count]);} return col;}",
    'int nh_status_update(){int stage = nh_hunger / 50; if(stage > 5) stage = 5; int same = nh_status_valid; if(nh_status_prev[0] != nh_depth) same = 0; nh_status_prev[0] = nh_depth; if(nh_status_prev[1] != nh_player_hp) same = 0; nh_status_prev[1] = nh_player_hp; if(nh_status_prev[2] != nh_player_max_hp) same = 0; nh_status_prev[2] = nh_player_max_hp; if(nh_status_prev[3] != nh_player_level) same = 0; nh_status_prev[3] = nh_player_level; if(nh_status_prev[4] != nh_player_xp) same = 0; nh_status_prev[4] = nh_player_xp; if(nh_status_prev[5] != nh_turn) same = 0; nh_status_prev[5] = nh_turn; if(nh_status_prev[6] != stage) same = 0; nh_status_prev[6] = stage; if(nh_status_prev[7] != nh_has_amulet) same = 0; nh_status_prev[7] = nh_has_amulet; nh_status_valid = 1; if(same) return 0; int col = 0; col = nh_status_label(col, "Dlvl:"); col = nh_status_number(col, nh_depth + 1); col = nh_status_label(col, "  HP:"); col = nh_status_number(col, nh_player_hp); col = nh_status_label(col, "("); col = nh_status_number(col, nh_player_max_hp); col = nh_status_label(col, ")  Lv:"); col = nh_status_number(col, nh_player_level); col = nh_status_label(col, "  XP:"); col = nh_status_number(col, nh_player_xp); col = nh_status_label(col, "  T:"); col = nh_status_number(col, nh_turn); if(stage == 1) col = nh_status_label(col, "  Hungry"); else if(stage == 2) col = nh_status_label(col, "  Weak"); else if(stage == 3) col = nh_status_label(col, "  Faint"); else if(stage == 4) col = nh_status_label(col, "  Starving"); else if(stage == 5) col = nh_status_label(col, "  Dying"); if(nh_has_amulet) col = nh_status_label(col, "  Amulet"); while(col < NH_WIDTH) col = nh_status_put(col, 32); return 1;}',
    "void nh_help_line(int row, char *text){int base = row * NH_WIDTH; int i = 0; int done = 0; while(i < NH_WIDTH){int character = 32; if(done == 0){character = text[i]; if(character == 0){done = 1; character = 32;}} nh_frame[base + i] = character | (0 << 16) | (15 << 20); i = i + 1;}}",
    'void nh_show_help(){int row = 0; while(row < NH_HEIGHT){nh_help_line(row, ""); row = row + 1;} nh_help_line(0, "NetHack for CS-Linux - commands"); nh_help_line(2, "  h j k l      move west / south / north / east"); nh_help_line(3, "  y u b n      move diagonally"); nh_help_line(4, "  arrow keys   move"); nh_help_line(5, "  ,            pick up what is here"); nh_help_line(6, "  a            use the first item in your pack"); nh_help_line(7, "  i            count your inventory"); nh_help_line(8, "  < >          climb the stairs you stand on"); nh_help_line(9, "  S            save the game and exit"); nh_help_line(10, "  q or #quit   abandon the game without saving"); nh_help_line(11, "  ?            show this help"); nh_help_line(13, "Fetch the Amulet of Yendor from level 10 and"); nh_help_line(14, "carry it back to the level 1 up staircase."); nh_help_line(16, "Press any key to continue."); int dimensions = NH_WIDTH | (NH_HEIGHT << 16); int cursor = 65536; int attempts = 0; while(attempts < 4){int result = cs_term_present(nh_frame, dimensions, cursor); if(result >= 0) break; if(errno != EAGAIN) break; cs_sleep_ticks(1); attempts = attempts + 1;} cs_key_wait(); nh_frame_full = 1; nh_status_valid = 0; nh_message_dirty = 1;}',
    "void nh_render_overlays(int only_dirty){int item = 0; while(item < NH_ITEMS){if(nh_item_active[item]){int index = nh_item_y[item] * NH_WIDTH + nh_item_x[item]; if((only_dirty == 0 || nh_cell_dirty[index]) && nh_visible[index]){int character = nh_item_type[item] == 24 ? 38 : 33 + (nh_item_type[item] % 10); nh_frame[index] = character | (4 << 16) | (15 << 20);}} item = item + 1;} int monster = 0; while(monster < NH_MONSTERS){if(nh_monster_active[monster]){int index = nh_monster_y[monster] * NH_WIDTH + nh_monster_x[monster]; if((only_dirty == 0 || nh_cell_dirty[index]) && nh_visible[index]) nh_frame[index] = (65 + nh_monster_type[monster]) | (14 << 16) | (15 << 20);} monster = monster + 1;}}",
    "void nh_render(){",
    "int changed = nh_message_dirty; nh_message_dirty = 0;",
    "if(nh_frame_full){int i = 0; while(i < NH_CELLS){nh_render_cell(i); nh_cell_dirty[i] = 0; i = i + 1;} nh_render_overlays(0); nh_dirty_count = 0; nh_frame_full = 0; changed = 1;}",
    "else if(nh_dirty_count > 0){int d = 0; while(d < nh_dirty_count){nh_render_cell(nh_dirty_list[d]); d = d + 1;} nh_render_overlays(1); d = 0; while(d < nh_dirty_count){nh_cell_dirty[nh_dirty_list[d]] = 0; d = d + 1;} nh_dirty_count = 0; changed = 1;}",
    "if(nh_status_update()) changed = 1;",
    "if(changed == 0) return;",
    "nh_frame[nh_player_y * NH_WIDTH + nh_player_x] = 64 | (0 << 16) | (15 << 20);",
    "int col = 0; while(col < nh_message_len){nh_frame[col] = nh_message_text[col] | (0 << 16) | (15 << 20); col = col + 1;}",
    "int cursor = (nh_player_x & 255) | ((nh_player_y & 255) << 8) | 65536; int dimensions = NH_WIDTH | (NH_HEIGHT << 16); int attempts = 0; while(attempts < 4){int result = cs_term_present(nh_frame, dimensions, cursor); if(result >= 0) return; if(errno != EAGAIN) break; cs_sleep_ticks(1); attempts = attempts + 1;} nh_frame_full = 1;",
    "}",
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
    'else if(key == 44) nh_pickup_item(); else if(key == 105){nh_message("Inventory: "); if(nh_inventory_count > 9) nh_message_char(48 + nh_inventory_count / 10); nh_message_char(48 + nh_inventory_count % 10); nh_message(" items");} else if(key == 97) nh_use_item(); else if(key == 63) nh_show_help();',
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
    "int nh_pack_entity(int active, int type, int x, int y){return (active & 1) | ((type & 31) << 1) | ((x & 127) << 6) | ((y & 31) << 13);}",
    'int nh_paths(){char *home = getenv("HOME"); if(home == (char *)0 || home[0] != 47) return -1; int length = strlen(home); if(length < 1 || length > 220) return -1; int i = 0; while(i < length){if(home[i] == 46 && home[i + 1] == 46) return -1; nh_save_path[i] = home[i]; nh_temp_path[i] = home[i]; i = i + 1;} char *tail = "/.nethack.sav"; int j = 0; while(tail[j] != 0){nh_save_path[i + j] = tail[j]; nh_temp_path[i + j] = tail[j]; j = j + 1;} nh_save_path[i + j] = 0; char *suffix = ".tmp"; int k = 0; while(suffix[k] != 0){nh_temp_path[i + j + k] = suffix[k]; k = k + 1;} nh_temp_path[i + j + k] = 0; return 0;}',
    "void nh_encode(){nh_store_level(); int i = 0; int level = 0; int bit = 0; int packed = 0; int offset = 0; nh_save_words[0] = 67; nh_save_words[1] = 83; nh_save_words[2] = 78; nh_save_words[3] = 72; nh_save_words[4] = 2; nh_save_words[5] = nh_rng_state; nh_save_words[6] = nh_turn; nh_save_words[7] = nh_depth; nh_save_words[8] = nh_player_hp; nh_save_words[9] = nh_player_max_hp; nh_save_words[10] = nh_player_xp; nh_save_words[11] = nh_player_level; nh_save_words[12] = nh_hunger; nh_save_words[13] = nh_has_amulet; nh_save_words[14] = nh_player_x; nh_save_words[15] = nh_player_y; nh_save_words[16] = nh_weapon_bonus; nh_save_words[17] = nh_armor_bonus; nh_save_words[18] = nh_inventory_count; nh_copy_words(nh_save_words + 19, nh_inventory_type, NH_INVENTORY); nh_copy_words(nh_save_words + 35, nh_inventory_qty, NH_INVENTORY); nh_copy_words(nh_save_words + 51, nh_level_seed, NH_LEVELS); nh_copy_words(nh_save_words + 61, nh_level_visited, NH_LEVELS); nh_copy_words(nh_save_words + 71, nh_level_player_x, NH_LEVELS); nh_copy_words(nh_save_words + 81, nh_level_player_y, NH_LEVELS); level = 0; while(level < NH_LEVELS){offset = 91 + level * 82; bit = 0; while(bit < 82){packed = 0; i = 0; while(i < 20){int cell = bit * 20 + i; if(cell < NH_CELLS && nh_level_explored[level * NH_CELLS + cell]) packed = packed | (1 << i); i = i + 1;} nh_save_words[offset + bit] = packed; bit = bit + 1;} level = level + 1;} offset = 911; level = 0; while(level < NH_LEVELS){i = 0; while(i < NH_MONSTERS){int base = level * NH_MONSTERS + i; nh_save_words[offset] = nh_pack_entity(nh_level_monster_active[base], nh_level_monster_type[base], nh_level_monster_x[base], nh_level_monster_y[base]); nh_save_words[offset + 1] = nh_level_monster_hp[base]; offset = offset + 2; i = i + 1;} i = 0; while(i < NH_ITEMS){int base_item = level * NH_ITEMS + i; nh_save_words[offset] = nh_pack_entity(nh_level_item_active[base_item], nh_level_item_type[base_item], nh_level_item_x[base_item], nh_level_item_y[base_item]); offset = offset + 1; i = i + 1;} level = level + 1;}}",
    "int nh_save(){if(nh_paths() != 0){errno = EINVAL; return -1;} nh_encode(); int fd = cs_open(nh_temp_path, CS_O_WRITE | CS_O_CREATE | CS_O_TRUNCATE, 384); if(fd < 0) return -1; int offset = 0; while(offset < NH_SAVE_WORDS){int chunk = NH_SAVE_WORDS - offset; if(chunk > 16) chunk = 16; int written = cs_write(fd, nh_save_words + offset, chunk); if(written != chunk){cs_close(fd); cs_remove(nh_temp_path); return -1;} offset = offset + chunk;} if(cs_close(fd) != 0){cs_remove(nh_temp_path); return -1;} if(cs_rename(nh_temp_path, nh_save_path) != 0){cs_remove(nh_temp_path); return -1;} return 0;}",
    'int nh_load(){if(nh_paths() != 0) return -1; int fd = cs_open(nh_save_path, CS_O_READ, 0); if(fd < 0) return -1; int count = cs_read(fd, nh_save_words, NH_SAVE_WORDS); int closed = cs_close(fd); if(count != NH_SAVE_WORDS || closed != 0 || nh_save_words[0] != 67 || nh_save_words[1] != 83 || nh_save_words[2] != 78 || nh_save_words[3] != 72 || nh_save_words[4] != 2){fputs("nethack: corrupt or unsupported save\\n", stderr); return -1;} nh_rng_state = nh_save_words[5]; nh_turn = nh_save_words[6]; nh_depth = nh_save_words[7]; nh_player_hp = nh_save_words[8]; nh_player_max_hp = nh_save_words[9]; nh_player_xp = nh_save_words[10]; nh_player_level = nh_save_words[11]; nh_hunger = nh_save_words[12]; nh_has_amulet = nh_save_words[13]; nh_player_x = nh_save_words[14]; nh_player_y = nh_save_words[15]; nh_weapon_bonus = nh_save_words[16]; nh_armor_bonus = nh_save_words[17]; nh_inventory_count = nh_save_words[18]; int i = 0; nh_copy_words(nh_inventory_type, nh_save_words + 19, NH_INVENTORY); nh_copy_words(nh_inventory_qty, nh_save_words + 35, NH_INVENTORY); nh_copy_words(nh_level_seed, nh_save_words + 51, NH_LEVELS); nh_copy_words(nh_level_visited, nh_save_words + 61, NH_LEVELS); nh_copy_words(nh_level_player_x, nh_save_words + 71, NH_LEVELS); nh_copy_words(nh_level_player_y, nh_save_words + 81, NH_LEVELS); int level = 0; int offset = 0; int bit = 0; while(level < NH_LEVELS){offset = 91 + level * 82; bit = 0; while(bit < 82){int word = nh_save_words[offset + bit]; i = 0; while(i < 20){int cell = bit * 20 + i; if(cell < NH_CELLS) nh_level_explored[level * NH_CELLS + cell] = (word >> i) & 1; i = i + 1;} bit = bit + 1;} level = level + 1;} offset = 911; level = 0; while(level < NH_LEVELS){i = 0; while(i < NH_MONSTERS){int base = level * NH_MONSTERS + i; int packed_monster = nh_save_words[offset]; nh_level_monster_active[base] = packed_monster & 1; nh_level_monster_type[base] = (packed_monster >> 1) & 31; nh_level_monster_x[base] = (packed_monster >> 6) & 127; nh_level_monster_y[base] = (packed_monster >> 13) & 31; nh_level_monster_hp[base] = nh_save_words[offset + 1]; offset = offset + 2; i = i + 1;} i = 0; while(i < NH_ITEMS){int base_item = level * NH_ITEMS + i; int packed_item = nh_save_words[offset]; nh_level_item_active[base_item] = packed_item & 1; nh_level_item_type[base_item] = (packed_item >> 1) & 31; nh_level_item_x[base_item] = (packed_item >> 6) & 127; nh_level_item_y[base_item] = (packed_item >> 13) & 31; offset = offset + 1; i = i + 1;} level = level + 1;} nh_monsters_restore(); nh_items_restore(); return 0;}',
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
    if (index === 3 * 78 + 3) return 64 | (0 << 16) | (15 << 20);
    return explored[index] === 1
      ? character | (7 << 16) | (15 << 20)
      : 32 | (15 << 20);
  });
}
