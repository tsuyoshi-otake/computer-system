import type { FilesystemBaseImageFile } from "../../domain/filesystem/inMemoryFilesystem.js";
import {
  createCs486Archive,
  parseCs486ArchiveWithTrustedIntegrity,
  serializeCs486Archive,
  type Cs486Archive,
} from "../toolchain/cs486Archive.js";
import { compileCs486Object } from "../toolchain/highLevelCompilers.js";
import {
  cs486Byte8DataModel,
  cs486Word32DataModel,
  legacyCs486WordDataModel,
  type Cs486DataModel,
} from "../../domain/cpu/cs486Compatibility.js";
import {
  validateCs486Object,
  type Cs486Object,
} from "../../domain/cpu/cs486Object.js";
import { sha256Hex } from "../../domain/crypto/sha256.js";
import { hostedCArchiveContents } from "./generated/hostedCArchiveContents.js";

const metadata = Object.freeze({ gid: 0, mode: 0o644, uid: 0 });
const installedHostedObjectCache = new WeakMap<
  object,
  Map<string, Cs486Object>
>();
const trustedHostedArchiveContents = new Set<string>(
  Object.values(hostedCArchiveContents),
);
const trustedHostedArchiveCache = new Map<string, Cs486Archive>();

/**
 * Returns a cached parsed archive only after an exact byte-for-byte match with
 * a generated rootfs payload. Mutable guest archives retain full SHA-256
 * verification through parseCs486Archive.
 */
export function parseInstalledHostedCArchive(
  contents: string,
): Cs486Archive | undefined {
  if (!trustedHostedArchiveContents.has(contents)) return undefined;
  const cached = trustedHostedArchiveCache.get(contents);
  if (cached !== undefined) return cached;
  const archive = parseCs486ArchiveWithTrustedIntegrity(contents);
  trustedHostedArchiveCache.set(contents, archive);
  return archive;
}

function sourceFile(
  path: string,
  lines: readonly string[],
): FilesystemBaseImageFile {
  return Object.freeze({
    contents: `${lines.join("\n")}\n`,
    metadata,
    path,
  });
}

export const hostedCLibcV16Directories = Object.freeze([
  "/usr/include/cs",
  "/usr/src",
  "/usr/src/cs-libc",
]);

export const hostedCLibcV17Directories = Object.freeze([
  ...hostedCLibcV16Directories,
  "/usr/include/sys",
  "/usr/src/libcs-curses",
]);

export const hostedCLibcV18Directories = Object.freeze([
  ...hostedCLibcV17Directories,
  "/usr/lib/cs-byte8-v1",
  "/usr/lib/cs-word32-v1",
]);

export const hostedCLibcDirectories = Object.freeze([
  ...hostedCLibcV18Directories,
  "/usr/src/cs-libm",
]);

function buildStdargHeader(includeWideArguments: boolean): readonly string[] {
  return [
    "#ifndef CS_STDARG_H",
    "#define CS_STDARG_H 1",
    "struct __cs_va_list { int *next; int remaining; };",
    "typedef struct __cs_va_list va_list;",
    "void __cs_va_start(void *list);",
    includeWideArguments
      ? "void *__cs_va_arg(void *list, int words);"
      : "void *__cs_va_arg(void *list);",
    "#define va_start(list, last) __cs_va_start(&(list))",
    ...(includeWideArguments
      ? [
          "#ifdef __CS_BYTE8__",
          "#define __CS_VA_WORDS(type) ((sizeof(type) + 3) / 4)",
          "#else",
          "#define __CS_VA_WORDS(type) sizeof(type)",
          "#endif",
          "#define va_arg(list, type) (*(type *)__cs_va_arg(&(list), __CS_VA_WORDS(type)))",
        ]
      : ["#define va_arg(list, type) (*(type *)__cs_va_arg(&(list)))"]),
    "#define va_copy(destination, source) do { (destination).next = (source).next; (destination).remaining = (source).remaining; } while (0)",
    "#define va_end(list) do { (list).next = (int *)0; (list).remaining = 0; } while (0)",
    "#endif",
  ];
}

/**
 * CS-Linux hosted-C headers and their guest-buildable libc baseline.
 *
 * These are source artifacts, not a host implementation: every non-intrinsic
 * function below is compiled by the sandboxed guest `cc` into CS486OBJ.
 */
