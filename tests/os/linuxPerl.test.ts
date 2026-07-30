import { describe, expect, it } from "vitest";

import {
  executeLinuxPerl,
  executePreparedLinuxPerl,
  linuxPerlLimits,
  linuxPerlVersion,
  prepareLinuxPerlCommand,
  type LinuxPerlExecutionInput,
  type LinuxPerlIo,
} from "../../src/application/os/linuxPerl.js";
import { CredentialedFilesystem } from "../../src/application/os/credentialedFilesystem.js";
import { rootCredentials } from "../../src/application/os/linuxCredentials.js";
import { ShellSession } from "../../src/application/os/shellSession.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";

interface PerlRun {
  readonly code: number;
  readonly err: string;
  readonly out: string;
}

function hostedIo(files: Map<string, string>): LinuxPerlIo {
  return {
    environment: new Map([
      ["HOME", "/home/cs"],
      ["USER", "cs"],
    ]),
    isDirectory: (path) => path === "/tmp",
    pathExists: (path) => files.has(path) || path === "/tmp",
    readFile: (path): string => {
      const value = files.get(path);
      if (value === undefined) {
        throw new Error(`${path}: No such file or directory`);
      }
      return value;
    },
    writeFile: (path, contents, append): void => {
      files.set(path, append ? (files.get(path) ?? "") + contents : contents);
    },
  };
}

function run(
  arguments_: readonly string[],
  stdin = "",
  files = new Map<string, string>(),
): PerlRun {
  const result = executeLinuxPerl(arguments_, stdin, hostedIo(files));
  return { code: result.exitCode, err: result.stderr, out: result.stdout };
}

function runPrepared(
  arguments_: readonly string[],
  input: LinuxPerlExecutionInput,
  files = new Map<string, string>(),
): PerlRun {
  const io = hostedIo(files);
  const result = executePreparedLinuxPerl(
    prepareLinuxPerlCommand(arguments_, io),
    input,
    io,
  );
  return { code: result.exitCode, err: result.stderr, out: result.stdout };
}

function linuxSession(): ShellSession {
  return new ShellSession(new InMemoryFilesystem(), { osProfile: "linux" });
}

describe("CS-Linux perl command preparation", (): void => {
  it("distinguishes inline, script, stdin, version, and invalid commands", (): void => {
    const files = new Map<string, string>([
      ["/tmp/program.pl", 'print "ok\\n";'],
    ]);
    const io = hostedIo(files);

    expect(prepareLinuxPerlCommand(["-e", 'print "ok\\n";'], io).kind).toBe(
      "inline",
    );
    expect(prepareLinuxPerlCommand(["/tmp/program.pl"], io).kind).toBe(
      "script",
    );
    expect(prepareLinuxPerlCommand([], io).kind).toBe("stdin");
    expect(prepareLinuxPerlCommand(["-"], io).kind).toBe("stdin");
    expect(prepareLinuxPerlCommand(["-v"], io).kind).toBe("version");
    expect(prepareLinuxPerlCommand(["-e"], io)).toMatchObject({
      kind: "invalid",
      message: "option -e requires code",
    });
  });

  it("keeps clustered options and inline-program arguments out of stdin-source mode", (): void => {
    const io = hostedIo(new Map());
    const stdin = prepareLinuxPerlCommand(["-F:", "-lna", "-", "kept"], io);
    const inline = prepareLinuxPerlCommand(
      ["-lane", 'print "$F[0]";', "-"],
      io,
    );

    expect(stdin).toMatchObject({
      kind: "stdin",
      options: {
        autosplit: true,
        fieldSeparator: ":",
        lineEnding: true,
        loop: "quiet",
      },
      scriptArguments: ["kept"],
    });
    expect(inline).toMatchObject({
      kind: "inline",
      scriptArguments: ["-"],
    });
  });
});

describe("CS-Linux perl stdin-source execution", (): void => {
  it("runs supplied piped source immediately for bare perl and explicit dash", (): void => {
    expect(
      runPrepared([], { kind: "source", source: 'print "bare\\n";' }),
    ).toEqual({ code: 0, err: "", out: "bare\n" });
    expect(
      runPrepared(["-"], { kind: "source", source: 'print "dash\\n";' }),
    ).toEqual({ code: 0, err: "", out: "dash\n" });
  });

  it("accepts an explicitly supplied empty program and never replays it as runtime stdin", (): void => {
    expect(runPrepared([], { kind: "source", source: "" })).toEqual({
      code: 0,
      err: "",
      out: "",
    });
    expect(
      runPrepared(["-"], {
        kind: "source",
        source: 'while (<STDIN>) { print "source was replayed\\n"; }',
      }),
    ).toEqual({ code: 0, err: "", out: "" });
  });

  it("requires tagged source input instead of interpreting ordinary data stdin as a program", (): void => {
    expect(run([], 'print "not a program\\n";')).toEqual({
      code: 2,
      err: "perl: program source must be supplied explicitly\n",
      out: "",
    });
  });

  it("keeps inline and script runtime data stdin separate from their source", (): void => {
    const files = new Map<string, string>([
      ["/tmp/filter.pl", "while (<STDIN>) { print uc $_; }"],
    ]);

    expect(run(["-pe", "s/a/A/g;"], "a\n")).toEqual({
      code: 0,
      err: "",
      out: "A\n",
    });
    expect(run(["/tmp/filter.pl"], "a\n", files)).toEqual({
      code: 0,
      err: "",
      out: "A\n",
    });
  });

  it("accepts exactly 64 KiB of UTF-8 source and rejects one byte more", (): void => {
    const exact = `#${"é".repeat(32_767)}\n`;

    expect(runPrepared([], { kind: "source", source: exact })).toEqual({
      code: 0,
      err: "",
      out: "",
    });
    const plusOne = runPrepared([], { kind: "source", source: `${exact}x` });
    expect(plusOne.code).toBe(255);
    expect(plusOne.out).toBe("");
    expect(plusOne.err).toContain("program byte limit exceeded");
  });
});

describe("bounded CS-Linux perl one-liners", (): void => {
  it("prints from -e and reports its version", (): void => {
    expect(run(["-e", 'print "hi\\n";'])).toEqual({
      code: 0,
      err: "",
      out: "hi\n",
    });
    expect(run(["-v"]).out).toContain(linuxPerlVersion);
  });

  it("splits records with -l, -a, -n, and -F", (): void => {
    expect(run(["-lane", 'print "$F[0]:$F[1]";'], "a 1\nb 2\n").out).toBe(
      "a:1\nb:2\n",
    );
    expect(
      run(["-F", ":", "-lane", "print $F[2];"], "root:x:0\ncs:x:1000\n").out,
    ).toBe("0\n1000\n");
  });

  it("edits every record in place with -p", (): void => {
    expect(run(["-pe", "s/o/0/g;"], "one\ntwo\n").out).toBe("0ne\ntw0\n");
  });

  it("tracks the record number in $. and the script name in $0", (): void => {
    expect(run(["-lne", 'print "$.:$_" if /b/;'], "alpha\nbeta\n").out).toBe(
      "2:beta\n",
    );
    expect(run(["-e", 'print "$0\\n";']).out).toBe("-e\n");
  });

  it("checks syntax only under -c without running the program", (): void => {
    const checked = run(["-ce", 'print "never\\n";']);

    expect(checked.code).toBe(0);
    expect(checked.out).toBe("");
    expect(checked.err).toContain("syntax OK");
  });

  it("exposes %ENV and @ARGV without touching the host", (): void => {
    expect(run(["-e", 'print "$ENV{HOME}\\n";']).out).toBe("/home/cs\n");
    expect(
      run(["-e", 'print join("|", @ARGV), "\\n";', "one", "two"]).out,
    ).toBe("one|two\n");
  });
});