const hostedCLibcSourceFiles: readonly FilesystemBaseImageFile[] =
  Object.freeze([
    sourceFile("/usr/include/cs/syscall.h", [
      "#ifndef CS_SYSCALL_H",
      "#define CS_SYSCALL_H 1",
      "#define CS_SYS_EXIT 0",
      "#define CS_SYS_TERM_SIZE 1",
      "#define CS_SYS_TERM_PRESENT 2",
      "#define CS_SYS_KEY_WAIT 3",
      "#define CS_SYS_KEY_POLL 4",
      "#define CS_SYS_CLOCK_TICKS 5",
      "#define CS_SYS_SLEEP_TICKS 6",
      "#define CS_SYS_HEAP_INFO 7",
      "#define CS_SYS_FS_OPEN 8",
      "#define CS_SYS_FS_READ 9",
      "#define CS_SYS_FS_WRITE 10",
      "#define CS_SYS_FS_SEEK 11",
      "#define CS_SYS_FS_STAT 12",
      "#define CS_SYS_FS_CLOSE 13",
      "#define CS_SYS_FS_REMOVE 14",
      "#define CS_SYS_FS_RENAME 15",
      "int __cs_syscall(int selector, int argument0, int argument1, int argument2);",
      "#endif",
    ]),
    sourceFile("/usr/include/cs/errno.h", [
      "#ifndef CS_ERRNO_VALUES_H",
      "#define CS_ERRNO_VALUES_H 1",
      "#define EPERM 1",
      "#define ENOENT 2",
      "#define EIO 5",
      "#define EBADF 9",
      "#define EAGAIN 11",
      "#define ENOMEM 12",
      "#define EACCES 13",
      "#define EFAULT 14",
      "#define EEXIST 17",
      "#define EINVAL 22",
      "#define EMFILE 24",
      "#define ENOSPC 28",
      "#define EDOM 33",
      "#define ERANGE 34",
      "#endif",
    ]),
    sourceFile("/usr/include/cs/term.h", [
      "#ifndef CS_TERM_H",
      "#define CS_TERM_H 1",
      "#define CS_KEY_UP 257",
      "#define CS_KEY_LEFT 258",
      "#define CS_KEY_RIGHT 259",
      "#define CS_KEY_DOWN 260",
      "#define CS_KEY_DELETE 261",
      "#define CS_KEY_END 262",
      "#define CS_KEY_HOME 263",
      "#define CS_KEY_PAGE_DOWN 264",
      "#define CS_KEY_PAGE_UP 265",
      "int cs_term_size(void);",
      "int cs_term_present(int *framebuffer, int dimensions, int cursor);",
      "int cs_key_wait(void);",
      "int cs_key_poll(void);",
      "int cs_clock_ticks(void);",
      "int cs_sleep_ticks(int ticks);",
      "#endif",
    ]),
    sourceFile("/usr/include/cs/fs.h", [
      "#ifndef CS_FS_H",
      "#define CS_FS_H 1",
      "#define CS_O_READ 1",
      "#define CS_O_WRITE 2",
      "#define CS_O_CREATE 4",
      "#define CS_O_TRUNCATE 8",
      "#define CS_O_APPEND 16",
      "#define CS_SEEK_SET 0",
      "#define CS_SEEK_CUR 1",
      "#define CS_SEEK_END 2",
      "struct cs_stat { int kind; int size; int mode; int mtime; };",
      "int cs_open(char *path, int flags, int mode);",
      "/* Counts are bytes under cs-byte8-v1 and word characters under cs-word32-v1. */",
      "#ifdef __CS_BYTE8__",
      "#define CS_IO_UNIT_BITS 8",
      "#else",
      "#define CS_IO_UNIT_BITS 32",
      "#endif",
      "int cs_read(int descriptor, void *buffer, int units);",
      "int cs_write(int descriptor, void *buffer, int units);",
      "int cs_seek(int descriptor, int offset, int whence);",
      "int cs_stat(char *path, struct cs_stat *result);",
      "int cs_close(int descriptor);",
      "int cs_remove(char *path);",
      "int cs_rename(char *from, char *to);",
      "#endif",
    ]),
    sourceFile("/usr/include/cs/byte.h", [
      "#ifndef CS_BYTE_H",
      "#define CS_BYTE_H 1",
      "#define CS_BYTE_MASK 255U",
      "#ifdef __CS_BYTE8__",
      "typedef unsigned char cs_byte_storage_t;",
      "#define CS_BYTE_STORAGE_UNITS(count) (count)",
      "#define cs_byte_load(buffer, index) ((unsigned int)((buffer)[(index)]))",
      "#define cs_byte_store(buffer, index, value) do { (buffer)[(index)] = (unsigned char)((value) & CS_BYTE_MASK); } while (0)",
      "#else",
      "/* Word-profile blobs use four packed octets per unsigned-int storage unit. */",
      "typedef unsigned int cs_byte_storage_t;",
      "#define CS_BYTE_STORAGE_UNITS(count) (((count) + 3U) / 4U)",
      "#define cs_byte_load(buffer, index) (((buffer)[(index) / 4U] >> (((index) & 3U) * 8U)) & CS_BYTE_MASK)",
      "#define cs_byte_store(buffer, index, value) do { unsigned int __cs_byte_shift = ((index) & 3U) * 8U; unsigned int __cs_byte_slot = (index) / 4U; (buffer)[__cs_byte_slot] = ((buffer)[__cs_byte_slot] & ~(CS_BYTE_MASK << __cs_byte_shift)) | (((value) & CS_BYTE_MASK) << __cs_byte_shift); } while (0)",
      "#endif",
      "#endif",
    ]),
    sourceFile("/usr/include/cs/posix.h", [
      "#ifndef CS_POSIX_H",
      "#define CS_POSIX_H 1",
      "#include <cs/syscall.h>",
      "#define CS_SYS_WALL_TIME 16",
      "#define CS_SYS_FS_GETCWD 17",
      "#define CS_SYS_FS_CHDIR 18",
      "#define CS_SYS_FS_MKDIR 19",
      "#define CS_SYS_FS_RMDIR 20",
      "#define CS_SYS_FS_ACCESS 21",
      "#define CS_SYS_FS_OPENDIR 22",
      "#define CS_SYS_FS_READDIR 23",
      "#define CS_SYS_FS_CLOSEDIR 24",
      "#define CS_SYS_FS_STAT_EXTENDED 25",
      "#define CS_O_EXCLUSIVE 32",
      "int cs_wall_time(void);",
      "int cs_getcwd(char *buffer, int words);",
      "int cs_chdir(char *path);",
      "int cs_mkdir(char *path, int mode);",
      "int cs_rmdir(char *path);",
      "int cs_access(char *path, int mode);",
      "int cs_opendir(char *path);",
      "int cs_readdir(int descriptor, char *name, int words);",
      "int cs_closedir(int descriptor);",
      "int cs_stat_extended(char *path, void *result);",
      "#endif",
    ]),
    sourceFile("/usr/include/stddef.h", [
      "#ifndef CS_STDDEF_H",
      "#define CS_STDDEF_H 1",
      "typedef unsigned int size_t;",
      "typedef long ptrdiff_t;",
      "#define NULL 0",
      "#define SIZE_MAX 4294967295U",
      "#define PTRDIFF_MIN (-2147483647L - 1L)",
      "#define PTRDIFF_MAX 2147483647L",
      "#define offsetof(type, member) ((size_t)&(((type *)0)->member))",
      "#endif",
    ]),
    sourceFile("/usr/include/limits.h", [
      "#ifndef CS_LIMITS_H",
      "#define CS_LIMITS_H 1",
      "#ifdef __CS_BYTE8__",
      "#define CHAR_BIT 8",
      "#define CHAR_MIN (-127 - 1)",
      "#define CHAR_MAX 127",
      "#define SCHAR_MIN (-127 - 1)",
      "#define SCHAR_MAX 127",
      "#define UCHAR_MAX 255U",
      "#define SHRT_MIN (-32767 - 1)",
      "#define SHRT_MAX 32767",
      "#define USHRT_MAX 65535U",
      "#else",
      "#define CHAR_BIT 32",
      "#define CHAR_MIN (-2147483647 - 1)",
      "#define CHAR_MAX 2147483647",
      "#define SCHAR_MIN (-2147483647 - 1)",
      "#define SCHAR_MAX 2147483647",
      "#define UCHAR_MAX 4294967295U",
      "#define SHRT_MIN (-2147483647 - 1)",
      "#define SHRT_MAX 2147483647",
      "#define USHRT_MAX 4294967295U",
      "#endif",
      "#define INT_MIN (-2147483647 - 1)",
      "#define INT_MAX 2147483647",
      "#define UINT_MAX 4294967295U",
      "#define LONG_MIN ((long)(-2147483647 - 1))",
      "#define LONG_MAX ((long)2147483647)",
      "#define ULONG_MAX 4294967295UL",
      "#define LLONG_MIN (-9223372036854775807LL - 1LL)",
      "#define LLONG_MAX 9223372036854775807LL",
      "#define ULLONG_MAX 18446744073709551615ULL",
      "#endif",
    ]),
    sourceFile("/usr/include/stdint.h", [
      "#ifndef CS_STDINT_H",
      "#define CS_STDINT_H 1",
      "#ifdef __CS_BYTE8__",
      "typedef signed char int8_t;",
      "typedef unsigned char uint8_t;",
      "typedef short int16_t;",
      "typedef unsigned short uint16_t;",
      "#define INT8_MIN (-127 - 1)",
      "#define INT8_MAX 127",
      "#define UINT8_MAX 255U",
      "#define INT16_MIN (-32767 - 1)",
      "#define INT16_MAX 32767",
      "#define UINT16_MAX 65535U",
      "typedef signed char int_least8_t;",
      "typedef unsigned char uint_least8_t;",
      "typedef short int_least16_t;",
      "typedef unsigned short uint_least16_t;",
      "typedef int int_fast8_t;",
      "typedef unsigned int uint_fast8_t;",
      "typedef int int_fast16_t;",
      "typedef unsigned int uint_fast16_t;",
      "#define INT_LEAST8_MIN INT8_MIN",
      "#define INT_LEAST8_MAX INT8_MAX",
      "#define UINT_LEAST8_MAX UINT8_MAX",
      "#define INT_LEAST16_MIN INT16_MIN",
      "#define INT_LEAST16_MAX INT16_MAX",
      "#define UINT_LEAST16_MAX UINT16_MAX",
      "#define INT_FAST8_MIN INT32_MIN",
      "#define INT_FAST8_MAX INT32_MAX",
      "#define UINT_FAST8_MAX UINT32_MAX",
      "#define INT_FAST16_MIN INT32_MIN",
      "#define INT_FAST16_MAX INT32_MAX",
      "#define UINT_FAST16_MAX UINT32_MAX",
      "#else",
      "/* The CS word profile has no exact 8-bit or 16-bit integer type. */",
      "#endif",
      "typedef int int32_t;",
      "typedef unsigned int uint32_t;",
      "typedef long long int64_t;",
      "typedef unsigned long long uint64_t;",
      "typedef long int_least32_t;",
      "typedef unsigned long uint_least32_t;",
      "typedef long int_fast32_t;",
      "typedef unsigned long uint_fast32_t;",
      "typedef long intptr_t;",
      "typedef unsigned long uintptr_t;",
      "typedef long long intmax_t;",
      "typedef unsigned long long uintmax_t;",
      "#define INT32_MIN (-2147483647 - 1)",
      "#define INT32_MAX 2147483647",
      "#define UINT32_MAX 4294967295U",
      "#define INT_LEAST32_MIN INT32_MIN",
      "#define INT_LEAST32_MAX INT32_MAX",
      "#define UINT_LEAST32_MAX UINT32_MAX",
      "#define INT_FAST32_MIN INT32_MIN",
      "#define INT_FAST32_MAX INT32_MAX",
      "#define UINT_FAST32_MAX UINT32_MAX",
      "#define INT64_MIN (-9223372036854775807LL - 1LL)",
      "#define INT64_MAX 9223372036854775807LL",
      "#define UINT64_MAX 18446744073709551615ULL",
      "#define INTPTR_MIN (-2147483647L - 1L)",
      "#define INTPTR_MAX 2147483647L",
      "#define UINTPTR_MAX 4294967295UL",
      "#define INTMAX_MIN INT64_MIN",
      "#define INTMAX_MAX INT64_MAX",
      "#define UINTMAX_MAX UINT64_MAX",
      "#endif",
    ]),
    sourceFile("/usr/include/stdbool.h", [
      "#ifndef CS_STDBOOL_H",
      "#define CS_STDBOOL_H 1",
      "#define bool _Bool",
      "#define true 1",
      "#define false 0",
      "#define __bool_true_false_are_defined 1",
      "#endif",
    ]),
    sourceFile("/usr/include/stdalign.h", [
      "#ifndef CS_STDALIGN_H",
      "#define CS_STDALIGN_H 1",
      "#define alignas _Alignas",
      "#define alignof _Alignof",
      "#define __alignas_is_defined 1",
      "#define __alignof_is_defined 1",
      "#endif",
    ]),
    sourceFile("/usr/include/stdarg.h", buildStdargHeader(true)),
    sourceFile("/usr/include/assert.h", [
      "#ifndef CS_ASSERT_H",
      "#define CS_ASSERT_H 1",
      "void __cs_assert_fail(void);",
      "#define assert(expression) do { if (!(expression)) __cs_assert_fail(); } while (0)",
      "#endif",
    ]),
    sourceFile("/usr/include/ctype.h", [
      "#ifndef CS_CTYPE_H",
      "#define CS_CTYPE_H 1",
      "int isalnum(int value);",
      "int isalpha(int value);",
      "int isdigit(int value);",
      "int islower(int value);",
      "int isspace(int value);",
      "int isupper(int value);",
      "int tolower(int value);",
      "int toupper(int value);",
      "#endif",
    ]),
    sourceFile("/usr/include/errno.h", [
      "#ifndef CS_ERRNO_H",
      "#define CS_ERRNO_H 1",
      "#include <cs/errno.h>",
      "extern int errno;",
      "#endif",
    ]),
    sourceFile("/usr/include/float.h", buildFloatHeader()),
    sourceFile("/usr/include/math.h", buildMathHeader()),
    sourceFile("/usr/include/string.h", [
      "#ifndef CS_STRING_H",
      "#define CS_STRING_H 1",
      "#include <stddef.h>",
      "size_t strlen(char *value);",
      "char *strcpy(char *destination, char *source);",
      "char *strncpy(char *destination, char *source, size_t count);",
      "int strcmp(char *left, char *right);",
      "int memcmp(void *left, void *right, size_t count);",
      "void *memchr(void *value, int character, size_t count);",
      "void *memcpy(void *destination, void *source, size_t count);",
      "void *memmove(void *destination, void *source, size_t count);",
      "void *memset(void *destination, int value, size_t count);",
      "size_t strnlen(char *value, size_t count);",
      "int strncmp(char *left, char *right, size_t count);",
      "char *strchr(char *value, int character);",
      "char *strrchr(char *value, int character);",
      "char *strstr(char *value, char *needle);",
      "#endif",
    ]),
    sourceFile("/usr/include/stdlib.h", [
      "#ifndef CS_STDLIB_H",
      "#define CS_STDLIB_H 1",
      "#include <stddef.h>",
      "void *malloc(size_t words);",
      "void *calloc(size_t count, size_t words);",
      "void *realloc(void *pointer, size_t words);",
      "void free(void *pointer);",
      "long strtol(char *text, char **end, int base);",
      "unsigned long strtoul(char *text, char **end, int base);",
      "char *getenv(char *name);",
      "int atoi(char *text);",
      "int abs(int value);",
      "long labs(long value);",
      "struct div_t { int quot; int rem; };",
      "typedef struct div_t div_t;",
      "int div(int numerator, int denominator, div_t *result);",
      "void qsort(void *base, size_t count, size_t words, int (*compare)(void *, void *));",
      "void *bsearch(void *key, void *base, size_t count, size_t words, int (*compare)(void *, void *));",
      "typedef void (*cs_atexit_handler)(void);",
      "int atexit(cs_atexit_handler handler);",
      "void abort(void);",
      "void exit(int status);",
      "int rand(void);",
      "void srand(int seed);",
      "#endif",
    ]),
    sourceFile("/usr/include/stdio.h", [
      "#ifndef CS_STDIO_H",
      "#define CS_STDIO_H 1",
      "#include <stddef.h>",
      "#include <stdarg.h>",
      "#define EOF (-1)",
      "#define SEEK_SET 0",
      "#define SEEK_CUR 1",
      "#define SEEK_END 2",
      "struct __cs_FILE { int descriptor; int end; int error; };",
      "typedef struct __cs_FILE FILE;",
      "FILE *__cs_stdin_stream();",
      "FILE *__cs_stdout_stream();",
      "FILE *__cs_stderr_stream();",
      "#define stdin (__cs_stdin_stream())",
      "#define stdout (__cs_stdout_stream())",
      "#define stderr (__cs_stderr_stream())",
      "FILE *fopen(char *path, char *mode);",
      "int fclose(FILE *stream);",
      "size_t fread(void *pointer, size_t size, size_t count, FILE *stream);",
      "size_t fwrite(void *pointer, size_t size, size_t count, FILE *stream);",
      "int fseek(FILE *stream, long offset, int whence);",
      "long ftell(FILE *stream);",
      "int fgetc(FILE *stream);",
      "int fputc(int value, FILE *stream);",
      "char *fgets(char *value, int count, FILE *stream);",
      "int fputs(char *value, FILE *stream);",
      "int feof(FILE *stream);",
      "int ferror(FILE *stream);",
      "void clearerr(FILE *stream);",
      "int fflush(FILE *stream);",
      "void rewind(FILE *stream);",
      "int remove(char *path);",
      "int rename(char *from, char *to);",
      "void perror(char *prefix);",
      "int printf(char *format, ...);",
      "int fprintf(FILE *stream, char *format, ...);",
      "int snprintf(char *buffer, size_t size, char *format, ...);",
      "int vsnprintf(char *buffer, size_t size, char *format, va_list *list);",
      "#endif",
    ]),
    sourceFile("/usr/include/unistd.h", [
      "#ifndef CS_UNISTD_H",
      "#define CS_UNISTD_H 1",
      "#include <stddef.h>",
      "#define F_OK 0",
      "#define X_OK 1",
      "#define W_OK 2",
      "#define R_OK 4",
      "#define PATH_MAX 256",
      "char *getcwd(char *buffer, size_t words);",
      "int chdir(char *path);",
      "int access(char *path, int mode);",
      "int unlink(char *path);",
      "int rmdir(char *path);",
      "int mkstemp(char *pattern);",
      "#endif",
    ]),
    sourceFile("/usr/include/sys/stat.h", [
      "#ifndef CS_SYS_STAT_H",
      "#define CS_SYS_STAT_H 1",
      "struct stat { int st_kind; int st_size; int st_mode; int st_mtime; int st_uid; int st_gid; int st_nlink; };",
      "#define S_IFREG 1",
      "#define S_IFDIR 2",
      "int stat(char *path, struct stat *result);",
      "int mkdir(char *path, int mode);",
      "#endif",
    ]),
    sourceFile("/usr/include/dirent.h", [
      "#ifndef CS_DIRENT_H",
      "#define CS_DIRENT_H 1",
      "#define CS_NAME_MAX 255",
      "struct dirent { char d_name[256]; };",
      "struct __cs_DIR { int descriptor; struct dirent entry; };",
      "typedef struct __cs_DIR DIR;",
      "DIR *opendir(char *path);",
      "struct dirent *readdir(DIR *directory);",
      "int closedir(DIR *directory);",
      "#endif",
    ]),
    sourceFile("/usr/include/time.h", [
      "#ifndef CS_TIME_H",
      "#define CS_TIME_H 1",
      "typedef long time_t;",
      "typedef long clock_t;",
      "#define CLOCKS_PER_SEC 20",
      "clock_t clock(void);",
      "time_t time(time_t *result);",
      "#endif",
    ]),
    sourceFile("/usr/include/signal.h", [
      "#ifndef CS_SIGNAL_H",
      "#define CS_SIGNAL_H 1",
      "typedef void (*cs_sighandler_t)(int);",
      "#define SIG_DFL ((cs_sighandler_t)0)",
      "#define SIG_IGN ((cs_sighandler_t)1)",
      "#define SIGHUP 1",
      "#define SIGINT 2",
      "#define SIGKILL 9",
      "#define SIGTERM 15",
      "#define SIGCONT 18",
      "#define SIGSTOP 19",
      "cs_sighandler_t signal(int signal_number, cs_sighandler_t handler);",
      "int raise(int signal_number);",
      "#endif",
    ]),
    sourceFile("/usr/include/getopt.h", [
      "#ifndef CS_GETOPT_H",
      "#define CS_GETOPT_H 1",
      "extern char *optarg;",
      "extern int optind;",
      "extern int opterr;",
      "extern int optopt;",
      "struct option { char *name; int has_arg; int *flag; int val; };",
      "#define no_argument 0",
      "#define required_argument 1",
      "#define optional_argument 2",
      "int getopt(int argc, char **argv, char *options);",
      "int getopt_long(int argc, char **argv, char *options, struct option *long_options, int *long_index);",
      "#endif",
    ]),
    sourceFile("/usr/include/curses.h", buildCursesHeader()),
    sourceFile(
      "/usr/src/cs-libc/libc.c",
      buildLibcSource(true, true, true, true).split("\n"),
    ),
    sourceFile("/usr/src/libcs-curses/curses.c", buildCursesSource()),
    sourceFile("/usr/src/cs-libm/libm.c", buildLibmSource().split("\n")),
    sourceFile("/usr/src/cs-libm/README", [
      "CS deterministic libm 1.0 guest source",
      "Build with: cc -c /usr/src/cs-libm/libm.c -o libm.o",
      "Link with: cc program.c -lm -o program.csx",
      "binary32/binary64 operations are bounded software helpers in the admitted CS486 process.",
      "Round-to-nearest ties-to-even, signed zero, subnormals, infinities, and canonical quiet NaNs are stable.",
      "This first profile intentionally omits trigonometric, exponential, logarithmic, pow, complex, fenv, and long-double extended precision.",
    ]),
    sourceFile("/usr/src/libcs-curses/README", [
      "libcs-curses 1.0 guest source",
      "Build with: cc -c /usr/src/libcs-curses/curses.c -o curses.o",
      "Fixed 80x25 maximum, eight windows, sixteen color pairs, one batched refresh.",
    ]),
    sourceFile("/usr/src/cs-libc/README", [
      "CS-Linux libc 1.0 guest source",
      "Build the default word profile with: cc -c /usr/src/cs-libc/libc.c -o libc.o",
      "Build the byte profile with: cc -mbyte8 -c /usr/src/cs-libc/libc.c -o libc.o",
      "cc selects the matching /usr/lib/<data-model>/libc.csa archive.",
      "cs-word32-v1 uses 32-bit char units; cs-byte8-v1 uses 8-bit char units.",
      "long long and unsigned long long occupy two little-endian 32-bit words.",
    ]),
  ]);

type HostedCArchiveKey = keyof typeof hostedCArchiveContents;

interface HostedCArchiveDescriptor {
  readonly dataModel: Cs486DataModel;
  readonly key: HostedCArchiveKey;
  readonly legacy?: true;
  readonly memberName: string;
  readonly paths: readonly string[];
  readonly sourceFiles: readonly FilesystemBaseImageFile[];
  readonly sourcePath: string;
}