describe("bounded CS-Linux perl language surface", (): void => {
  it("runs the modern strict/warnings/say surface", (): void => {
    const program = [
      "use v5.40;",
      "use strict;",
      "use warnings;",
      "my @words = qw(delta alpha charlie bravo);",
      "for my $word (sort @words) { say uc $word; }",
      "my %seen; $seen{$_}++ for @words;",
      "say scalar keys %seen;",
    ].join("\n");

    expect(run(["-e", program]).out).toBe("ALPHA\nBRAVO\nCHARLIE\nDELTA\n4\n");
  });

  it("combines my, arrays, hashes, foreach, sub, sort, grep, map, s///g, and captures", (): void => {
    const program = [
      "use strict;",
      "use warnings;",
      "my %stock = (bolt => 12, nut => 3, washer => 7);",
      "sub label { my ($name, $count) = @_; return sprintf('%-6s %3d', $name, $count); }",
      "my @busy = grep { $stock{$_} > 5 } sort keys %stock;",
      'foreach my $name (@busy) { print label($name, $stock{$name}), "\\n"; }',
      "my @loud = map { uc } @busy;",
      'print join(",", @loud), "\\n";',
      'my $line = "part=bolt qty=12";',
      'if ($line =~ /part=(\\w+) qty=(\\d+)/) { print "$1 -> $2\\n"; }',
      "(my $slug = $line) =~ s/[= ]/-/g;",
      'print "$slug\\n";',
    ].join("\n");

    expect(run(["-e", program])).toEqual({
      code: 0,
      err: "",
      out: "bolt    12\nwasher   7\nBOLT,WASHER\nbolt -> 12\npart-bolt-qty-12\n",
    });
  });

  it("recurses through subroutines and formats with sprintf", (): void => {
    const program = [
      "sub fib { my ($n) = @_; return $n < 2 ? $n : fib($n - 1) + fib($n - 2); }",
      'printf("%05.2f|%-6s|%3d|%x\\n", 3.14159, "ok", 42, 255);',
      'print fib(10), "\\n";',
    ].join("\n");

    expect(run(["-e", program]).out).toBe("03.14|ok    | 42|ff\n55\n");
  });

  it("transliterates, reverses, and counts with the bounded matcher", (): void => {
    const program = [
      'my $text = "hello world";',
      "(my $upper = $text) =~ tr/a-z/A-Z/;",
      'print "$upper\\n";',
      "my $vowels = ($text =~ tr/aeiou//);",
      'print "$vowels\\n";',
      'print scalar reverse("abc"), "\\n";',
      'print join("|", split(//, "xyz")), "\\n";',
    ].join("\n");

    expect(run(["-e", program]).out).toBe("HELLO WORLD\n3\ncba\nx|y|z\n");
  });

  it("traps a die inside eval BLOCK and reports it through $@", (): void => {
    const program = [
      'my $value = eval { die "inner failure\\n"; 1 };',
      'print defined $value ? "defined\\n" : "undef\\n";',
      'print "caught: $@";',
      'print "still running\\n";',
    ].join("\n");

    expect(run(["-e", program])).toEqual({
      code: 0,
      err: "",
      out: "undef\ncaught: inner failure\nstill running\n",
    });
  });

  it("reports die on stderr with exit 255 and warn without ending the program", (): void => {
    expect(
      run(["-e", 'print "before\\n"; die "boom\\n"; print "after\\n";']),
    ).toEqual({ code: 255, err: "boom\n", out: "before\n" });
    expect(run(["-e", 'warn "careful\\n"; print "done\\n";'])).toEqual({
      code: 0,
      err: "careful\n",
      out: "done\n",
    });
    expect(run(["-e", "exit 3;"]).code).toBe(3);
  });
});

describe("CS-Linux perl differential fidelity", (): void => {
  it("keeps split limits, chomp results, and four-argument substr faithful", (): void => {
    const program = [
      'print scalar(my @a = split(/,/, "a,b,,")), "\\n";',
      'print scalar(my @b = split(/,/, "a,b,,", -1)), "\\n";',
      'my $line = "text\\n"; my $removed = chomp $line;',
      'print "$removed|$line|\\n";',
      'my $word = "abc"; my $last = chop $word;',
      'print "$last|$word\\n";',
      'my $text = "hello world";',
      'my $cut = substr($text, 0, 5, "HI");',
      'print "$cut|$text\\n";',
      'substr($text, 0, 2) = "yo";',
      'print "$text\\n";',
    ].join("\n");

    expect(run(["-e", program]).out).toBe(
      "2\n4\n1|text|\nc|ab\nhello|HI world\nyo world\n",
    );
  });

  it("matches perl on multiline anchors, match variables, and 64-bit bitwise", (): void => {
    const program = [
      'my $count = 0; $count++ while "a\\nb\\n" =~ /^/mg;',
      'print "$count\\n";',
      '"abcdef" =~ /cd/;',
      'print "$`|$&|$\'\\n";',
      'print ~0 & 255, "\\n";',
      'print 1 << 40, "\\n";',
      'print 1 << 64, "\\n";',
    ].join("\n");

    expect(run(["-e", program]).out).toBe(
      "2\nab|cd|ef\n255\n1099511627776\n0\n",
    );
  });

  it("applies tr modifiers and resizes an array through $#", (): void => {
    const program = [
      'my $text = "hello world";',
      "my $kept = ($text =~ tr/a-z//cd);",
      'print "$kept|$text\\n";',
      'print "aaabbb" =~ tr/ab/xy/rs, "\\n";',
      'my $kept2 = "abc"; print $kept2 =~ s/b/B/r, "|$kept2\\n";',
      "my @a = (1 .. 5); $#a = 2;",
      'print join(",", @a), "\\n";',
      "my %h = (a => 1, b => 2, c => 3);",
      "my @slice = @h{qw(a c)};",
      'print join(",", @slice), "\\n";',
      "@h{qw(x y)} = (8, 9);",
      'print "$h{x}$h{y}\\n";',
    ].join("\n");

    expect(run(["-e", program]).out).toBe(
      "1|helloworld\nxy\naBc|abc\n1,2,3\n1,3\n89\n",
    );
  });

  it("reads a bare while (<STDIN>) into $_ like perl does", (): void => {
    expect(run(["-e", 'while (<STDIN>) { print "[$_]"; }'], "a\nb\n").out).toBe(
      "[a\n][b\n]",
    );
  });

  it("treats undef as undefined rather than an empty string", (): void => {
    const program = [
      'my $x = undef; print defined($x) ? "d" : "u";',
      "my %h; $h{a} = undef;",
      'print exists $h{a} ? "e" : "-";',
      'print defined $h{a} ? "d" : "-";',
      "my @a = (1, 2, 3); undef @a;",
      'print scalar(@a), "\\n";',
      "sub first { my $n = shift // 5; return $n }",
      'print first(), first(9), "\\n";',
    ].join("\n");

    expect(run(["-e", program]).out).toBe("ue-0\n59\n");
  });

  it("repeats in place with x= and reads a 0x prefix through hex", (): void => {
    const program = [
      'my $bar = "ab"; $bar x= 3;',
      'print "$bar\\n";',
      'print hex("0xff"), " ", hex("ff"), " ", oct("0755"), "\\n";',
      'print quotemeta("a.b"), "\\n";',
    ].join("\n");

    expect(run(["-e", program]).out).toBe("ababab\n255 255 493\na\\.b\n");
  });

  it("jumps to a labelled loop with next and last", (): void => {
    const program = [
      "OUTER: for my $i (1 .. 3) {",
      "  for my $j (1 .. 3) {",
      "    next OUTER if $j == 2;",
      '    print "$i$j ";',
      "  }",
      "}",
      'print "\\n";',
      "STOP: for my $i (1 .. 3) {",
      "  for my $j (1 .. 3) {",
      "    last STOP if $i == 2;",
      '    print "$i$j ";',
      "  }",
      "}",
      'print "\\n";',
    ].join("\n");

    expect(run(["-e", program]).out).toBe("11 21 31 \n11 12 13 \n");
  });

  it("rejects a label on anything but a loop", (): void => {
    const result = run(["-e", 'DONE: print "no\\n";']);

    expect(result.code).toBe(255);
    expect(result.out).toBe("");
    expect(result.err).toContain("labels are supported only on");
  });

  it("evaluates an s///e replacement as perl code", (): void => {
    const program = [
      'my $text = "a1b2";',
      "my $count = ($text =~ s/(\\d)/$1 * 2/ge);",
      'print "$count $text\\n";',
      'my $words = "one two";',
      "$words =~ s/(\\w+)/uc($1)/e;",
      'print "$words\\n";',
    ].join("\n");

    expect(run(["-e", program]).out).toBe("2 a2b4\nONE two\n");
  });

  it("rejects an s///e replacement that is not one expression", (): void => {
    const result = run(["-e", 'my $t = "a"; $t =~ s/a/1; 2/e;']);

    expect(result.code).toBe(255);
    expect(result.err).toContain("one replacement expression");
  });

  it("reads interpolating, literal, and indented here-documents", (): void => {
    const program = [
      "my $value = 2;",
      "print <<END;",
      "value $value",
      "END",
      "print <<'RAW';",
      "literal $value",
      "RAW",
      "print <<~TRIM;",
      "    indented",
      "      deeper",
      "    TRIM",
      "print <<A, <<B;",
      "first",
      "A",
      "second",
      "B",
      'print 1 << 4, "\\n";',
    ].join("\n");

    expect(run(["-e", program]).out).toBe(
      "value 2\nliteral $value\nindented\n  deeper\nfirst\nsecond\n16\n",
    );
  });

  it("fails an unterminated here-document instead of running the program", (): void => {
    const result = run(["-e", "print <<END;\nbody\n"]);

    expect(result.code).toBe(255);
    expect(result.out).toBe("");
    expect(result.err).toContain("was not terminated");
  });
});