const hostedCLibcArchiveDescriptors: readonly HostedCArchiveDescriptor[] =
  Object.freeze([
    {
      dataModel: cs486Word32DataModel,
      key: "v19:word32:libc",
      memberName: "libc.o",
      paths: ["/usr/lib/libc.csa", "/usr/lib/cs-word32-v1/libc.csa"],
      sourceFiles: hostedCLibcSourceFiles,
      sourcePath: "/usr/src/cs-libc/libc.c",
    },
    {
      dataModel: cs486Word32DataModel,
      key: "v19:word32:libcurses",
      memberName: "curses.o",
      paths: ["/usr/lib/libcurses.csa", "/usr/lib/cs-word32-v1/libcurses.csa"],
      sourceFiles: hostedCLibcSourceFiles,
      sourcePath: "/usr/src/libcs-curses/curses.c",
    },
    {
      dataModel: cs486Word32DataModel,
      key: "v19:word32:libm",
      memberName: "libm.o",
      paths: ["/usr/lib/libm.csa", "/usr/lib/cs-word32-v1/libm.csa"],
      sourceFiles: hostedCLibcSourceFiles,
      sourcePath: "/usr/src/cs-libm/libm.c",
    },
    {
      dataModel: cs486Byte8DataModel,
      key: "v19:byte8:libc",
      memberName: "libc.o",
      paths: ["/usr/lib/cs-byte8-v1/libc.csa"],
      sourceFiles: hostedCLibcSourceFiles,
      sourcePath: "/usr/src/cs-libc/libc.c",
    },
    {
      dataModel: cs486Byte8DataModel,
      key: "v19:byte8:libcurses",
      memberName: "curses.o",
      paths: ["/usr/lib/cs-byte8-v1/libcurses.csa"],
      sourceFiles: hostedCLibcSourceFiles,
      sourcePath: "/usr/src/libcs-curses/curses.c",
    },
    {
      dataModel: cs486Byte8DataModel,
      key: "v19:byte8:libm",
      memberName: "libm.o",
      paths: ["/usr/lib/cs-byte8-v1/libm.csa"],
      sourceFiles: hostedCLibcSourceFiles,
      sourcePath: "/usr/src/cs-libm/libm.c",
    },
  ]);

export const hostedCLibcFiles: readonly FilesystemBaseImageFile[] =
  Object.freeze([
    ...hostedCLibcSourceFiles,
    ...installedArchiveFiles(hostedCLibcArchiveDescriptors),
  ]);

const hostedCLibcV19OnlyPaths = new Set([
  "/usr/include/float.h",
  "/usr/include/math.h",
  "/usr/lib/libm.csa",
  "/usr/lib/cs-byte8-v1/libm.csa",
  "/usr/lib/cs-word32-v1/libm.csa",
  "/usr/src/cs-libm/libm.c",
  "/usr/src/cs-libm/README",
]);

const hostedCLibcV18Replacements = new Map(
  [
    sourceFile("/usr/include/stdarg.h", buildStdargHeader(false)),
    sourceFile(
      "/usr/src/cs-libc/libc.c",
      buildLibcSource(true, true, true, false).split("\n"),
    ),
  ].map((file) => [file.path, file] as const),
);

const hostedCLibcV18SourceFiles = Object.freeze(
  hostedCLibcSourceFiles.flatMap((file) => {
    if (hostedCLibcV19OnlyPaths.has(file.path)) return [];
    return [hostedCLibcV18Replacements.get(file.path) ?? file];
  }),
);

const hostedCLibcV18ArchiveDescriptors: readonly HostedCArchiveDescriptor[] =
  Object.freeze([
    {
      dataModel: cs486Word32DataModel,
      key: "v18:word32:libc",
      memberName: "libc.o",
      paths: ["/usr/lib/libc.csa", "/usr/lib/cs-word32-v1/libc.csa"],
      sourceFiles: hostedCLibcV18SourceFiles,
      sourcePath: "/usr/src/cs-libc/libc.c",
    },
    {
      dataModel: cs486Word32DataModel,
      key: "v18:word32:libcurses",
      memberName: "curses.o",
      paths: ["/usr/lib/libcurses.csa", "/usr/lib/cs-word32-v1/libcurses.csa"],
      sourceFiles: hostedCLibcV18SourceFiles,
      sourcePath: "/usr/src/libcs-curses/curses.c",
    },
    {
      dataModel: cs486Byte8DataModel,
      key: "v18:byte8:libc",
      memberName: "libc.o",
      paths: ["/usr/lib/cs-byte8-v1/libc.csa"],
      sourceFiles: hostedCLibcV18SourceFiles,
      sourcePath: "/usr/src/cs-libc/libc.c",
    },
    {
      dataModel: cs486Byte8DataModel,
      key: "v18:byte8:libcurses",
      memberName: "curses.o",
      paths: ["/usr/lib/cs-byte8-v1/libcurses.csa"],
      sourceFiles: hostedCLibcV18SourceFiles,
      sourcePath: "/usr/src/libcs-curses/curses.c",
    },
  ]);

/** Immutable dual-data-model libc payload shipped by rootfs v18. */
export const hostedCLibcV18Files: readonly FilesystemBaseImageFile[] =
  Object.freeze([
    ...hostedCLibcV18SourceFiles,
    ...installedArchiveFiles(hostedCLibcV18ArchiveDescriptors),
  ]);

const hostedCLibcV17Replacements = new Map(
  [
    sourceFile("/usr/include/cs/fs.h", [
      "#ifndef CS_FS_H",
      "#define CS_FS_H 1",
      "#define CS_O_READ 1",
      "#define CS_O_WRITE 2",
      "#define CS_O_CREATE 4",
      "#define CS_O_TRUNCATE 8",
      "#define CS_O_APPEND 16",
      "#define CS_SEEK_SET 0",
      "#define CS_SEEK_CUR 1",
      "#define CS_SEEK_END 2",
      "struct cs_stat { int kind; int size; int mode; int mtime; };",
      "int cs_open(char *path, int flags, int mode);",
      "int cs_read(int descriptor, void *buffer, int words);",
      "int cs_write(int descriptor, void *buffer, int words);",
      "int cs_seek(int descriptor, int offset, int whence);",
      "int cs_stat(char *path, struct cs_stat *result);",
      "int cs_close(int descriptor);",
      "int cs_remove(char *path);",
      "int cs_rename(char *from, char *to);",
      "#endif",
    ]),
    sourceFile("/usr/include/limits.h", [
      "#ifndef CS_LIMITS_H",
      "#define CS_LIMITS_H 1",
      "#define CHAR_BIT 32",
      "#define CHAR_MIN (-2147483647 - 1)",
      "#define CHAR_MAX 2147483647",
      "#define SCHAR_MIN (-2147483647 - 1)",
      "#define SCHAR_MAX 2147483647",
      "#define UCHAR_MAX 4294967295U",
      "#define SHRT_MIN (-2147483647 - 1)",
      "#define SHRT_MAX 2147483647",
      "#define USHRT_MAX 4294967295U",
      "#define INT_MIN (-2147483647 - 1)",
      "#define INT_MAX 2147483647",
      "#define UINT_MAX 4294967295U",
      "#define LONG_MIN ((long)(-2147483647 - 1))",
      "#define LONG_MAX ((long)2147483647)",
      "#define ULONG_MAX 4294967295UL",
      "#define LLONG_MIN (-9223372036854775807LL - 1LL)",
      "#define LLONG_MAX 9223372036854775807LL",
      "#define ULLONG_MAX 18446744073709551615ULL",
      "#endif",
    ]),
    sourceFile("/usr/include/stdint.h", [
      "#ifndef CS_STDINT_H",
      "#define CS_STDINT_H 1",
      "/* The CS word profile has no exact 8-bit or 16-bit integer type. */",
      "typedef int int32_t;",
      "typedef unsigned int uint32_t;",
      "typedef long long int64_t;",
      "typedef unsigned long long uint64_t;",
      "typedef long int_least32_t;",
      "typedef unsigned long uint_least32_t;",
      "typedef long int_fast32_t;",
      "typedef unsigned long uint_fast32_t;",
      "typedef long intptr_t;",
      "typedef unsigned long uintptr_t;",
      "typedef long long intmax_t;",
      "typedef unsigned long long uintmax_t;",
      "#define INT32_MIN (-2147483647 - 1)",
      "#define INT32_MAX 2147483647",
      "#define UINT32_MAX 4294967295U",
      "#define INT64_MIN (-9223372036854775807LL - 1LL)",
      "#define INT64_MAX 9223372036854775807LL",
      "#define UINT64_MAX 18446744073709551615ULL",
      "#define INTPTR_MIN (-2147483647L - 1L)",
      "#define INTPTR_MAX 2147483647L",
      "#define UINTPTR_MAX 4294967295UL",
      "#define INTMAX_MIN INT64_MIN",
      "#define INTMAX_MAX INT64_MAX",
      "#define UINTMAX_MAX UINT64_MAX",
      "#endif",
    ]),
    sourceFile("/usr/src/cs-libc/README", [
      "CS-Linux libc 1.0 guest source",
      "Build with: cc -c /usr/src/cs-libc/libc.c -o libc.o",
      "Link with cc (implicit -lc) or use ld with /usr/lib/libc.csa.",
      "All sizes are CS word units; char, int, and long occupy one 32-bit word.",
      "long long and unsigned long long occupy two little-endian 32-bit words.",
    ]),
  ].map((file) => [file.path, file] as const),
);

const hostedCLibcV18OnlyPaths = new Set([
  "/usr/include/cs/byte.h",
  "/usr/lib/cs-byte8-v1/libc.csa",
  "/usr/lib/cs-byte8-v1/libcurses.csa",
  "/usr/lib/cs-word32-v1/libc.csa",
  "/usr/lib/cs-word32-v1/libcurses.csa",
]);

const hostedCLibcV17SourceFiles = Object.freeze(
  hostedCLibcV18SourceFiles.flatMap((file) => {
    if (hostedCLibcV18OnlyPaths.has(file.path)) return [];
    return [hostedCLibcV17Replacements.get(file.path) ?? file];
  }),
);

const hostedCLibcV17ArchiveDescriptors: readonly HostedCArchiveDescriptor[] =
  Object.freeze([
    {
      dataModel: cs486Word32DataModel,
      key: "v17:legacy:libc",
      legacy: true,
      memberName: "libc.o",
      paths: ["/usr/lib/libc.csa"],
      sourceFiles: hostedCLibcV17SourceFiles,
      sourcePath: "/usr/src/cs-libc/libc.c",
    },
    {
      dataModel: cs486Word32DataModel,
      key: "v17:legacy:libcurses",
      legacy: true,
      memberName: "curses.o",
      paths: ["/usr/lib/libcurses.csa"],
      sourceFiles: hostedCLibcV17SourceFiles,
      sourcePath: "/usr/src/libcs-curses/curses.c",
    },
  ]);

/** Immutable word-profile libc payload shipped by rootfs v17. */
export const hostedCLibcV17Files: readonly FilesystemBaseImageFile[] =
  Object.freeze([
    ...hostedCLibcV17SourceFiles,
    ...installedArchiveFiles(hostedCLibcV17ArchiveDescriptors),
  ]);

function installedArchiveFiles(
  descriptors: readonly HostedCArchiveDescriptor[],
): readonly FilesystemBaseImageFile[] {
  return descriptors.flatMap((descriptor) => {
    const contents = hostedCArchiveContents[descriptor.key];
    if (!contents.startsWith("CS486AR\n")) {
      throw new Error(`missing generated hosted-C archive '${descriptor.key}'`);
    }
    return descriptor.paths.map((path) =>
      Object.freeze({ contents, metadata, path }),
    );
  });
}

/**
 * Rebuilds every unique checked-in archive for the host-side generator/check.
 * Production Bedrock imports the generated payload and never calls this path.
 */
export function generateHostedCArchiveContents(): Readonly<
  Record<HostedCArchiveKey, string>
> {
  const contents = {} as Record<HostedCArchiveKey, string>;
  for (const descriptor of [
    ...hostedCLibcV17ArchiveDescriptors,
    ...hostedCLibcV18ArchiveDescriptors,
    ...hostedCLibcArchiveDescriptors,
  ]) {
    if (contents[descriptor.key] !== undefined) continue;
    const object = compileInstalledHostedSource(
      descriptor.sourcePath,
      descriptor.sourceFiles,
      descriptor.dataModel,
    );
    contents[descriptor.key] = descriptor.legacy
      ? serializeLegacyArchive([{ name: descriptor.memberName, object }])
      : serializeCs486Archive(
          createCs486Archive([{ name: descriptor.memberName, object }], {
            dataModel: descriptor.dataModel,
          }),
        );
  }
  return Object.freeze(contents);
}

function serializeLegacyArchive(
  members: Parameters<typeof createCs486Archive>[0],
): string {
  const legacyMembers = members.map(({ name, object }) => ({
    name,
    object: downgradeWordObjectToV3(object),
  }));
  const current = createCs486Archive(legacyMembers);
  const payload = {
    abi: current.abi,
    dataModel: legacyCs486WordDataModel,
    format: current.format,
    members: current.members,
    objectFormat: current.objectFormat,
    objectVersions: [1, 2, 3] as const,
    symbols: current.symbols,
    version: 1 as const,
  };
  return serializeCs486Archive({
    ...payload,
    checksum: sha256Hex(JSON.stringify(payload)),
  });
}

function downgradeWordObjectToV3(object: Cs486Object): Cs486Object {
  if (object.version !== 4)
    throw new Error("rootfs v17 requires a current word-profile object");
  const { dataModel, ...withoutDataModel } = object;
  if (dataModel !== cs486Word32DataModel)
    throw new Error("rootfs v17 requires a current word-profile object");
  const legacy = { ...withoutDataModel, version: 3 } as Cs486Object;
  validateCs486Object(legacy);
  return legacy;
}