describe("bounded CS-Linux perl guest file I/O", (): void => {
  it("reads and writes only through the guest filesystem", (): void => {
    const files = new Map<string, string>([["/tmp/in.txt", "one\ntwo\n"]]);
    const program = [
      'open(my $in, "<", "/tmp/in.txt") or die "cannot read: $!";',
      'open(my $out, ">", "/tmp/out.txt") or die "cannot write: $!";',
      'while (my $line = <$in>) { chomp $line; print $out uc($line), "\\n"; }',
      "close($in); close($out);",
      'open(my $log, ">>", "/tmp/out.txt") or die "cannot append: $!";',
      'print $log "THREE\\n";',
      "close($log);",
      'print -e "/tmp/out.txt" ? "written\\n" : "missing\\n";',
    ].join("\n");

    const result = run(["-e", program], "", files);

    expect(result).toEqual({ code: 0, err: "", out: "written\n" });
    expect(files.get("/tmp/out.txt")).toBe("ONE\nTWO\nTHREE\n");
  });

  it("fails an unreadable path without leaking a host path", (): void => {
    const result = run([
      "-e",
      'open(my $in, "<", "/tmp/absent.txt") or die "open failed: $!\\n";',
    ]);

    expect(result.code).toBe(255);
    expect(result.err).toBe("open failed: No such file or directory\n");
    expect(result.err).not.toContain("\\");
  });

  it("runs a script file with its own @ARGV", (): void => {
    const files = new Map<string, string>([
      [
        "/tmp/report.pl",
        [
          "use strict;",
          "use warnings;",
          "my $total = 0;",
          "$total += $_ for @ARGV;",
          'print "$0 sum=$total\\n";',
        ].join("\n"),
      ],
    ]);

    expect(run(["/tmp/report.pl", "2", "3", "4"], "", files)).toEqual({
      code: 0,
      err: "",
      out: "/tmp/report.pl sum=9\n",
    });
  });
});