function compileInstalledHostedSource(
  sourcePath: string,
  files: readonly FilesystemBaseImageFile[],
  dataModel: Cs486DataModel = cs486Word32DataModel,
): Cs486Object {
  let cache = installedHostedObjectCache.get(files);
  if (cache === undefined) {
    cache = new Map();
    installedHostedObjectCache.set(files, cache);
  }
  const cacheKey = `${dataModel}\0${sourcePath}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;
  const byPath = new Map(files.map((file) => [file.path, file.contents]));
  const source = byPath.get(sourcePath);
  if (source === undefined)
    throw new Error(`missing hosted source ${sourcePath}`);
  const object = compileCs486Object("c", source, {
    dataModel,
    include: (request) => {
      const parent = request.fromSource.slice(
        0,
        Math.max(0, request.fromSource.lastIndexOf("/")),
      );
      const candidates = request.quoted
        ? [`${parent}/${request.path}`, `/usr/include/${request.path}`]
        : [`/usr/include/${request.path}`];
      for (const candidate of candidates) {
        const normalized = normalizeHostedPath(candidate);
        const included = byPath.get(normalized);
        if (included !== undefined) {
          return {
            identity: normalized,
            source: included,
            sourceName: normalized,
          };
        }
      }
      return undefined;
    },
    sourceName: sourcePath,
  });
  cache.set(cacheKey, object);
  return object;
}

function normalizeHostedPath(path: string): string {
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (segment.length === 0 || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  return `/${segments.join("/")}`;
}

const hostedCLibcV15Headers = new Map(
  [
    sourceFile("/usr/include/stddef.h", [
      "#ifndef CS_STDDEF_H",
      "#define CS_STDDEF_H 1",
      "typedef int size_t;",
      "typedef long ptrdiff_t;",
      "#define NULL 0",
      "#define offsetof(type, member) ((size_t)&(((type *)0)->member))",
      "#endif",
    ]),
    sourceFile("/usr/include/limits.h", [
      "#ifndef CS_LIMITS_H",
      "#define CS_LIMITS_H 1",
      "#define CHAR_BIT 32",
      "#define CHAR_MIN (-2147483647 - 1)",
      "#define CHAR_MAX 2147483647",
      "#define INT_MIN (-2147483647 - 1)",
      "#define INT_MAX 2147483647",
      "#define LONG_MIN ((long)(-2147483647 - 1))",
      "#define LONG_MAX ((long)2147483647)",
      "#endif",
    ]),
    sourceFile("/usr/include/stdint.h", [
      "#ifndef CS_STDINT_H",
      "#define CS_STDINT_H 1",
      "/* The CS word profile has no exact 8-bit or 16-bit integer type. */",
      "typedef int int32_t;",
      "typedef long int_least32_t;",
      "typedef long int_fast32_t;",
      "typedef long intptr_t;",
      "#define INT32_MIN (-2147483647 - 1)",
      "#define INT32_MAX 2147483647",
      "#endif",
    ]),
    sourceFile("/usr/include/stdbool.h", [
      "#ifndef CS_STDBOOL_H",
      "#define CS_STDBOOL_H 1",
      "#define bool int",
      "#define true 1",
      "#define false 0",
      "#define __bool_true_false_are_defined 1",
      "#endif",
    ]),
  ].map((file) => [file.path, file] as const),
);

const hostedCLibcV17OnlyPaths = new Set([
  "/usr/include/cs/posix.h",
  "/usr/include/curses.h",
  "/usr/include/dirent.h",
  "/usr/include/getopt.h",
  "/usr/include/signal.h",
  "/usr/include/stdalign.h",
  "/usr/include/sys/stat.h",
  "/usr/include/time.h",
  "/usr/include/unistd.h",
  "/usr/src/libcs-curses/README",
  "/usr/src/libcs-curses/curses.c",
  "/usr/lib/libc.csa",
  "/usr/lib/libcurses.csa",
]);

/** Immutable libc payload shipped by rootfs v16 before the POSIX/curses layer. */
export const hostedCLibcV16Files: readonly FilesystemBaseImageFile[] =
  Object.freeze(
    hostedCLibcFiles.flatMap((file) => {
      if (
        hostedCLibcV17OnlyPaths.has(file.path) ||
        hostedCLibcV18OnlyPaths.has(file.path) ||
        hostedCLibcV19OnlyPaths.has(file.path)
      )
        return [];
      const preByteProfile = hostedCLibcV17Replacements.get(file.path);
      if (preByteProfile !== undefined) return [preByteProfile];
      const preFloatProfile = hostedCLibcV18Replacements.get(file.path);
      if (
        preFloatProfile !== undefined &&
        file.path !== "/usr/src/cs-libc/libc.c"
      )
        return [preFloatProfile];
      if (file.path === "/usr/src/cs-libc/libc.c") {
        return [
          Object.freeze({
            ...file,
            contents: `${buildLibcSource(true, true, false)}\n`,
          }),
        ];
      }
      if (file.path === "/usr/include/cs/errno.h") {
        return [
          Object.freeze({
            ...file,
            contents: file.contents
              .split("\n")
              .filter((line) => line !== "#define EEXIST 17")
              .join("\n"),
          }),
        ];
      }
      if (file.path === "/usr/include/stdlib.h") {
        return [
          Object.freeze({
            ...file,
            contents: file.contents
              .split("\n")
              .filter(
                (line) =>
                  !line.startsWith("unsigned long strtoul(") &&
                  !line.startsWith("struct div_t ") &&
                  !line.startsWith("typedef struct div_t ") &&
                  !line.startsWith("int div(") &&
                  !line.startsWith("void qsort(") &&
                  !line.startsWith("void *bsearch(") &&
                  !line.startsWith("typedef void (*cs_atexit_handler)") &&
                  !line.startsWith("int atexit("),
              )
              .join("\n"),
          }),
        ];
      }
      if (file.path === "/usr/include/stdio.h") {
        return [
          Object.freeze({
            ...file,
            contents: file.contents
              .split("\n")
              .filter(
                (line) =>
                  line !== "#include <stdarg.h>" &&
                  !line.startsWith("int vsnprintf("),
              )
              .join("\n"),
          }),
        ];
      }
      return [file];
    }),
  );

/** Immutable libc payload shipped by rootfs v15 before integer-model completion. */
export const hostedCLibcV15Files: readonly FilesystemBaseImageFile[] =
  Object.freeze(
    hostedCLibcV16Files.map((file) => {
      const historicalHeader = hostedCLibcV15Headers.get(file.path);
      if (historicalHeader !== undefined) return historicalHeader;
      if (file.path !== "/usr/src/cs-libc/libc.c") return file;
      return Object.freeze({
        ...file,
        contents: `${buildLibcSource(true, false, false)}\n`,
      });
    }),
  );

/** Immutable libc payload shipped by rootfs v14 before bounded stdarg support. */
export const hostedCLibcV14Files: readonly FilesystemBaseImageFile[] =
  Object.freeze(
    hostedCLibcV15Files.flatMap((file) => {
      if (file.path === "/usr/include/stdarg.h") return [];
      if (file.path === "/usr/include/stdio.h")
        return [
          Object.freeze({
            ...file,
            contents: `${file.contents
              .split("\n")
              .filter(
                (line) =>
                  !line.startsWith("int printf(") &&
                  !line.startsWith("int fprintf(") &&
                  !line.startsWith("int snprintf("),
              )
              .filter((line) => line.length > 0)
              .join("\n")}\n`,
          }),
        ];
      if (file.path !== "/usr/src/cs-libc/libc.c") return [file];
      return [
        Object.freeze({
          ...file,
          contents: `${buildLibcSource(false, false, false)}\n`,
        }),
      ];
    }),
  );

function buildCursesHeader(): readonly string[] {
  return [
    "#ifndef CS_CURSES_H",
    "#define CS_CURSES_H 1",
    "#define OK 0",
    "#define ERR (-1)",
    "#define COLOR_BLACK 0",
    "#define COLOR_RED 1",
    "#define COLOR_GREEN 2",
    "#define COLOR_YELLOW 3",
    "#define COLOR_BLUE 4",
    "#define COLOR_MAGENTA 5",
    "#define COLOR_CYAN 6",
    "#define COLOR_WHITE 7",
    "#define A_NORMAL 0",
    "#define A_BOLD 1",
    "#define COLOR_PAIR(value) ((value) << 8)",
    "struct __cs_WINDOW { int active; int begin_y; int begin_x; int height; int width; int cursor_y; int cursor_x; int attributes; };",
    "typedef struct __cs_WINDOW WINDOW;",
    "extern WINDOW *stdscr;",
    "WINDOW *initscr(void);",
    "int endwin(void);",
    "int clear(void);",
    "int erase(void);",
    "int refresh(void);",
    "int move(int y, int x);",
    "int addch(int character);",
    "int addstr(char *value);",
    "int mvaddstr(int y, int x, char *value);",
    "int printw(char *format, ...);",
    "int mvprintw(int y, int x, char *format, ...);",
    "int getch(void);",
    "int curs_set(int visibility);",
    "int start_color(void);",
    "int init_pair(int pair, int foreground, int background);",
    "int attron(int attributes);",
    "int attroff(int attributes);",
    "WINDOW *newwin(int height, int width, int begin_y, int begin_x);",
    "int delwin(WINDOW *window);",
    "int wclear(WINDOW *window);",
    "int wrefresh(WINDOW *window);",
    "int wmove(WINDOW *window, int y, int x);",
    "int waddch(WINDOW *window, int character);",
    "int waddstr(WINDOW *window, char *value);",
    "#endif",
  ];
}

function buildCursesSource(): readonly string[] {
  return [
    "#include <curses.h>",
    "#include <cs/term.h>",
    "#include <errno.h>",
    "#include <stdarg.h>",
    "#include <stdio.h>",
    "#include <string.h>",
    "struct __cs_WINDOW cs_windows[8];",
    "WINDOW *stdscr;",
    "int cs_curses_screen[2000];",
    "int cs_curses_width = 0;",
    "int cs_curses_height = 0;",
    "int cs_curses_cursor_visible = 1;",
    "int cs_curses_pair_fg[16];",
    "int cs_curses_pair_bg[16];",
    "char cs_curses_format[1024];",
    "int cs_curses_cell(WINDOW *window, int character){int pair = (window->attributes >> 8) & 15; int foreground = cs_curses_pair_fg[pair]; int background = cs_curses_pair_bg[pair]; return (character & 65535) | (foreground << 16) | (background << 20);}",
    "int cs_curses_valid(WINDOW *window){return window != (WINDOW *)0 && window->active && window->height > 0 && window->width > 0;}",
    "int wmove(WINDOW *window, int y, int x){if(!cs_curses_valid(window) || y < 0 || x < 0 || y >= window->height || x >= window->width){errno = EINVAL; return ERR;} window->cursor_y = y; window->cursor_x = x; return OK;}",
    "int waddch(WINDOW *window, int character){if(!cs_curses_valid(window)){errno = EINVAL; return ERR;} if(character == 10){window->cursor_x = 0; window->cursor_y = window->cursor_y + 1; return window->cursor_y < window->height ? OK : ERR;} if(window->cursor_y >= window->height || window->cursor_x >= window->width){errno = EINVAL; return ERR;} int y = window->begin_y + window->cursor_y; int x = window->begin_x + window->cursor_x; cs_curses_screen[y * cs_curses_width + x] = cs_curses_cell(window, character); window->cursor_x = window->cursor_x + 1; if(window->cursor_x >= window->width){window->cursor_x = 0; window->cursor_y = window->cursor_y + 1;} return OK;}",
    "int waddstr(WINDOW *window, char *value){if(value == (char *)0){errno = EINVAL; return ERR;} int index = 0; while(index < 4096 && value[index] != 0){if(waddch(window, value[index]) == ERR) return ERR; index = index + 1;} if(index == 4096){errno = EINVAL; return ERR;} return OK;}",
    "int wclear(WINDOW *window){if(!cs_curses_valid(window)){errno = EINVAL; return ERR;} int blank = cs_curses_cell(window, 32); if(window->begin_x == 0 && window->width == cs_curses_width){int index = window->begin_y * cs_curses_width; int end = index + window->height * cs_curses_width; while(index < end){cs_curses_screen[index] = blank; index = index + 1;}}else{int y = 0; while(y < window->height){int row = (window->begin_y + y) * cs_curses_width + window->begin_x; int x = 0; while(x < window->width){cs_curses_screen[row + x] = blank; x = x + 1;} y = y + 1;}} window->cursor_y = 0; window->cursor_x = 0; return OK;}",
    "WINDOW *initscr(void){int dimensions = cs_term_size(); if(dimensions < 0) return (WINDOW *)0; cs_curses_width = dimensions & 65535; cs_curses_height = (dimensions >> 16) & 65535; if(cs_curses_width < 1 || cs_curses_width > 80 || cs_curses_height < 1 || cs_curses_height > 25){errno = EINVAL; return (WINDOW *)0;} stdscr = &cs_windows[0]; int index = 0; while(index < 8){cs_windows[index].active = 0; index = index + 1;} index = 0; while(index < 16){cs_curses_pair_fg[index] = 7; cs_curses_pair_bg[index] = 0; index = index + 1;} stdscr->active = 1; stdscr->begin_y = 0; stdscr->begin_x = 0; stdscr->height = cs_curses_height; stdscr->width = cs_curses_width; stdscr->attributes = 0; wclear(stdscr); return stdscr;}",
    "int endwin(void){int result = refresh(); int index = 0; while(index < 8){cs_windows[index].active = 0; index = index + 1;} return result;}",
    "int wrefresh(WINDOW *window){if(!cs_curses_valid(window)){errno = EINVAL; return ERR;} int cursor = (window->begin_x + window->cursor_x) | ((window->begin_y + window->cursor_y) << 8); if(cs_curses_cursor_visible) cursor = cursor | 65536; return cs_term_present(cs_curses_screen, cs_curses_width | (cs_curses_height << 16), cursor);}",
    "int clear(void){return wclear(stdscr);}",
    "int erase(void){return wclear(stdscr);}",
    "int refresh(void){return wrefresh(stdscr);}",
    "int move(int y, int x){return wmove(stdscr, y, x);}",
    "int addch(int character){return waddch(stdscr, character);}",
    "int addstr(char *value){return waddstr(stdscr, value);}",
    "int mvaddstr(int y, int x, char *value){if(move(y, x) == ERR) return ERR; return addstr(value);}",
    "int printw(char *format, ...){va_list list; va_start(list, format); int result = vsnprintf(cs_curses_format, 1024, format, &list); va_end(list); if(result < 0 || result >= 1024) return ERR; return addstr(cs_curses_format) == ERR ? ERR : result;}",
    "int mvprintw(int y, int x, char *format, ...){if(move(y, x) == ERR) return ERR; va_list list; va_start(list, format); int result = vsnprintf(cs_curses_format, 1024, format, &list); va_end(list); if(result < 0 || result >= 1024) return ERR; return addstr(cs_curses_format) == ERR ? ERR : result;}",
    "int getch(void){return cs_key_wait();}",
    "int curs_set(int visibility){if(visibility < 0 || visibility > 1){errno = EINVAL; return ERR;} int previous = cs_curses_cursor_visible; cs_curses_cursor_visible = visibility; return previous;}",
    "int start_color(void){return OK;}",
    "int init_pair(int pair, int foreground, int background){if(pair < 1 || pair >= 16 || foreground < 0 || foreground >= 16 || background < 0 || background >= 16){errno = EINVAL; return ERR;} cs_curses_pair_fg[pair] = foreground; cs_curses_pair_bg[pair] = background; return OK;}",
    "int attron(int attributes){stdscr->attributes = stdscr->attributes | attributes; return OK;}",
    "int attroff(int attributes){stdscr->attributes = stdscr->attributes & ~attributes; return OK;}",
    "WINDOW *newwin(int height, int width, int begin_y, int begin_x){if(height < 1 || width < 1 || begin_y < 0 || begin_x < 0 || begin_y + height > cs_curses_height || begin_x + width > cs_curses_width){errno = EINVAL; return (WINDOW *)0;} int index = 1; while(index < 8 && cs_windows[index].active) index = index + 1; if(index == 8){errno = ENOMEM; return (WINDOW *)0;} WINDOW *window = &cs_windows[index]; window->active = 1; window->begin_y = begin_y; window->begin_x = begin_x; window->height = height; window->width = width; window->cursor_y = 0; window->cursor_x = 0; window->attributes = 0; wclear(window); return window;}",
    "int delwin(WINDOW *window){if(window == stdscr || !cs_curses_valid(window)){errno = EINVAL; return ERR;} window->active = 0; return OK;}",
  ];
}

function buildFloatHeader(): readonly string[] {
  return [
    "#ifndef CS_FLOAT_H",
    "#define CS_FLOAT_H 1",
    "#define FLT_RADIX 2",
    "#define FLT_ROUNDS 1",
    "#define FLT_EVAL_METHOD 0",
    "#define FLT_MANT_DIG 24",
    "#define DBL_MANT_DIG 53",
    "#define LDBL_MANT_DIG DBL_MANT_DIG",
    "#define FLT_DIG 6",
    "#define DBL_DIG 15",
    "#define LDBL_DIG DBL_DIG",
    "#define FLT_DECIMAL_DIG 9",
    "#define DBL_DECIMAL_DIG 17",
    "#define LDBL_DECIMAL_DIG DBL_DECIMAL_DIG",
    "#define DECIMAL_DIG 17",
    "#define FLT_MIN_EXP (-125)",
    "#define DBL_MIN_EXP (-1021)",
    "#define LDBL_MIN_EXP DBL_MIN_EXP",
    "#define FLT_MAX_EXP 128",
    "#define DBL_MAX_EXP 1024",
    "#define LDBL_MAX_EXP DBL_MAX_EXP",
    "#define FLT_MIN_10_EXP (-37)",
    "#define DBL_MIN_10_EXP (-307)",
    "#define LDBL_MIN_10_EXP DBL_MIN_10_EXP",
    "#define FLT_MAX_10_EXP 38",
    "#define DBL_MAX_10_EXP 308",
    "#define LDBL_MAX_10_EXP DBL_MAX_10_EXP",
    "#define FLT_MAX 0x1.fffffep+127f",
    "#define DBL_MAX 0x1.fffffffffffffp+1023",
    "#define LDBL_MAX DBL_MAX",
    "#define FLT_MIN 0x1p-126f",
    "#define DBL_MIN 0x1p-1022",
    "#define LDBL_MIN DBL_MIN",
    "#define FLT_TRUE_MIN 0x1p-149f",
    "#define DBL_TRUE_MIN 0x1p-1074",
    "#define LDBL_TRUE_MIN DBL_TRUE_MIN",
    "#define FLT_EPSILON 0x1p-23f",
    "#define DBL_EPSILON 0x1p-52",
    "#define LDBL_EPSILON DBL_EPSILON",
    "#define __STDC_IEC_559__ 1",
    "#endif",
  ];
}

function buildMathHeader(): readonly string[] {
  return [
    "#ifndef CS_MATH_H",
    "#define CS_MATH_H 1",
    "#define HUGE_VAL (1.0 / 0.0)",
    "#define HUGE_VALF (1.0f / 0.0f)",
    "#define INFINITY HUGE_VALF",
    "#define NAN (0.0f / 0.0f)",
    "#define FP_ILOGB0 (-2147483647 - 1)",
    "#define FP_ILOGBNAN 2147483647",
    "double fabs(double value);",
    "float fabsf(float value);",
    "double copysign(double magnitude, double sign);",
    "float copysignf(float magnitude, float sign);",
    "double floor(double value);",
    "float floorf(float value);",
    "double ceil(double value);",
    "float ceilf(float value);",
    "double trunc(double value);",
    "float truncf(float value);",
    "double round(double value);",
    "float roundf(float value);",
    "double fmod(double left, double right);",
    "float fmodf(float left, float right);",
    "double sqrt(double value);",
    "float sqrtf(float value);",
    "double ldexp(double value, int exponent);",
    "float ldexpf(float value, int exponent);",
    "double frexp(double value, int *exponent);",
    "float frexpf(float value, int *exponent);",
    "double modf(double value, double *integer);",
    "float modff(float value, float *integer);",
    "int isnan(double value);",
    "int isinf(double value);",
    "int isfinite(double value);",
    "int signbit(double value);",
    "#define fabsl fabs",
    "#define copysignl copysign",
    "#define floorl floor",
    "#define ceill ceil",
    "#define truncl trunc",
    "#define roundl round",
    "#define fmodl fmod",
    "#define sqrtl sqrt",
    "#define ldexpl ldexp",
    "#define frexpl frexp",
    "#define modfl modf",
    "#endif",
  ];
}

function buildLibmSource(): string {
  return [
    "#include <math.h>",
    "#include <errno.h>",
    "int __cs_fp_status(void);",
    "double __cs_fp_f64_abs(double value);",
    "float __cs_fp_f32_abs(float value);",
    "double __cs_fp_f64_copysign(double magnitude, double sign);",
    "float __cs_fp_f32_copysign(float magnitude, float sign);",
    "double __cs_fp_f64_floor(double value);",
    "float __cs_fp_f32_floor(float value);",
    "double __cs_fp_f64_ceil(double value);",
    "float __cs_fp_f32_ceil(float value);",
    "double __cs_fp_f64_trunc(double value);",
    "float __cs_fp_f32_trunc(float value);",
    "double __cs_fp_f64_round(double value);",
    "float __cs_fp_f32_round(float value);",
    "double __cs_fp_f64_fmod(double left, double right);",
    "float __cs_fp_f32_fmod(float left, float right);",
    "double __cs_fp_f64_sqrt(double value);",
    "float __cs_fp_f32_sqrt(float value);",
    "double __cs_fp_f64_ldexp(double value, int exponent);",
    "float __cs_fp_f32_ldexp(float value, int exponent);",
    "double __cs_fp_f64_frexp(double value, int *exponent);",
    "float __cs_fp_f32_frexp(float value, int *exponent);",
    "double __cs_fp_f64_modf(double value, double *integer);",
    "float __cs_fp_f32_modf(float value, float *integer);",
    "int __cs_fp_f64_isnan(double value);",
    "int __cs_fp_f64_isinf(double value);",
    "int __cs_fp_f64_isfinite(double value);",
    "int __cs_fp_f64_signbit(double value);",
    "static void cs_math_status(void){int status = __cs_fp_status(); if((status & 1) != 0) errno = EDOM; else if((status & 14) != 0) errno = ERANGE;}",
    "double fabs(double value){return __cs_fp_f64_abs(value);}",
    "float fabsf(float value){return __cs_fp_f32_abs(value);}",
    "double copysign(double magnitude, double sign){return __cs_fp_f64_copysign(magnitude, sign);}",
    "float copysignf(float magnitude, float sign){return __cs_fp_f32_copysign(magnitude, sign);}",
    "double floor(double value){return __cs_fp_f64_floor(value);}",
    "float floorf(float value){return __cs_fp_f32_floor(value);}",
    "double ceil(double value){return __cs_fp_f64_ceil(value);}",
    "float ceilf(float value){return __cs_fp_f32_ceil(value);}",
    "double trunc(double value){return __cs_fp_f64_trunc(value);}",
    "float truncf(float value){return __cs_fp_f32_trunc(value);}",
    "double round(double value){return __cs_fp_f64_round(value);}",
    "float roundf(float value){return __cs_fp_f32_round(value);}",
    "double fmod(double left, double right){double result = __cs_fp_f64_fmod(left, right); cs_math_status(); return result;}",
    "float fmodf(float left, float right){float result = __cs_fp_f32_fmod(left, right); cs_math_status(); return result;}",
    "double sqrt(double value){double result = __cs_fp_f64_sqrt(value); cs_math_status(); return result;}",
    "float sqrtf(float value){float result = __cs_fp_f32_sqrt(value); cs_math_status(); return result;}",
    "double ldexp(double value, int exponent){double result = __cs_fp_f64_ldexp(value, exponent); cs_math_status(); return result;}",
    "float ldexpf(float value, int exponent){float result = __cs_fp_f32_ldexp(value, exponent); cs_math_status(); return result;}",
    "double frexp(double value, int *exponent){if(exponent == (int *)0){errno = EDOM; return NAN;} return __cs_fp_f64_frexp(value, exponent);}",
    "float frexpf(float value, int *exponent){if(exponent == (int *)0){errno = EDOM; return NAN;} return __cs_fp_f32_frexp(value, exponent);}",
    "double modf(double value, double *integer){if(integer == (double *)0){errno = EDOM; return NAN;} return __cs_fp_f64_modf(value, integer);}",
    "float modff(float value, float *integer){if(integer == (float *)0){errno = EDOM; return NAN;} return __cs_fp_f32_modf(value, integer);}",
    "int isnan(double value){return __cs_fp_f64_isnan(value);}",
    "int isinf(double value){return __cs_fp_f64_isinf(value);}",
    "int isfinite(double value){return __cs_fp_f64_isfinite(value);}",
    "int signbit(double value){return __cs_fp_f64_signbit(value);}",
  ].join("\n");
}

function buildLibcSource(
  includeStdarg: boolean,
  includeRuntimeFlush: boolean,
  includePosix: boolean,
  includeFloatFormatting = false,
): string {
  return [
    "#include <cs/syscall.h>",
    "#include <cs/term.h>",
    "#include <cs/fs.h>",
    "#include <cs/errno.h>",
    "#include <stddef.h>",
    "#include <limits.h>",
    ...(includeStdarg ? ["#include <stdarg.h>"] : []),
    ...(includePosix
      ? [
          "#include <cs/posix.h>",
          "#include <dirent.h>",
          "#include <getopt.h>",
          "#include <signal.h>",
          "#include <sys/stat.h>",
          "#include <time.h>",
          "#include <unistd.h>",
        ]
      : []),
    "#include <string.h>",
    "#include <stdlib.h>",
    "#include <stdio.h>",
    "int errno = 0;",
    "int cs_heap_ready = 0;",
    "int cs_heap_base = 0;",
    "int cs_heap_words = 0;",
    "int cs_heap_used = 0;",
    "int cs_free_count = 0;",
    "int cs_free_start[64];",
    "int cs_free_words[64];",
    "int cs_search_prefix[4096];",
    "int cs_rand_state = 1;",
    ...(includePosix
      ? [
          "cs_atexit_handler cs_atexit_handlers[16];",
          "int cs_atexit_count = 0;",
          "cs_sighandler_t cs_signal_handlers[32];",
          "char *optarg;",
          "int optind = 1;",
          "int opterr = 1;",
          "int optopt = 0;",
          "int cs_getopt_offset = 0;",
          "int cs_temp_counter = 0;",
        ]
      : []),
    "struct __cs_FILE cs_stdin_value = {0, 0, 0};",
    "struct __cs_FILE cs_stdout_value = {1, 0, 0};",
    "struct __cs_FILE cs_stderr_value = {2, 0, 0};",
    ...(includeStdarg
      ? [
          "struct cs_format_output { FILE *stream; char *buffer; int capacity; int total; int failed; };",
        ]
      : []),
    "FILE *__cs_stdin_stream(){return &cs_stdin_value;}",
    "FILE *__cs_stdout_stream(){return &cs_stdout_value;}",
    "FILE *__cs_stderr_stream(){return &cs_stderr_value;}",
    "int cs_result(int value){if(value < 0){errno = -value; return -1;} return value;}",
    ...(includeStdarg
      ? [
          includeFloatFormatting
            ? "void *__cs_va_arg(void *opaque, int words){struct __cs_va_list *list = (struct __cs_va_list *)opaque; if(list == (struct __cs_va_list *)0 || words < 1 || words > 2 || list->remaining < words || list->remaining > 32 || list->next == (int *)0 || (int)list->next % 4 != 0){errno = EINVAL; abort(); return (void *)0;} void *result = (void *)list->next; list->next = list->next + words; list->remaining = list->remaining - words; return result;}"
            : "void *__cs_va_arg(void *opaque){struct __cs_va_list *list = (struct __cs_va_list *)opaque; if(list == (struct __cs_va_list *)0 || list->remaining < 1 || list->remaining > 32 || list->next == (int *)0 || (int)list->next % 4 != 0){errno = EINVAL; abort(); return (void *)0;} void *result = (void *)list->next; list->next = list->next + 1; list->remaining = list->remaining - 1; return result;}",
        ]
      : []),
    "int cs_term_size(void){return cs_result(__cs_syscall(CS_SYS_TERM_SIZE, 0, 0, 0));}",
    "int cs_term_present(int *fb, int dimensions, int cursor){return cs_result(__cs_syscall(CS_SYS_TERM_PRESENT, (int)fb, dimensions, cursor));}",
    "int cs_key_wait(void){return cs_result(__cs_syscall(CS_SYS_KEY_WAIT, 0, 0, 0));}",
    "int cs_key_poll(void){return cs_result(__cs_syscall(CS_SYS_KEY_POLL, 0, 0, 0));}",
    "int cs_clock_ticks(void){return cs_result(__cs_syscall(CS_SYS_CLOCK_TICKS, 0, 0, 0));}",
    "int cs_sleep_ticks(int ticks){return cs_result(__cs_syscall(CS_SYS_SLEEP_TICKS, ticks, 0, 0));}",
    "int cs_open(char *path, int flags, int mode){return cs_result(__cs_syscall(CS_SYS_FS_OPEN, (int)path, flags, mode));}",
    "int cs_read(int fd, void *buffer, int words){return cs_result(__cs_syscall(CS_SYS_FS_READ, fd, (int)buffer, words));}",
    "int cs_write(int fd, void *buffer, int words){return cs_result(__cs_syscall(CS_SYS_FS_WRITE, fd, (int)buffer, words));}",
    "int cs_seek(int fd, int offset, int whence){return cs_result(__cs_syscall(CS_SYS_FS_SEEK, fd, offset, whence));}",
    "int cs_stat(char *path, struct cs_stat *result){return cs_result(__cs_syscall(CS_SYS_FS_STAT, (int)path, (int)result, 0));}",
    "int cs_close(int fd){return cs_result(__cs_syscall(CS_SYS_FS_CLOSE, fd, 0, 0));}",
    "int cs_remove(char *path){return cs_result(__cs_syscall(CS_SYS_FS_REMOVE, (int)path, 0, 0));}",
    "int cs_rename(char *from, char *to){return cs_result(__cs_syscall(CS_SYS_FS_RENAME, (int)from, (int)to, 0));}",
    ...(includePosix
      ? [
          "int cs_wall_time(void){return cs_result(__cs_syscall(CS_SYS_WALL_TIME, 0, 0, 0));}",
          "int cs_getcwd(char *buffer, int words){return cs_result(__cs_syscall(CS_SYS_FS_GETCWD, (int)buffer, words, 0));}",
          "int cs_chdir(char *path){return cs_result(__cs_syscall(CS_SYS_FS_CHDIR, (int)path, 0, 0));}",
          "int cs_mkdir(char *path, int mode){return cs_result(__cs_syscall(CS_SYS_FS_MKDIR, (int)path, mode, 0));}",
          "int cs_rmdir(char *path){return cs_result(__cs_syscall(CS_SYS_FS_RMDIR, (int)path, 0, 0));}",
          "int cs_access(char *path, int mode){return cs_result(__cs_syscall(CS_SYS_FS_ACCESS, (int)path, mode, 0));}",
          "int cs_opendir(char *path){return cs_result(__cs_syscall(CS_SYS_FS_OPENDIR, (int)path, 0, 0));}",
          "int cs_readdir(int descriptor, char *name, int words){return cs_result(__cs_syscall(CS_SYS_FS_READDIR, descriptor, (int)name, words));}",
          "int cs_closedir(int descriptor){return cs_result(__cs_syscall(CS_SYS_FS_CLOSEDIR, descriptor, 0, 0));}",
          "int cs_stat_extended(char *path, void *result){return cs_result(__cs_syscall(CS_SYS_FS_STAT_EXTENDED, (int)path, (int)result, 0));}",
        ]
      : []),
    "size_t strlen(char *value){int count = 0; while(count < 4096 && value[count] != 0){count = count + 1;} if(count == 4096) errno = EINVAL; return count;}",
    "size_t strnlen(char *value, size_t count){if(count < 0){errno = EINVAL; return 0;} if(count > 4096) count = 4096; int index = 0; while(index < count && value[index] != 0) index = index + 1; return index;}",
    "char *strcpy(char *destination, char *source){int index = 0; while(index < 4096){destination[index] = source[index]; if(source[index] == 0) return destination; index = index + 1;} errno = EINVAL; return destination;}",
    "char *strncpy(char *destination, char *source, size_t count){if(count < 0 || count > 4096){errno = EINVAL; return destination;} int index = 0; while(index < count && source[index] != 0){destination[index] = source[index]; index = index + 1;} while(index < count){destination[index] = 0; index = index + 1;} return destination;}",
    "int strcmp(char *left, char *right){int index = 0; while(index < 4096 && left[index] == right[index] && left[index] != 0){index = index + 1;} if(index == 4096){errno = EINVAL; return 0;} return left[index] - right[index];}",
    "int strncmp(char *left, char *right, size_t count){if(count < 0 || count > 4096){errno = EINVAL; return 0;} int index = 0; while(index < count && left[index] == right[index] && left[index] != 0){index = index + 1;} if(index == count) return 0; return left[index] - right[index];}",
    "char *strchr(char *value, int character){int index = 0; while(index < 4096){if(value[index] == character) return value + index; if(value[index] == 0) return (char *)0; index = index + 1;} errno = EINVAL; return (char *)0;}",
    "char *strrchr(char *value, int character){char *last = (char *)0; int index = 0; while(index < 4096){if(value[index] == character) last = value + index; if(value[index] == 0) return last; index = index + 1;} errno = EINVAL; return (char *)0;}",
    "char *strstr(char *value, char *needle){int needle_words = strlen(needle); if(needle_words == 0) return value; if(needle_words >= 4096){errno = EINVAL; return (char *)0;} cs_search_prefix[0] = 0; int index = 1; int matched = 0; while(index < needle_words){while(matched > 0 && needle[index] != needle[matched]) matched = cs_search_prefix[matched - 1]; if(needle[index] == needle[matched]) matched = matched + 1; cs_search_prefix[index] = matched; index = index + 1;} index = 0; matched = 0; while(index < 4096 && value[index] != 0){while(matched > 0 && value[index] != needle[matched]) matched = cs_search_prefix[matched - 1]; if(value[index] == needle[matched]) matched = matched + 1; if(matched == needle_words) return value + index - needle_words + 1; index = index + 1;} if(index == 4096) errno = EINVAL; return (char *)0;}",
    "int memcmp(void *left, void *right, size_t count){if(count < 0 || count > 65536){errno = EINVAL; return 0;} int *a = (int *)left; int *b = (int *)right; int index = 0; while(index < count){if(a[index] != b[index]) return a[index] - b[index]; index = index + 1;} return 0;}",
    "void *memchr(void *value, int character, size_t count){if(count < 0 || count > 65536){errno = EINVAL; return (void *)0;} int *words = (int *)value; int index = 0; while(index < count){if(words[index] == character) return (void *)(words + index); index = index + 1;} return (void *)0;}",
    "void *memcpy(void *destination, void *source, size_t count){if(count < 0 || count > 65536){errno = EINVAL; return destination;} int *to = (int *)destination; int *from = (int *)source; int index = 0; while(index < count){to[index] = from[index]; index = index + 1;} return destination;}",
    "void *memmove(void *destination, void *source, size_t count){if(count < 0 || count > 65536){errno = EINVAL; return destination;} int *to = (int *)destination; int *from = (int *)source; int index = 0; if(to < from){while(index < count){to[index] = from[index]; index = index + 1;}} else {index = count; while(index > 0){index = index - 1; to[index] = from[index];}} return destination;}",
    "void *memset(void *destination, int value, size_t count){if(count < 0 || count > 65536){errno = EINVAL; return destination;} int *to = (int *)destination; int index = 0; while(index < count){to[index] = value; index = index + 1;} return destination;}",
    "int cs_digit_value(int character){if(character >= 48 && character <= 57) return character - 48; if(character >= 65 && character <= 90) return character - 65 + 10; if(character >= 97 && character <= 122) return character - 97 + 10; return -1;}",
    "long strtol(char *text, char **end, int base){char *cursor = text; int examined = 0; int negative = 0; int any = 0; int overflow = 0; if(base != 0 && (base < 2 || base > 36)){errno = EINVAL; if(end != (char **)0) *end = text; return 0;} while(examined < 256 && (cursor[0] == 32 || (cursor[0] >= 9 && cursor[0] <= 13))){cursor = cursor + 1; examined = examined + 1;} if(examined >= 256){errno = EINVAL; if(end != (char **)0) *end = text; return 0;} if(cursor[0] == 43 || cursor[0] == 45){negative = cursor[0] == 45; cursor = cursor + 1; examined = examined + 1;} if(examined + 2 < 256 && cursor[0] == 48 && (cursor[1] == 120 || cursor[1] == 88) && (base == 0 || base == 16) && cs_digit_value(cursor[2]) >= 0 && cs_digit_value(cursor[2]) < 16){base = 16; cursor = cursor + 2; examined = examined + 2;} if(base == 0){if(cursor[0] == 48) base = 8; else base = 10;} long limit = negative ? (-2147483647 - 1) : -2147483647; long cutoff = limit / base; int cutlim = -(limit % base); long result = 0; while(examined < 256){int digit = cs_digit_value(cursor[0]); if(digit < 0 || digit >= base) break; any = 1; if(result < cutoff || (result == cutoff && digit > cutlim)) overflow = 1; else if(!overflow) result = result * base - digit; cursor = cursor + 1; examined = examined + 1;} if(!any){if(end != (char **)0) *end = text; return 0;} if(end != (char **)0) *end = cursor; if(overflow || examined >= 256){errno = ERANGE; return negative ? (-2147483647 - 1) : 2147483647;} return negative ? result : -result;}",
    ...(includePosix
      ? [
          "unsigned long strtoul(char *text, char **end, int base){char *cursor = text; int examined = 0; int negative = 0; int any = 0; int overflow = 0; if(base != 0 && (base < 2 || base > 36)){errno = EINVAL; if(end != (char **)0) *end = text; return 0U;} while(examined < 256 && (cursor[0] == 32 || (cursor[0] >= 9 && cursor[0] <= 13))){cursor = cursor + 1; examined = examined + 1;} if(cursor[0] == 43 || cursor[0] == 45){negative = cursor[0] == 45; cursor = cursor + 1; examined = examined + 1;} if(examined + 2 < 256 && cursor[0] == 48 && (cursor[1] == 120 || cursor[1] == 88) && (base == 0 || base == 16) && cs_digit_value(cursor[2]) >= 0 && cs_digit_value(cursor[2]) < 16){base = 16; cursor = cursor + 2; examined = examined + 2;} if(base == 0) base = cursor[0] == 48 ? 8 : 10; unsigned long cutoff = ULONG_MAX / (unsigned long)base; unsigned long cutlim = ULONG_MAX % (unsigned long)base; unsigned long result = 0U; while(examined < 256){int digit = cs_digit_value(cursor[0]); if(digit < 0 || digit >= base) break; any = 1; if(result > cutoff || (result == cutoff && (unsigned long)digit > cutlim)) overflow = 1; else if(!overflow) result = result * (unsigned long)base + (unsigned long)digit; cursor = cursor + 1; examined = examined + 1;} if(!any){if(end != (char **)0) *end = text; return 0U;} if(end != (char **)0) *end = cursor; if(overflow || examined >= 256){errno = ERANGE; return ULONG_MAX;} return negative ? 0U - result : result;}",
          "int div(int numerator, int denominator, div_t *result){if(result == (div_t *)0){errno = EFAULT; return -1;} if(denominator == 0){errno = EDOM; result->quot = 0; result->rem = numerator; return -1;} result->quot = numerator / denominator; result->rem = numerator % denominator; return 0;}",
          "void cs_swap_words(int *left, int *right, int words){int index = 0; while(index < words){int value = left[index]; left[index] = right[index]; right[index] = value; index = index + 1;}}",
          "void cs_qsort_sift(int *base, int start, int end, int words, int (*compare)(void *, void *)){int root = start; while(root * 2 + 1 <= end){int child = root * 2 + 1; int swap_index = root; if(compare(base + swap_index * words, base + child * words) < 0) swap_index = child; if(child + 1 <= end && compare(base + swap_index * words, base + (child + 1) * words) < 0) swap_index = child + 1; if(swap_index == root) return; cs_swap_words(base + root * words, base + swap_index * words, words); root = swap_index;}}",
          "void qsort(void *opaque, size_t count, size_t words, int (*compare)(void *, void *)){if(opaque == (void *)0 || compare == (void *)0 || count > 4096 || words < 1 || words > 256 || (count != 0 && count * words / count != words)){errno = EINVAL; return;} int *base = (int *)opaque; int start = count / 2; while(start > 0){start = start - 1; cs_qsort_sift(base, start, count - 1, words, compare);} int end = count; while(end > 1){end = end - 1; cs_swap_words(base, base + end * words, words); cs_qsort_sift(base, 0, end - 1, words, compare);}}",
          "void *bsearch(void *key, void *opaque, size_t count, size_t words, int (*compare)(void *, void *)){if(key == (void *)0 || opaque == (void *)0 || compare == (void *)0 || count > 4096 || words < 1 || words > 256 || (count != 0 && count * words / count != words)){errno = EINVAL; return (void *)0;} int *base = (int *)opaque; int low = 0; int high = count; while(low < high){int middle = low + (high - low) / 2; int order = compare(key, base + middle * words); if(order == 0) return base + middle * words; if(order < 0) high = middle; else low = middle + 1;} return (void *)0;}",
          "int atexit(cs_atexit_handler handler){if(handler == (void *)0 || cs_atexit_count >= 16){errno = ENOMEM; return -1;} cs_atexit_handlers[cs_atexit_count] = handler; cs_atexit_count = cs_atexit_count + 1; return 0;}",
          "void __cs_run_atexit(void){while(cs_atexit_count > 0){cs_atexit_count = cs_atexit_count - 1; cs_atexit_handler handler = cs_atexit_handlers[cs_atexit_count]; cs_atexit_handlers[cs_atexit_count] = (void *)0; handler();}}",
        ]
      : []),
    "int atoi(char *text){return strtol(text, (char **)0, 10);}",
    "int abs(int value){if(value == (-2147483647 - 1)){errno = ERANGE; return 2147483647;} return value < 0 ? -value : value;}",
    "long labs(long value){if(value == (-2147483647 - 1)){errno = ERANGE; return 2147483647;} return value < 0 ? -value : value;}",
    "void cs_heap_initialize(void){int words = 0; int startup = 0; int base = __cs_syscall(CS_SYS_HEAP_INFO, (int)&words, (int)&startup, 0); if(base < 0){errno = -base; return;} cs_heap_base = base; cs_heap_words = words; cs_heap_ready = 1;}",
    "void cs_sort_and_coalesce(void){int i = 0; int j = 0; while(i < cs_free_count){j = i + 1; while(j < cs_free_count){if(cs_free_start[j] < cs_free_start[i]){int s = cs_free_start[i]; int w = cs_free_words[i]; cs_free_start[i] = cs_free_start[j]; cs_free_words[i] = cs_free_words[j]; cs_free_start[j] = s; cs_free_words[j] = w;} j = j + 1;} i = i + 1;} i = 0; while(i + 1 < cs_free_count){if(cs_free_start[i] + cs_free_words[i] * 4 == cs_free_start[i + 1]){cs_free_words[i] = cs_free_words[i] + cs_free_words[i + 1]; j = i + 1; while(j + 1 < cs_free_count){cs_free_start[j] = cs_free_start[j + 1]; cs_free_words[j] = cs_free_words[j + 1]; j = j + 1;} cs_free_count = cs_free_count - 1;} else {i = i + 1;}}}",
    "void *malloc(size_t words){int needed = words + 1; int index = 0; if(words <= 0 || needed <= words){errno = ENOMEM; return (void *)0;} if(!cs_heap_ready) cs_heap_initialize(); if(!cs_heap_ready) return (void *)0; while(index < cs_free_count){if(cs_free_words[index] >= needed){int address = cs_free_start[index]; int remaining = cs_free_words[index] - needed; if(remaining > 1){cs_free_start[index] = address + needed * 4; cs_free_words[index] = remaining;} else {needed = cs_free_words[index]; int move = index; while(move + 1 < cs_free_count){cs_free_start[move] = cs_free_start[move + 1]; cs_free_words[move] = cs_free_words[move + 1]; move = move + 1;} cs_free_count = cs_free_count - 1;} *((int *)address) = needed; return (void *)(address + 4);} index = index + 1;} if(cs_heap_used > cs_heap_words - needed){errno = ENOMEM; return (void *)0;} int address = cs_heap_base + cs_heap_used * 4; cs_heap_used = cs_heap_used + needed; *((int *)address) = needed; return (void *)(address + 4);}",
    "void free(void *pointer){if(pointer == (void *)0) return; int address = (int)pointer - 4; int words = *((int *)address); if(words <= 1 || cs_free_count >= 64) return; cs_free_start[cs_free_count] = address; cs_free_words[cs_free_count] = words; cs_free_count = cs_free_count + 1; cs_sort_and_coalesce();}",
    "void *calloc(size_t count, size_t words){if(count < 0 || words < 0){errno = ENOMEM; return (void *)0;} int total = count * words; if(count != 0 && total / count != words){errno = ENOMEM; return (void *)0;} void *result = malloc(total); if(result != (void *)0) memset(result, 0, total); return result;}",
    "void *realloc(void *pointer, size_t words){if(pointer == (void *)0) return malloc(words); if(words == 0){free(pointer); return (void *)0;} int old = *((int *)((int)pointer - 4)) - 1; if(words <= old) return pointer; void *next = malloc(words); if(next == (void *)0) return (void *)0; memcpy(next, pointer, old); free(pointer); return next;}",
    "int cs_name_match(char *entry, char *name){int index = 0; while(name[index] != 0 && entry[index] == name[index]) index = index + 1; return name[index] == 0 && entry[index] == 61;}",
    "char *getenv(char *name){int words = 0; int startup = 0; int base = __cs_syscall(CS_SYS_HEAP_INFO, (int)&words, (int)&startup, 0); if(base < 0){errno = -base; return (char *)0;} int *header = (int *)startup; int count = header[4]; char **environment = (char **)header[5]; int index = 0; while(index < count){if(cs_name_match(environment[index], name)) return environment[index] + strlen(name) + 1; index = index + 1;} return (char *)0;}",
    "void abort(void){__cs_syscall(CS_SYS_EXIT, 134, 0, 0);}",
    includePosix
      ? "void exit(int status){__cs_run_atexit(); fflush((FILE *)0); __cs_syscall(CS_SYS_EXIT, status, 0, 0);}"
      : "void exit(int status){__cs_syscall(CS_SYS_EXIT, status, 0, 0);}",
    "void srand(int seed){cs_rand_state = seed;}",
    "int rand(void){cs_rand_state = cs_rand_state * 1103515245 + 12345; return cs_rand_state & 2147483647;}",
    "int islower(int value){return value >= 97 && value <= 122;}",
    "int isupper(int value){return value >= 65 && value <= 90;}",
    "int isalpha(int value){return islower(value) || isupper(value);}",
    "int isdigit(int value){return value >= 48 && value <= 57;}",
    "int isalnum(int value){return isalpha(value) || isdigit(value);}",
    "int isspace(int value){return value == 32 || (value >= 9 && value <= 13);}",
    "int tolower(int value){if(isupper(value)) return value + 32; return value;}",
    "int toupper(int value){if(islower(value)) return value - 32; return value;}",
    'void __cs_assert_fail(void){char *message = "assertion failed\\n"; cs_write(2, message, strlen(message)); exit(134);}',
    "FILE *fopen(char *path, char *mode){int flags = 0; if(mode[0] == 114) flags = CS_O_READ; else if(mode[0] == 119) flags = CS_O_WRITE | CS_O_CREATE | CS_O_TRUNCATE; else if(mode[0] == 97) flags = CS_O_WRITE | CS_O_CREATE | CS_O_APPEND; else {errno = EINVAL; return (FILE *)0;} if(mode[1] == 43) flags = flags | CS_O_READ | CS_O_WRITE; int descriptor = cs_open(path, flags, 438); if(descriptor < 0) return (FILE *)0; FILE *stream = (FILE *)malloc(sizeof(FILE)); if(stream == (FILE *)0){cs_close(descriptor); return (FILE *)0;} stream->descriptor = descriptor; stream->end = 0; stream->error = 0; return stream;}",
    "int fclose(FILE *stream){if(stream == (FILE *)0 || stream->descriptor < 3){errno = EBADF; return -1;} int result = cs_close(stream->descriptor); free(stream); return result;}",
    "size_t fread(void *pointer, size_t size, size_t count, FILE *stream){if(stream == (FILE *)0){errno = EBADF; return 0;} if(size < 0 || count < 0 || (count != 0 && size * count / count != size) || size * count > 4096){errno = EINVAL; stream->error = 1; return 0;} int total = size * count; int result = cs_read(stream->descriptor, pointer, total); if(result < 0){stream->error = 1; return 0;} if(result < total) stream->end = 1; if(size == 0) return 0; return result / size;}",
    "size_t fwrite(void *pointer, size_t size, size_t count, FILE *stream){if(stream == (FILE *)0){errno = EBADF; return 0;} if(size < 0 || count < 0 || (count != 0 && size * count / count != size) || size * count > 4096){errno = EINVAL; stream->error = 1; return 0;} int total = size * count; int result = cs_write(stream->descriptor, pointer, total); if(result < 0){stream->error = 1; return 0;} if(result < total) stream->error = 1; if(size == 0) return 0; return result / size;}",
    "int fseek(FILE *stream, long offset, int whence){if(stream == (FILE *)0){errno = EBADF; return -1;} int result = cs_seek(stream->descriptor, offset, whence); if(result < 0){stream->error = 1; return -1;} stream->end = 0; return 0;}",
    "long ftell(FILE *stream){if(stream == (FILE *)0){errno = EBADF; return -1;} int result = cs_seek(stream->descriptor, 0, CS_SEEK_CUR); if(result < 0) stream->error = 1; return result;}",
    "int fgetc(FILE *stream){if(stream == (FILE *)0){errno = EBADF; return EOF;} int value = 0; int result = cs_read(stream->descriptor, &value, 1); if(result == 1) return value; if(result == 0) stream->end = 1; else stream->error = 1; return EOF;}",
    "int fputc(int value, FILE *stream){if(stream == (FILE *)0){errno = EBADF; return EOF;} int result = cs_write(stream->descriptor, &value, 1); if(result == 1) return value; stream->error = 1; return EOF;}",
    "char *fgets(char *value, int count, FILE *stream){if(count <= 0){errno = EINVAL; return (char *)0;} int index = 0; while(index + 1 < count){int character = fgetc(stream); if(character == EOF) break; value[index] = character; index = index + 1; if(character == 10) break;} value[index] = 0; if(index == 0) return (char *)0; return value;}",
    "int fputs(char *value, FILE *stream){if(stream == (FILE *)0){errno = EBADF; return EOF;} int count = strlen(value); if(count > 4096){errno = EINVAL; stream->error = 1; return EOF;} int result = cs_write(stream->descriptor, value, count); if(result == count) return result; stream->error = 1; return EOF;}",
    "int feof(FILE *stream){if(stream == (FILE *)0){errno = EBADF; return 0;} return stream->end;}",
    "int ferror(FILE *stream){if(stream == (FILE *)0){errno = EBADF; return 1;} return stream->error;}",
    "void clearerr(FILE *stream){if(stream == (FILE *)0){errno = EBADF; return;} stream->end = 0; stream->error = 0;}",
    includeRuntimeFlush
      ? "int fflush(FILE *stream){if(stream == (FILE *)0) return cs_write(1, (void *)0, 0); if(stream->descriptor == 1) return cs_write(1, (void *)0, 0); if(stream->descriptor == 2) return 0; if(stream->descriptor < 0){errno = EBADF; return -1;} return 0;}"
      : "int fflush(FILE *stream){if(stream == (FILE *)0 || stream->descriptor == 1 || stream->descriptor == 2) return 0; if(stream->descriptor < 0){errno = EBADF; return -1;} return 0;}",
    "void rewind(FILE *stream){if(fseek(stream, 0, SEEK_SET) == 0) clearerr(stream);}",
    "int remove(char *path){return cs_remove(path);}",
    "int rename(char *from, char *to){return cs_rename(from, to);}",
    'void perror(char *prefix){if(prefix != (char *)0 && prefix[0] != 0){cs_write(2, prefix, strlen(prefix)); char *separator = ": "; cs_write(2, separator, 2);} char *message = "CS libc error\\n"; cs_write(2, message, strlen(message));}',
    ...(includePosix
      ? [
          "char *getcwd(char *buffer, size_t words){if(buffer == (char *)0 || words < 1 || words > 256){errno = EINVAL; return (char *)0;} return cs_getcwd(buffer, words) < 0 ? (char *)0 : buffer;}",
          "int chdir(char *path){return cs_chdir(path);}",
          "int access(char *path, int mode){return cs_access(path, mode);}",
          "int unlink(char *path){return cs_remove(path);}",
          "int rmdir(char *path){return cs_rmdir(path);}",
          "int mkdir(char *path, int mode){return cs_mkdir(path, mode);}",
          "int stat(char *path, struct stat *result){if(result == (struct stat *)0){errno = EFAULT; return -1;} return cs_stat_extended(path, result);}",
          "DIR *opendir(char *path){int descriptor = cs_opendir(path); if(descriptor < 0) return (DIR *)0; DIR *directory = (DIR *)malloc(sizeof(DIR)); if(directory == (DIR *)0){cs_closedir(descriptor); return (DIR *)0;} directory->descriptor = descriptor; directory->entry.d_name[0] = 0; return directory;}",
          "struct dirent *readdir(DIR *directory){if(directory == (DIR *)0){errno = EBADF; return (struct dirent *)0;} int result = cs_readdir(directory->descriptor, directory->entry.d_name, 256); if(result <= 0) return (struct dirent *)0; return &directory->entry;}",
          "int closedir(DIR *directory){if(directory == (DIR *)0){errno = EBADF; return -1;} int result = cs_closedir(directory->descriptor); if(result == 0) free(directory); return result;}",
          "clock_t clock(void){return cs_clock_ticks();}",
          "time_t time(time_t *result){time_t value = cs_wall_time(); if(value < 0) return -1; if(result != (time_t *)0) *result = value; return value;}",
          "int mkstemp(char *pattern){if(pattern == (char *)0){errno = EINVAL; return -1;} int length = strlen(pattern); if(length < 6 || length >= 256){errno = EINVAL; return -1;} int start = length - 6; int index = 0; while(index < 6){if(pattern[start + index] != 88){errno = EINVAL; return -1;} index = index + 1;} int attempt = 0; while(attempt < 64){int value = cs_temp_counter; cs_temp_counter = cs_temp_counter + 1; index = 5; while(index >= 0){int digit = value % 36; pattern[start + index] = digit < 10 ? 48 + digit : 97 + digit - 10; value = value / 36; index = index - 1;} int descriptor = cs_open(pattern, CS_O_WRITE | CS_O_CREATE | CS_O_EXCLUSIVE, 384); if(descriptor >= 0) return descriptor; if(errno != EEXIST) return -1; attempt = attempt + 1;} errno = EEXIST; return -1;}",
          "cs_sighandler_t signal(int signal_number, cs_sighandler_t handler){if(signal_number < 1 || signal_number >= 32 || signal_number == SIGKILL || signal_number == SIGSTOP){errno = EINVAL; return SIG_DFL;} cs_sighandler_t previous = cs_signal_handlers[signal_number]; cs_signal_handlers[signal_number] = handler; return previous;}",
          "int raise(int signal_number){if(signal_number < 1 || signal_number >= 32 || signal_number == SIGSTOP || signal_number == SIGCONT){errno = EINVAL; return -1;} if(signal_number == SIGKILL) abort(); cs_sighandler_t handler = cs_signal_handlers[signal_number]; if(handler == SIG_IGN) return 0; if(handler == SIG_DFL){exit(128 + signal_number); return 0;} handler(signal_number); return 0;}",
          "int cs_getopt_match(char *options, int value){int index = 0; while(index < 256 && options[index] != 0){if(options[index] == value) return index; index = index + 1;} return -1;}",
          "int getopt(int argc, char **argv, char *options){optarg = (char *)0; if(argc < 0 || argc > 64 || argv == (char **)0 || options == (char *)0){errno = EINVAL; return -1;} if(optind >= argc || optind < 1) return -1; char *argument = argv[optind]; if(argument[0] != 45 || argument[1] == 0) return -1; if(argument[1] == 45 && argument[2] == 0){optind = optind + 1; cs_getopt_offset = 0; return -1;} if(cs_getopt_offset == 0) cs_getopt_offset = 1; int value = argument[cs_getopt_offset]; int match = cs_getopt_match(options, value); optopt = value; if(match < 0 || value == 58){cs_getopt_offset = cs_getopt_offset + 1; if(argument[cs_getopt_offset] == 0){optind = optind + 1; cs_getopt_offset = 0;} return 63;} int requires = options[match + 1] == 58; cs_getopt_offset = cs_getopt_offset + 1; if(requires){if(argument[cs_getopt_offset] != 0){optarg = argument + cs_getopt_offset; optind = optind + 1; cs_getopt_offset = 0;} else if(optind + 1 < argc){optind = optind + 1; optarg = argv[optind]; optind = optind + 1; cs_getopt_offset = 0;} else {optind = optind + 1; cs_getopt_offset = 0; return options[0] == 58 ? 58 : 63;}} else if(argument[cs_getopt_offset] == 0){optind = optind + 1; cs_getopt_offset = 0;} return value;}",
          "int getopt_long(int argc, char **argv, char *options, struct option *long_options, int *long_index){optarg = (char *)0; if(optind < argc && argv[optind][0] == 45 && argv[optind][1] == 45 && argv[optind][2] != 0){char *name = argv[optind] + 2; char *equals = strchr(name, 61); int name_words = equals == (char *)0 ? strlen(name) : equals - name; int index = 0; while(index < 64 && long_options[index].name != (char *)0){if(strnlen(long_options[index].name, 256) == name_words && strncmp(long_options[index].name, name, name_words) == 0){if(long_index != (int *)0) *long_index = index; if(long_options[index].has_arg == required_argument){if(equals != (char *)0) optarg = equals + 1; else if(optind + 1 < argc){optind = optind + 1; optarg = argv[optind];} else {optind = optind + 1; return 63;}} else if(long_options[index].has_arg == optional_argument && equals != (char *)0) optarg = equals + 1; else if(long_options[index].has_arg == no_argument && equals != (char *)0){optind = optind + 1; return 63;} optind = optind + 1; if(long_options[index].flag != (int *)0){*long_options[index].flag = long_options[index].val; return 0;} return long_options[index].val;} index = index + 1;} optind = optind + 1; return 63;} return getopt(argc, argv, options);}",
        ]
      : []),
    ...(includeStdarg
      ? [
          includeFloatFormatting
            ? "int cs_format_validate(char *format){if(format == (char *)0){errno = EINVAL; return -1;} int index = 0; int conversions = 0; while(index < 1024 && format[index] != 0){if(format[index] != 37){index = index + 1; continue;} index = index + 1; while(format[index] == 45 || format[index] == 48) index = index + 1; int width = 0; while(format[index] >= 48 && format[index] <= 57){width = width * 10 + format[index] - 48; if(width > 4096){errno = EINVAL; return -1;} index = index + 1;} if(format[index] == 46){index = index + 1; int precision = 0; while(format[index] >= 48 && format[index] <= 57){precision = precision * 10 + format[index] - 48; if(precision > 18){errno = EINVAL; return -1;} index = index + 1;}} if(index >= 1024 || format[index] == 0){errno = EINVAL; return -1;} int conversion = format[index]; if(conversion != 37){if(conversion != 99 && conversion != 100 && conversion != 102 && conversion != 105 && conversion != 115){errno = EINVAL; return -1;} conversions = conversions + 1; if(conversions > 32){errno = EINVAL; return -1;}} index = index + 1;} if(index >= 1024){errno = EINVAL; return -1;} return conversions;}"
            : "int cs_format_validate(char *format){if(format == (char *)0){errno = EINVAL; return -1;} int index = 0; int conversions = 0; while(index < 1024 && format[index] != 0){if(format[index] != 37){index = index + 1; continue;} index = index + 1; while(format[index] == 45 || format[index] == 48) index = index + 1; int width = 0; while(format[index] >= 48 && format[index] <= 57){width = width * 10 + format[index] - 48; if(width > 4096){errno = EINVAL; return -1;} index = index + 1;} if(format[index] == 46){index = index + 1; int precision = 0; while(format[index] >= 48 && format[index] <= 57){precision = precision * 10 + format[index] - 48; if(precision > 4096){errno = EINVAL; return -1;} index = index + 1;}} if(index >= 1024 || format[index] == 0){errno = EINVAL; return -1;} int conversion = format[index]; if(conversion != 37){if(conversion != 99 && conversion != 100 && conversion != 105 && conversion != 115){errno = EINVAL; return -1;} conversions = conversions + 1; if(conversions > 32){errno = EINVAL; return -1;}} index = index + 1;} if(index >= 1024){errno = EINVAL; return -1;} return conversions;}",
          "void cs_format_put(struct cs_format_output *output, int value){if(output->failed) return; if(output->total >= 64000){errno = EINVAL; output->failed = 1; return;} if(output->stream != (FILE *)0){if(fputc(value, output->stream) == EOF){output->failed = 1; return;}} else if(output->capacity > 0 && output->total < output->capacity - 1) output->buffer[output->total] = value; output->total = output->total + 1;}",
          "void cs_format_repeat(struct cs_format_output *output, int character, int count){while(count > 0 && !output->failed){cs_format_put(output, character); count = count - 1;}}",
          "void cs_format_string(struct cs_format_output *output, char *value, int width, int precision, int left){if(value == (char *)0){errno = EINVAL; output->failed = 1; return;} int count = 0; while(count < 4096 && value[count] != 0) count = count + 1; if(count >= 4096){errno = EINVAL; output->failed = 1; return;} if(precision >= 0 && count > precision) count = precision; int padding = width > count ? width - count : 0; if(!left) cs_format_repeat(output, 32, padding); int index = 0; while(index < count && !output->failed){cs_format_put(output, value[index]); index = index + 1;} if(left) cs_format_repeat(output, 32, padding);}",
          "void cs_format_character(struct cs_format_output *output, int value, int width, int left){int padding = width > 1 ? width - 1 : 0; if(!left) cs_format_repeat(output, 32, padding); cs_format_put(output, value); if(left) cs_format_repeat(output, 32, padding);}",
          "void cs_format_integer(struct cs_format_output *output, int value, int width, int precision, int left, int zero){char digits[16]; int count = 0; int negative = value < 0; int remaining = negative ? value : -value; if(value != 0 || precision != 0){do {digits[count] = 48 - remaining % 10; count = count + 1; remaining = remaining / 10;} while(remaining != 0 && count < 16);} if(remaining != 0){errno = EINVAL; output->failed = 1; return;} int zeroes = precision > count ? precision - count : 0; int total = count + zeroes + negative; int padding = width > total ? width - total : 0; if(zero && precision < 0 && !left){zeroes = zeroes + padding; padding = 0;} if(!left) cs_format_repeat(output, 32, padding); if(negative) cs_format_put(output, 45); cs_format_repeat(output, 48, zeroes); while(count > 0){count = count - 1; cs_format_put(output, digits[count]);} if(left) cs_format_repeat(output, 32, padding);}",
          ...(includeFloatFormatting
            ? [
                "int __cs_fp_f64_format(double value, char *buffer, int precision);",
                "void cs_format_float(struct cs_format_output *output, double value, int width, int precision, int left, int zero){char digits[64]; if(precision < 0) precision = 6; int count = __cs_fp_f64_format(value, digits, precision); if(count < 0 || count >= 64){errno = EINVAL; output->failed = 1; return;} int padding = width > count ? width - count : 0; int index = 0; if(!left && zero && count > 0 && digits[0] == 45){cs_format_put(output, 45); index = 1; cs_format_repeat(output, 48, padding); padding = 0;} else if(!left) cs_format_repeat(output, zero ? 48 : 32, padding); while(index < count){cs_format_put(output, digits[index]); index = index + 1;} if(left) cs_format_repeat(output, 32, padding);}",
              ]
            : []),
          includeFloatFormatting
            ? "int cs_vformat(FILE *stream, char *buffer, int capacity, char *format, va_list *list){if(cs_format_validate(format) < 0) return -1; if(capacity < 0 || capacity > 65536 || (stream == (FILE *)0 && capacity > 0 && buffer == (char *)0)){errno = EINVAL; return -1;} struct cs_format_output output; output.stream = stream; output.buffer = buffer; output.capacity = capacity; output.total = 0; output.failed = 0; int index = 0; while(format[index] != 0 && !output.failed){if(format[index] != 37){cs_format_put(&output, format[index]); index = index + 1; continue;} index = index + 1; int left = 0; int zero = 0; while(format[index] == 45 || format[index] == 48){if(format[index] == 45) left = 1; else zero = 1; index = index + 1;} int width = 0; while(format[index] >= 48 && format[index] <= 57){width = width * 10 + format[index] - 48; index = index + 1;} int precision = -1; if(format[index] == 46){index = index + 1; precision = 0; while(format[index] >= 48 && format[index] <= 57){precision = precision * 10 + format[index] - 48; index = index + 1;}} int conversion = format[index]; index = index + 1; if(conversion == 37) cs_format_character(&output, 37, width, left); else if(conversion == 99) cs_format_character(&output, va_arg(*list, int), width, left); else if(conversion == 100 || conversion == 105) cs_format_integer(&output, va_arg(*list, int), width, precision, left, zero); else if(conversion == 102) cs_format_float(&output, va_arg(*list, double), width, precision, left, zero); else cs_format_string(&output, va_arg(*list, char *), width, precision, left);} if(stream == (FILE *)0 && buffer != (char *)0 && capacity > 0){int terminal = output.total < capacity ? output.total : capacity - 1; buffer[terminal] = 0;} return output.failed ? -1 : output.total;}"
            : "int cs_vformat(FILE *stream, char *buffer, int capacity, char *format, va_list *list){if(cs_format_validate(format) < 0) return -1; if(capacity < 0 || capacity > 65536 || (stream == (FILE *)0 && capacity > 0 && buffer == (char *)0)){errno = EINVAL; return -1;} struct cs_format_output output; output.stream = stream; output.buffer = buffer; output.capacity = capacity; output.total = 0; output.failed = 0; int index = 0; while(format[index] != 0 && !output.failed){if(format[index] != 37){cs_format_put(&output, format[index]); index = index + 1; continue;} index = index + 1; int left = 0; int zero = 0; while(format[index] == 45 || format[index] == 48){if(format[index] == 45) left = 1; else zero = 1; index = index + 1;} int width = 0; while(format[index] >= 48 && format[index] <= 57){width = width * 10 + format[index] - 48; index = index + 1;} int precision = -1; if(format[index] == 46){index = index + 1; precision = 0; while(format[index] >= 48 && format[index] <= 57){precision = precision * 10 + format[index] - 48; index = index + 1;}} int conversion = format[index]; index = index + 1; if(conversion == 37) cs_format_character(&output, 37, width, left); else if(conversion == 99) cs_format_character(&output, va_arg(*list, int), width, left); else if(conversion == 100 || conversion == 105) cs_format_integer(&output, va_arg(*list, int), width, precision, left, zero); else cs_format_string(&output, va_arg(*list, char *), width, precision, left);} if(stream == (FILE *)0 && buffer != (char *)0 && capacity > 0){int terminal = output.total < capacity ? output.total : capacity - 1; buffer[terminal] = 0;} return output.failed ? -1 : output.total;}",
          "int printf(char *format, ...){va_list list; va_start(list, format); int result = cs_vformat(stdout, (char *)0, 0, format, &list); va_end(list); return result;}",
          "int fprintf(FILE *stream, char *format, ...){if(stream == (FILE *)0){errno = EBADF; return -1;} va_list list; va_start(list, format); int result = cs_vformat(stream, (char *)0, 0, format, &list); va_end(list); return result;}",
          "int vsnprintf(char *buffer, size_t size, char *format, va_list *list){if(list == (va_list *)0){errno = EINVAL; return -1;} va_list copy; copy.next = list->next; copy.remaining = list->remaining; int result = cs_vformat((FILE *)0, buffer, size, format, &copy); va_end(copy); return result;}",
          "int snprintf(char *buffer, size_t size, char *format, ...){va_list list; va_start(list, format); int result = cs_vformat((FILE *)0, buffer, size, format, &list); va_end(list); return result;}",
        ]
      : []),
  ].join("\n");
}