describe("bounded CS-Linux perl explicit rejections", (): void => {
  it("rejects an unsupported module without partial output", (): void => {
    const result = run(["-e", 'print "partial\\n"; use nonesuch;']);

    expect(result.code).toBe(255);
    expect(result.out).toBe("");
    expect(result.err).toContain("unavailable in CS-Linux perl");
  });

  it("rejects references, bless, eval STRING, and host escapes at compile time", (): void => {
    for (const program of [
      "my $ref = \\my $x;",
      "my $obj = bless {}, 'Thing';",
      'eval "1 + 1";',
      'system("ls");',
      "my $pid = fork();",
      'open(my $fh, "-|", "ls");',
    ]) {
      const result = run(["-e", program]);

      expect(result.code).toBe(255);
      expect(result.out).toBe("");
      expect(result.err).not.toBe("");
    }
  });

  it("has no wall clock, so time() fails instead of leaking host time", (): void => {
    const result = run(["-e", 'print time(), "\\n";']);

    expect(result.code).toBe(255);
    expect(result.out).toBe("");
    expect(result.err).toContain("wall clock");
  });

  it("reports a usage error for an unknown switch", (): void => {
    const result = run(["-Z", "-e", "1;"]);

    expect(result.code).toBe(2);
    expect(result.err).toContain("Unrecognized switch");
  });
});

describe("bounded CS-Linux perl limits", (): void => {
  it("stops a runaway loop at the step limit instead of hanging", (): void => {
    const result = run(["-e", "while (1) { my $x = 1; }"]);

    expect(result.code).toBe(2);
    expect(result.err).toContain("step limit exceeded");
  });

  it("stops unbounded output at the output limit", (): void => {
    const result = run(["-e", 'while (1) { print "xxxxxxxxxxxxxxxx"; }']);

    expect(result.code).toBe(2);
    expect(result.err).toContain("output byte limit exceeded");
    expect(result.out.length).toBeLessThanOrEqual(
      linuxPerlLimits.maximumOutputBytes,
    );
  });

  it("rejects one element beyond the array capacity", (): void => {
    const index = linuxPerlLimits.maximumArrayElements;
    const result = run(["-e", `my @a; $a[${String(index)}] = 1;`]);

    expect(result.code).toBe(2);
    expect(result.err).toContain("limit exceeded");
  });

  it("rejects recursion beyond the call-depth limit", (): void => {
    const result = run(["-e", "sub deep { return deep() + 1; } deep();"]);

    expect(result.code).toBe(2);
    expect(result.err).toContain("call depth");
  });
});

describe("CS-Linux perl shell integration", (): void => {
  it("runs one-liners and pipelines from the guest shell", (): void => {
    const session = linuxSession();

    expect(session.submit(`perl -e 'print "hi\\n";'`)).toMatchObject({
      exitCode: 0,
      stdout: "hi\n",
    });
    expect(
      session.submit(
        `printf 'a 1\\nb 2\\n' | perl -lane 'print "$F[0]:$F[1]";'`,
      ),
    ).toMatchObject({ exitCode: 0, stdout: "a:1\nb:2\n" });
  });

  it("reads and writes guest files under the session credential", (): void => {
    const session = linuxSession();

    expect(
      session.submit(`printf 'one\\ntwo\\n' > /tmp/perl-in.txt`).exitCode,
    ).toBe(0);
    expect(
      session.submit(
        `perl -e 'open(my $in, "<", "/tmp/perl-in.txt") or die; while (my $l = <$in>) { chomp $l; print uc($l), "\\n"; } close($in);'`,
      ),
    ).toMatchObject({ exitCode: 0, stdout: "ONE\nTWO\n" });
  });

  it("documents itself through man and the help index", (): void => {
    const session = linuxSession();

    expect(session.submit("man perl").stdout).toContain(
      "bounded Perl 5 interpreter",
    );
    expect(session.submit("help").stdout).toContain(" perl ");
    expect(session.submit("which perl").stdout).toBe("/usr/bin/perl\n");
  });

  it("returns 127 once the installed executable is deleted", (): void => {
    const filesystem = new InMemoryFilesystem();
    const session = new ShellSession(filesystem, { osProfile: "linux" });

    expect(session.submit(`perl -e 'print "ok\\n";'`).exitCode).toBe(0);
    expect(session.submit("rm /usr/bin/perl").stderr).toContain(
      "Permission denied",
    );
    new CredentialedFilesystem(filesystem, rootCredentials).delete(
      "/usr/bin/perl",
    );

    const missing = session.submit(`perl -e 'print "ok\\n";'`);

    expect(missing.exitCode).toBe(127);
    expect(missing.stdout).toBe("");
    expect(missing.stderr).toContain("perl");
  });
});
