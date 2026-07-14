const chapters = [
  {
    id: "orientation",
    number: "01",
    title: "System orientation",
    summary: "Boot, edit, execute, observe",
    html: `
      <header class="manual-page-header">
        <p class="manual-kicker">Chapter 01 · Operator orientation</p>
        <h2>From powered block to running program</h2>
        <p class="manual-lead">A Computer is a persistent, sandboxed machine. The desktop runs Computer System Linux 1.0 (CS-Linux 1.0); the portable runs Computer System DOS 6.2 (CS-DOS 6.2). Its terminal, files, redstone state, CPU budget, and RAM belong to its identity and survive normal world reloads.</p>
      </header>
      <div class="manual-spec-line"><span>Desktop</span><b>CS486DX · 33 MHz · 2 MiB</b><span>Advanced</span><b>CS486DX2 · 66 MHz · 8 MiB</b><span>Portable</span><b>CS386SX · 16 MHz · 2 MiB</b></div>
      <section class="manual-section">
        <h3>1.1 Operating cycle</h3>
        <ol class="manual-procedure">
          <li><b>Inspect.</b> Run <code>cpuinfo</code>, <code>free -h</code>, and <code>quota</code>.</li>
          <li><b>Edit.</b> Use <code>vi</code> for source files. Desktop MicroPython starts at <code>/startup.py</code>; the portable DOS profile uses <code>AUTOEXEC.BAT</code>.</li>
          <li><b>Build.</b> Use <code>as</code>, <code>basicc</code>, <code>cc</code>, or <code>c++</code>; add <code>-c</code> for an object and combine objects with <code>ld</code>.</li>
          <li><b>Measure.</b> Run compiled programs with <code>run --stats</code>.</li>
          <li><b>Optimize.</b> Compare instructions, cycles, output, and memory use—not host wall time.</li>
        </ol>
      </section>
      <section class="manual-section manual-grid-2">
        <div><h3>Persistent</h3><p><code>/etc</code>, <code>/usr</code>, home files, executables, terminal snapshot, identity, and configured hardware.</p></div>
        <div><h3>Volatile or bounded</h3><p><code>/tmp</code>, active VM frames, event queues, compiler work, terminal output, retries, and each direct machine run.</p></div>
      </section>
      <aside class="manual-callout"><b>Safety boundary</b><p>No guest language launches PowerShell, cmd.exe, a host compiler, BDS administration, or native binaries. Unsupported behavior fails inside the guest.</p></aside>
      <section class="manual-section"><h3>1.2 First inspection</h3><pre><code>whoami
pwd
cpuinfo
free -h
df
quota
ls -la /</code></pre></section>`,
  },
  {
    id: "architecture",
    number: "02",
    title: "Machine architecture",
    summary: "Registers, memory, cycles, faults",
    html: `
      <header class="manual-page-header"><p class="manual-kicker">Chapter 02 · Hardware model</p><h2>Three machine profiles, one safe instruction format</h2><p class="manual-lead">Desktop Computer Systems select a CS486DX at 33 MHz with 2 MiB RAM; Advanced Desktop Computer Systems select a CS486DX2 at 66 MHz with 8 MiB RAM; the Portable Computer System selects a CS386SX at 16 MHz with 2 MiB RAM. The persisted CPU model selects timing in O(1), while the bounded scheduler arbitrates actual BDS work fairly.</p></header>
      <figure class="manual-figure manual-figure--desktop"><img src="/assets/manual/desktop-computer-system.png" alt="Desktop Computer System with a 486DX 33 MHz system unit, monochrome CRT, keyboard, mouse, and floppy drives" loading="lazy" decoding="async"><figcaption><b>Desktop Computer System.</b> The workstation illustration establishes the nominal CS486DX hardware identity. The Minecraft implementation models the machine rather than emulating the pictured host hardware literally.</figcaption></figure>
      <section class="manual-section"><h3>2.1 Machine family</h3><div class="manual-asset-grid manual-asset-grid--machines">
        <figure class="manual-asset-card"><img src="/assets/machines/cs-computer.png" alt="Desktop Computer System single-drive chassis" loading="lazy" decoding="async"><figcaption><b>Desktop Computer System</b><span>CS486DX · 33 MHz · 2 MiB · CS-Linux 1.0</span></figcaption></figure>
        <figure class="manual-asset-card"><img src="/assets/machines/cs-advanced-computer.png" alt="Advanced Desktop Computer System dual-drive chassis" loading="lazy" decoding="async"><figcaption><b>Advanced Desktop Computer System</b><span>CS486DX2 · 66 MHz · 8 MiB · CS-Linux 1.0</span></figcaption></figure>
        <figure class="manual-asset-card"><img src="/assets/machines/cs-monitor.png" alt="Computer System CRT monitor" loading="lazy" decoding="async"><figcaption><b>Monitor</b><span>Terminal and display peripheral; no independent CPU or RAM.</span></figcaption></figure>
        <figure class="manual-asset-card"><img src="/assets/machines/cs-portable-computer.png" alt="Portable Computer System laptop with trackball" loading="lazy" decoding="async"><figcaption><b>Portable Computer System</b><span>CS386SX · 16 MHz · 2 MiB · CS-DOS 6.2 · held or placed</span></figcaption></figure>
      </div></section>
      <section class="manual-section"><h3>2.2 Processor identity</h3><div class="manual-asset-grid manual-asset-grid--cpu">
        <figure class="manual-asset-card"><img src="/assets/cpu/CS486DX.png" alt="CS486DX processor identification plate" loading="lazy" decoding="async"><figcaption><b>CS486DX</b><span>Standard desktop processor</span></figcaption></figure>
        <figure class="manual-asset-card"><img src="/assets/cpu/CS486DX2.png" alt="CS486DX2 processor identification plate" loading="lazy" decoding="async"><figcaption><b>CS486DX2</b><span>Advanced desktop processor</span></figcaption></figure>
        <figure class="manual-asset-card"><img src="/assets/cpu/CS386SX.png" alt="CS386SX processor identification plate" loading="lazy" decoding="async"><figcaption><b>CS386SX</b><span>Portable processor with a 16-bit external data bus</span></figcaption></figure>
      </div></section>
      <section class="manual-section"><h3>2.3 Register file</h3>
        <table><thead><tr><th>Register</th><th>Conventional use</th><th>Width</th></tr></thead><tbody>
          <tr><td>EAX</td><td>Accumulator and expression result</td><td>32 bit</td></tr><tr><td>EBX</td><td>Secondary operand</td><td>32 bit</td></tr>
          <tr><td>ECX</td><td>Loop counter</td><td>32 bit</td></tr><tr><td>EDX</td><td>General data</td><td>32 bit</td></tr>
          <tr><td>ESI / EDI</td><td>Source / destination index</td><td>32 bit</td></tr><tr><td>ESP / EBP</td><td>Stack top / initial stack base</td><td>32 bit</td></tr>
        </tbody></table>
      </section>
      <section class="manual-section manual-grid-2"><div><h3>2.4 Memory model</h3><p>RAM is a checked, little-endian linear byte array. <code>LOAD</code> and <code>STORE</code> transfer signed 32-bit words. CS386SX exposes a 24-bit address bus and a 16-bit data bus, with 2 MiB installed in the portable profile; dword transfers pay the narrower-bus timing. The stack begins at the top of RAM and grows downward.</p><p>Memory reports include bounded OS overhead as well as live guest data. CS-Linux separates resident kernel, system services, buffers, and guest runtime. CS-DOS separates DOS system/drivers and guest runtime while preserving conventional, upper, reserved, and XMS region totals.</p></div><div class="manual-memory-map"><span>LOW ADDRESS</span><b>OS resident memory</b><b>compiler variables / heap</b><b>free space</b><b>↓ stack growth</b><span>HIGH ADDRESS</span></div></section>
      <section class="manual-section"><h3>2.5 Model-specific cycle classes</h3><table><thead><tr><th>Class</th><th>CS486DX / CS486DX2</th><th>CS386SX</th></tr></thead><tbody><tr><td>Simple ALU</td><td>1</td><td>2</td></tr><tr><td>LOAD / STORE</td><td>2 / 2</td><td>6 / 4</td></tr><tr><td>PUSH / POP</td><td>2 / 2</td><td>4 / 6</td></tr><tr><td>Conditional branch</td><td>1</td><td>7 taken / 3 not taken</td></tr><tr><td>CALL / RET</td><td>3 / 3</td><td>9 / 12</td></tr><tr><td>MUL</td><td>9</td><td>9–38, operand early-out</td></tr><tr><td>DIV / MOD</td><td>40</td><td>43</td></tr><tr><td>PRINT</td><td>8 + payload</td><td>12 + 16-bit bus payload</td></tr></tbody></table><p>At 20 ticks per second the standard desktop receives 1,650,000 cycles/tick, the Advanced Desktop receives 3,300,000 cycles/tick, and the portable receives 800,000 cycles/tick. CS486DX2 uses the same 486 instruction costs as CS486DX but its doubled clock halves virtual execution time for equal work. Timing lookup is O(1), so selecting a model does not add a scan to the execution hot path.</p></section>
      <aside class="manual-warning"><b>Terminal condition required</b><p>A direct run halts normally, faults, or yields after 10,000 instructions with exit status 124. It never owns the server tick indefinitely.</p></aside>`,
  },
  {
    id: "assembly",
    number: "10",
    title: "Assembly language",
    summary: "Complete CS486 instruction reference",
    html: `
      <header class="manual-page-header"><p class="manual-kicker">Chapter 10 · Low-level programming</p><h2>CS486 assembly language</h2><p class="manual-lead">One instruction per line. Labels end in a colon; semicolons begin comments. Registers are case-insensitive. Memory operands use square brackets.</p></header>
      <section class="manual-section"><h3>10.1 Build and inspect</h3><pre><code>as total.asm -o total
objdump total
run --stats total
./total

as -c fast.asm -o fast.o
nm fast.o
objdump fast.o</code></pre><p>Relocatable assembly declares exported labels with <code>global name</code> and imported labels with <code>extern name</code>. Unmarked labels remain local to that object.</p></section>
      <section class="manual-section"><h3>10.2 Instruction set</h3><table class="manual-instruction-table"><thead><tr><th>Form</th><th>Operation</th></tr></thead><tbody>
        <tr><td>MOV reg, src</td><td>Copy immediate or register</td></tr><tr><td>LOAD reg, [addr]</td><td>Read signed 32-bit word</td></tr><tr><td>STORE [addr], reg</td><td>Write signed 32-bit word</td></tr>
        <tr><td>ADD / SUB / MUL / DIV / MOD</td><td>Integer arithmetic into destination</td></tr><tr><td>AND / OR / XOR</td><td>Bitwise operation</td></tr><tr><td>SHL / SHR</td><td>Signed 32-bit shift; count masked to 0…31</td></tr>
        <tr><td>CMP reg, src</td><td>Set internal comparison result</td></tr><tr><td>JMP / JE / JNE</td><td>Unconditional / equal / unequal branch</td></tr><tr><td>JL / JLE / JG / JGE</td><td>Signed relational branch</td></tr>
        <tr><td>PUSH / POP</td><td>32-bit stack transfer</td></tr><tr><td>CALL / RET</td><td>Push return address / resume caller</td></tr><tr><td>PRINT src</td><td>Write register, immediate, or quoted string</td></tr><tr><td>HALT</td><td>Successful terminal state</td></tr>
      </tbody></table></section>
      <section class="manual-section"><h3>10.3 Counted sum</h3><pre><code>; EAX = 5 + 4 + 3 + 2 + 1
mov eax, 0
mov ecx, 5
loop:
  add eax, ecx
  sub ecx, 1
  cmp ecx, 0
  jg loop
print eax
print "\\n"
halt</code></pre></section>
      <aside class="manual-callout"><b>Optimization exercise</b><p>Replace the loop with <code>mov eax, 15</code>, then compare <code>run --stats</code>. Equal output with fewer cycles is a measurable optimization.</p></aside>`,
  },
  {
    id: "micropython",
    number: "06",
    title: "MicroPython on CS processors",
    summary: "Boot, imports, and native modules",
    html: `
      <header class="manual-page-header"><p class="manual-kicker">Chapter 06 · Desktop language runtime</p><h2>Computer System MicroPython</h2><p class="manual-lead">On the desktop CS486DX and CS486DX2 profiles, the MicroPython-compatible language compiles to the same resumable guest process as C, C++, ASM, and BASIC; there is no separate Python VM. Source in <code>/startup.py</code> starts when the Computer powers on. The portable CS386SX DOS profile does not expose user MicroPython.</p></header>
      <section class="manual-section manual-grid-2"><div><h3>6.1 Edit and boot</h3><pre><code>vi /startup.py
        reboot</code></pre><p>Normal completion powers the program down. Infinite work remains preemptible by the common scheduler.</p></div><div><h3>6.2 Core language</h3><p>Variables, numbers, strings, booleans, lists, tuples, dictionaries, functions, imports, conditionals, loops, exceptions, formatting, and bounded built-ins compile to shared call/jump control flow and allowlisted managed-runtime syscalls.</p></div></section>
      <section class="manual-section"><h3>6.3 Native modules</h3><table><thead><tr><th>Module</th><th>Purpose</th><th>Representative calls</th></tr></thead><tbody>
        <tr><td>os</td><td>Identity, time, events, timers, lifecycle</td><td>get_computer_id, clock, sleep, pull_event, queue_event, shutdown, reboot</td></tr>
        <tr><td>term</td><td>Fixed-cell terminal</td><td>write, clear, set_cursor_pos, set_text_color</td></tr>
        <tr><td>fs</td><td>Sandbox filesystem</td><td>read_file, write_file, exists, make_dir, get_size, get_free_space</td></tr>
        <tr><td>redstone</td><td>Six-sided digital / analog I/O</td><td>get_input, get_analog_input, set_output</td></tr>
        <tr><td>shell</td><td>Terminal shell adapter</td><td>banner, prompt, submit, keys</td></tr>
      </tbody></table></section>
      <section class="manual-section"><h3>6.4 Python modules</h3><pre><code># /home/computer/main.py
import helper
print(helper.answer())</code></pre><p>Module lookup checks the importing file's directory, then <code>/lib/python</code> and <code>/usr/lib/computer-system/python</code>. A <code>.py</code> module initializes once. Missing, circular, oversized, and failed imports stop with <code>ImportError</code>.</p></section>
      <section class="manual-section"><h3>6.5 Import a C or C++ object</h3><pre><code>cc -c fastmath.c -o fastmath.o
python main.py

# main.py
import fastmath
print(fastmath.answer())</code></pre><p>A sibling <code>CS486OBJ</code> file or one in a Python library directory becomes a module. Its global functions use the current zero-argument integer ABI and return through EAX. The function executes inside the calling Python CS486 process, so its instructions, cycles, faults, and RAM accesses use the same limits. This is sandboxed static extension loading, not a host DLL or shared object.</p></section>
      <section class="manual-section"><h3>6.6 Event-driven output</h3><pre><code>import os
import redstone

while True:
    event = os.pull_event("redstone")
    redstone.set_output(
        "right",
        redstone.get_input("left")
    )</code></pre></section>
      <aside class="manual-warning"><b>RAM is aggregate</b><p>Live globals, frames, collections, strings, iterators, and native return values count toward RAM. Overflow raises <code>MemoryError</code>; unreachable data is reclaimed under pressure.</p></aside>`,
  },
  {
    id: "shell",
    number: "04",
    title: "Bash and utilities",
    summary: "Pipelines, scripts, startup files",
    html: `
      <header class="manual-page-header"><p class="manual-kicker">Chapter 04 · Command environment</p><h2>Computer System Bash</h2><p class="manual-lead">A bounded compatibility shell implemented inside the application layer. It is not host Bash and cannot escape to a native process.</p></header>
      <section class="manual-section"><h3>4.1 Grammar</h3><table><thead><tr><th>Feature</th><th>Syntax</th></tr></thead><tbody><tr><td>Pipeline</td><td><code>a | b</code></td></tr><tr><td>Redirection</td><td><code>&lt;</code>, <code>&gt;</code>, <code>&gt;&gt;</code></td></tr><tr><td>Control</td><td><code>&amp;&amp;</code>, <code>||</code>, <code>;</code></td></tr><tr><td>Expansion</td><td><code>$VAR</code>, <code>$?</code>, positional parameters</td></tr><tr><td>Scripts</td><td>if/else, for, while, functions, break, continue, return, source</td></tr></tbody></table></section>
      <section class="manual-section"><h3>4.2 Command families</h3><div class="manual-command-bank"><p><b>Files</b> pwd cd ls cat mkdir touch rm cp mv find stat df du quota</p><p><b>Text</b> echo printf head tail wc grep sort uniq tr cut seq</p><p><b>Shell</b> sh bash source env export unset which type history time</p><p><b>System</b> whoami id hostname uname date uptime sleep test vi shutdown reboot</p></div></section>
      <section class="manual-section manual-grid-2"><div><h3>4.3 Startup</h3><pre><code>/etc/bash.bashrc
        ~/.bashrc</code></pre><p>Files are created non-destructively and loaded in that order.</p></div><div><h3>4.4 Example</h3><pre><code>for name in alpha beta alpha; do
  echo "$name"
done | sort | uniq</code></pre></div></section>
      <section class="manual-section"><h3>4.5 Boot and first login</h3><ol class="manual-procedure"><li><b>Reset the display.</b> Each OS boot clears the terminal cells, colors, and cursor before printing one boot banner. This does not format the guest disk.</li><li><b>Restore the system.</b> Files under <code>/etc</code>, <code>/home</code>, and <code>/usr</code>, including <code>/etc/shadow</code>, remain persisted; volatile <code>/tmp</code> is rebuilt.</li><li><b>Initialize credentials.</b> On a new CS-Linux installation, the boot banner, first-boot notice, and <code>New password:</code> prompt each appear once. Enter 8–64 UTF-8 characters, then confirm at <code>Retype new password:</code>.</li><li><b>Authenticate later boots.</b> Existing installations stop at <code>Password:</code>. Three failures add a two-second guest delay.</li></ol><p>The password is not reversibly encrypted. CS-Linux stores a salted, 512-round one-way SHA-256 record in <code>/etc/shadow</code> as <code>computer:cs-sha256-v1:512:&lt;salt&gt;:&lt;digest&gt;</code>; plaintext is never stored. Secret Web input is masked and excluded from history and Tab completion.</p></section>
      <aside class="manual-callout"><b>Calendar safety</b><p>CS-Linux and CS-DOS preserve four-digit UTC years. <code>date</code>/<code>DATE</code> do not apply a two-digit-year pivot, correctly represent 2000-02-29, and use timestamps beyond the signed 32-bit 2038 boundary.</p></aside>
      <aside class="manual-callout"><b>Cost ownership</b><p>Commands, script lines, loop iterations, and output create bounded cycle debt. The shell cannot become a free execution path around the CPU model. Interactive command dispatch and <code>.sh</code> scripts currently use the bounded shell interpreter; unlike Python, scripts have not yet moved to CS486 instructions.</p></aside>`,
  },
  {
    id: "basic",
    number: "11",
    title: "BASIC",
    summary: "Line-oriented compiled programs",
    html: `
      <header class="manual-page-header"><p class="manual-kicker">Chapter 11 · BASIC compiler</p><h2>Structured and numbered BASIC</h2><p class="manual-lead">BASIC source compiles to the same validated CS486 executable as assembly, C, and C++. Line numbers are optional except as GOTO targets.</p></header>
      <section class="manual-section"><h3>11.1 Build modes</h3><pre><code>basic program.bas              # compile and run
basicc program.bas -o program # save executable
run --stats program</code></pre></section>
      <section class="manual-section"><h3>11.2 Statement reference</h3><table><thead><tr><th>Statement</th><th>Form</th></tr></thead><tbody><tr><td>Assignment</td><td><code>LET X = expression</code> or <code>X = expression</code></td></tr><tr><td>Output</td><td><code>PRINT expression</code> or quoted text</td></tr><tr><td>Loop</td><td><code>FOR I = start TO end STEP n</code> … <code>NEXT I</code></td></tr><tr><td>Branch</td><td><code>GOTO 100</code>, <code>IF expression THEN GOTO 100</code></td></tr><tr><td>Stop</td><td><code>END</code> or <code>STOP</code></td></tr></tbody></table></section>
      <section class="manual-section"><h3>11.3 Complete example</h3><pre><code>10 LET TOTAL = 0
20 FOR I = 1 TO 100
30 LET TOTAL = TOTAL + I
40 NEXT I
50 PRINT TOTAL
60 END</code></pre></section>
      <aside class="manual-warning"><b>Initial subset</b><p>INPUT, arrays, floating point, files, user-defined functions, and graphics are not yet accepted by the compiler. Unsupported statements produce a line-specific CompileError.</p></aside>`,
  },
  {
    id: "c-family",
    number: "12",
    title: "C and C++",
    summary: "Safe compiled subsets",
    html: `
      <header class="manual-page-header"><p class="manual-kicker">Chapter 12 · C-family compilers</p><h2>Typed source for the CS486 target</h2><p class="manual-lead">The compilers accept deliberately small, auditable subsets. They do not invoke GCC or Clang and do not claim ISO language or x86 binary compatibility.</p></header>
      <section class="manual-section manual-grid-2"><div><h3>12.1 C</h3><pre><code>cc program.c -o program</code></pre><p><code>int</code>/<code>long</code> locals, integer expressions, assignment, canonical for loops, <code>printf("%d\\n", value)</code>, and return.</p></div><div><h3>12.2 C++</h3><pre><code>c++ program.cpp -o program</code></pre><p>The C subset plus <code>std::cout &lt;&lt; value &lt;&lt; std::endl</code>. Classes, templates, exceptions, RTTI, and the standard library are not implemented.</p></div></section>
      <section class="manual-section"><h3>12.3 Summation in C</h3><pre><code>int main() {
  int total = 0;
  for (int i = 1; i &lt;= 100; i++) {
    total = total + i;
  }
  printf("%d\\n", total);
  return 0;
}</code></pre></section>
      <section class="manual-section"><h3>12.4 What the compiler emits</h3><p>Expressions use EAX as the result register, EBX as a secondary operand, and PUSH/POP for intermediate values. Variables occupy checked 32-bit words from low memory. Inspect exact output with <code>objdump</code>.</p></section>
      <section class="manual-section"><h3>12.5 Objects, static linking, and Python imports</h3><pre><code>cc -c main.c -o main.o
as -c fast.asm -o fast.o
nm main.o
ld main.o fast.o -o program
run --stats program</code></pre><p>The versioned <code>CS486OBJ</code> format carries symbols, relocations, and object-relative data size. <code>extern int fast();</code> imports a zero-argument function; a C/C++ definition or <code>global fast</code> ASM label exports it. The callee returns its integer in EAX. Duplicate and unresolved symbols stop the link. Placing a valid object beside a Python script or in a Python library directory also permits <code>import fast</code>; every imported machine instruction is charged to the caller.</p></section>
      <section class="manual-section"><h3>12.6 Restricted inline assembly</h3><pre><code>int answer = 0;
asm("mov eax, 6");
asm("mul eax, 7");
asm("store [answer], eax");</code></pre><p>Inline assembly executes at a statement boundary. It may use ordinary arithmetic and checked memory operations. Labels, branches, CALL/RET, PUSH/POP, HALT, and ESP/EBP access are rejected. Dynamic libraries are not yet supported.</p></section>
      <aside class="manual-callout"><b>Manual optimization</b><p>Reduce repeated DIV/MOD, simplify constant expressions, remove redundant variables, and compare the generated instruction stream. A shorter source file is not necessarily a cheaper executable.</p></aside>`,
  },
  {
    id: "io-files",
    number: "05",
    title: "Filesystem and storage",
    summary: "Paths, devices, quota, persistence",
    html: `
      <header class="manual-page-header"><p class="manual-kicker">Chapter 05 · Filesystem interface</p><h2>Filesystem and storage</h2><p class="manual-lead">Minecraft behavior is exposed through bounded adapters. The domain/runtime core does not import Minecraft APIs.</p></header>
      <section class="manual-section"><h3>5.1 Linux layout</h3><table><thead><tr><th>Path</th><th>Role</th></tr></thead><tbody><tr><td>/etc</td><td>Root-owned system configuration and Bash startup</td></tr><tr><td>/dev</td><td>Virtual devices</td></tr><tr><td>/proc</td><td>Dynamic CPU, memory, version, uptime, load, and mount information</td></tr><tr><td>/tmp</td><td>Volatile mode-1777 working files</td></tr><tr><td>/usr</td><td>Userland hierarchy</td></tr><tr><td>/home/computer</td><td>UID/GID 1000 default user home</td></tr></tbody></table><p>CS-Linux persists mode, UID, GID, modification time, symbolic links, and hard-link groups. Older snapshots without metadata remain readable and receive safe defaults on boot.</p></section>
      <section class="manual-section manual-grid-2"><div><h3>5.2 Terminal state</h3><p>The fixed-cell model is the source of truth. Web and Resource Pack UIs render snapshots. A newly opened Web Terminal receives control immediately and demotes the previous writer; a viewer may reclaim control explicitly.</p></div><div><h3>5.3 World state</h3><p>Inputs and outputs are side-addressed. Digital and analog observations enter through bounded events; output state persists with the Computer record.</p></div></section>
      <section class="manual-section"><h3>5.4 Storage model</h3><p>Bedrock World Dynamic Properties stored in world LevelDB are canonical. Snapshots use checksum-backed transactional pages and preserve the current and previous complete generations. SQLite is not used by the Bedrock runtime.</p><pre><code>df -h
du -sh /home/computer
quota
stat /startup.py</code></pre></section>
      <section class="manual-section"><h3>5.5 CS-Linux command surface</h3><table><thead><tr><th>Area</th><th>Commands</th></tr></thead><tbody><tr><td>Identity</td><td>whoami, id, groups, hostname, uname</td></tr><tr><td>Files and metadata</td><td>ls, stat, chmod, chown, chgrp, ln, readlink, realpath, rmdir</td></tr><tr><td>Text and inspection</td><td>tee, cmp, diff, file, sha256sum, od, hexdump, xargs</td></tr><tr><td>System</td><td>date, uptime, free, df, du, mount, dmesg, sync, mktemp</td></tr><tr><td>Bash builtins</td><td>alias, unalias, command, read, local, shift, getopts</td></tr></tbody></table><p>Linux-facing commands use LF, Linux-style labels, and observable nonzero status for errors. <code>date --game</code> and <code>date --virtual</code> remain documented CS-Linux extensions. <code>yes</code>, <code>xargs</code>, dumps, hashes, and diffs stop at explicit sandbox limits.</p></section>
      <section class="manual-section"><h3>5.6 Dynamic proc files</h3><pre><code>cat /proc/cpuinfo
cat /proc/meminfo
cat /proc/version
cat /proc/uptime
cat /proc/loadavg
cat /proc/mounts</code></pre><p>These entries are read-only views generated from the Computer identity, hardware, clock, and mount model. They are not host Linux files. Directory and hard-link indexes keep ordinary listings O(N); no command scans the host filesystem.</p></section>
      <aside class="manual-warning"><b>Independent ceilings</b><p>RAM, disk quota, per-file size, entry count, pipeline buffer, output size, and CPU cycles are separate limits. Free disk does not imply free VM RAM.</p></aside>`,
  },
  {
    id: "terminal-editor",
    number: "03",
    title: "Terminal and editors",
    summary: "Keyboard, viewport, editing workflow",
    html: `
      <header class="manual-page-header"><p class="manual-kicker">Chapter 03 · Operator console</p><h2>Terminal control and source editing</h2><p class="manual-lead">The terminal is a fixed-cell machine display. The Web Terminal enlarges the visible grid with the browser viewport while preserving the same cells, cursor, colors, and input semantics.</p></header>
      <section class="manual-section"><h3>3.1 Keyboard map</h3><table><thead><tr><th>Key</th><th>Shell action</th><th>vi action</th></tr></thead><tbody><tr><td>Enter</td><td>Submit command</td><td>Insert newline</td></tr><tr><td>Tab</td><td>Complete command or path</td><td>Insert indentation</td></tr><tr><td>↑ / ↓</td><td>Command history</td><td>Move cursor</td></tr><tr><td>Ctrl+C</td><td>Bounded interrupt</td><td>Interrupt current input</td></tr><tr><td>Ctrl+V</td><td>Paste clipboard text</td><td>Paste in insert mode</td></tr></tbody></table></section>
      <section class="manual-section manual-grid-2"><div><h3>3.2 Normal mode</h3><div class="manual-command-bank"><p><b>Move</b> h j k l, arrows, gg/G, PageUp/PageDown</p><p><b>Edit</b> i/I, a/A, o/O, x, dd</p><p><b>History</b> u</p><p><b>Save + quit</b> Shift+ZZ</p><p><b>Discard + quit</b> Shift+ZQ</p><p><b>Leave insert</b> Esc or Ctrl+[</p></div></div><div><h3>3.3 Command mode</h3><div class="manual-command-bank"><p><b>Save</b> :w</p><p><b>Name and save</b> :w path</p><p><b>Quit</b> :q</p><p><b>Save + quit</b> :wq, :wq!, or :x</p><p><b>Discard</b> :q!</p><p><b>Cancel empty :</b> Backspace</p></div><p>Bare <code>vi</code> opens <code>[No Name]</code>. It must be named with <code>:w path</code> before an unnamed save can succeed.</p></div></section>
      <section class="manual-section"><h3>3.4 DOS-style EDIT</h3><p>On the DOS profile, <code>EDIT [path]</code> opens a blue full-screen editor. Bare <code>EDIT</code> starts an <code>UNTITLED</code> buffer and F2 saves it as <code>C:\\NONAME.TXT</code>. Linux does not expose EDIT and uses <code>vi</code>. The top bar exposes File, Edit, Search, Options, and Help; the lower rows show the DOS path, modified state, line, column, and INS/OVR mode.</p><table><thead><tr><th>Key</th><th>Action</th></tr></thead><tbody><tr><td>F2 / Ctrl+S</td><td>Save and report success or failure</td></tr><tr><td>F10 / Alt+F</td><td>Open keyboard menus; arrows and Enter select</td></tr><tr><td>Ctrl+F / F3</td><td>Find text / find next with bounded forward search</td></tr><tr><td>Ctrl+Home / Ctrl+End</td><td>Move to the start or end of the document</td></tr><tr><td>Ctrl+Left / Ctrl+Right</td><td>Move by word</td></tr><tr><td>Ctrl+Y / Ctrl+Z</td><td>Delete the current line / undo</td></tr><tr><td>Insert</td><td>Toggle insert and overwrite modes</td></tr><tr><td>Alt+F, X</td><td>Exit; a dirty buffer requires Save, Discard, or Cancel</td></tr></tbody></table></section>
      <section class="manual-section"><h3>3.5 Editing procedure</h3><ol class="manual-procedure"><li>On DOS, use <code>EDIT C:\\WORK\\PROGRAM.C</code> for direct full-screen editing. On Linux, use <code>vi program.py</code>.</li><li>In EDIT, type directly and navigate with arrows, Home/End, or PageUp/PageDown. Save with F2.</li><li>In vi, press <code>i</code>, enter source, press Escape, type <code>:w</code>, and press Enter.</li><li>Run or compile from the shell. Reopen the file to correct reported lines.</li></ol></section>
      <aside class="manual-callout"><b>Selection and clipboard</b><p>Drag across rendered terminal text to select it. Copy with Ctrl+C or the Copy button beside Manual; with no selection the button copies the visible terminal screen. Paste into the active writer session with Ctrl+V. A viewer can select and copy, but cannot submit input until it takes control.</p></aside>`,
  },
  {
    id: "redstone-peripherals",
    number: "08",
    title: "Redstone and peripherals",
    summary: "Sides, signals, events, adapters",
    html: `
      <header class="manual-page-header"><p class="manual-kicker">Chapter 08 · World interface</p><h2>Connecting programs to Minecraft</h2><p class="manual-lead">World I/O crosses a narrow adapter boundary. A program observes snapshots and bounded events; it never calls Bedrock APIs directly.</p></header>
      <div class="manual-spec-line"><span>Sides</span><b>6</b><span>Digital</span><b>false / true</b><span>Analog input</span><b>0…15</b></div>
      <section class="manual-section"><h3>8.1 Display connections</h3><table><thead><tr><th>Machine</th><th>Web Terminal rule</th></tr></thead><tbody><tr><td>Desktop / Advanced Desktop</td><td>Requires exactly one adjacent Monitor. Selecting a bare Computer does not open a terminal.</td></tr><tr><td>Monitor</td><td>Resolves the physically adjacent Desktop Computer System. No connection and ambiguous multiple connections fail explicitly.</td></tr><tr><td>Portable Computer System</td><td>Its display is built in. Use it while held, or place and touch the open-laptop block; no external Monitor is required.</td></tr></tbody></table><p>Each Computer has a permanent four-digit connection number. Touching an eligible machine activates it once for two minutes; enter it at the stable LAN Web Terminal page. After connection, the browser stores the number locally and changes the bookmarkable URL to <code>/?computer=NNNN</code>; bearer tokens are never placed in that query. Invalid guesses are rate-limited and simultaneous number collisions fail explicitly. Placed-machine control requires the player to remain within three blocks. Leaving the radius or dimension pauses input as <code>out_of_range</code> without destroying the bounded session; returning resumes the existing tab, while a reloaded bookmark rotates the bearer token and reconnects automatically. Portable placement transfers the same persistent Computer identity from item to block. Breaking it returns an identity-carrying Portable Computer System item.</p></section>
      <section class="manual-section"><h3>8.2 Side names</h3><table><thead><tr><th>Name</th><th>Meaning</th><th>Use</th></tr></thead><tbody><tr><td>top / bottom</td><td>Vertical faces</td><td>Stacks and floor wiring</td></tr><tr><td>front / back</td><td>Relative to block orientation</td><td>Operator-facing machines</td></tr><tr><td>left / right</td><td>Relative lateral faces</td><td>Relay and control pairs</td></tr></tbody></table></section>
      <section class="manual-section"><h3>8.3 Polling and events</h3><pre><code>import os
import redstone

while True:
    os.pull_event("redstone")
    level = redstone.get_analog_input("left")
    redstone.set_output("right", level &gt;= 8)</code></pre><p>Use <code>pull_event</code> instead of a tight polling loop. It yields the VM until relevant work exists and avoids consuming the machine's cycle budget while idle.</p></section>
      <section class="manual-section"><h3>8.4 Output checklist</h3><ol class="manual-procedure"><li>Confirm orientation before assigning side names.</li><li>Read the existing input and decide a safe default output.</li><li>Handle startup before waiting for the first change event.</li><li>On failure, leave an explicit terminal state; do not spin-retry.</li></ol></section>
      <aside class="manual-warning"><b>Capability-dependent interfaces</b><p>Computer, Portable Computer System, Monitor, Speaker, and other block behavior is exposed only when the relevant adapter exists. Missing capability calls fail explicitly rather than impersonating unavailable hardware.</p></aside>`,
  },
  {
    id: "dos-profile",
    number: "14",
    title: "CS-DOS profile",
    summary: "CS-DOS 6.2 boot, memory, batch, and toolchains",
    html: `
      <header class="manual-page-header"><p class="manual-kicker">Chapter 14 · Computer System DOS 6.2</p><h2>Operating CS-DOS 6.2 on the CS386SX portable</h2><p class="manual-lead">Computer System DOS 6.2 (CS-DOS 6.2) is the portable profile for a CS386SX 16 MHz machine with 2 MiB RAM. It supports ASM, C, C++, BASIC, and bounded batch files. User MicroPython is unavailable. Storage, identity, execution limits, and the host security boundary remain shared with the CS-Linux desktop.</p></header>
      <figure class="manual-figure manual-figure--portable"><img src="/assets/manual/portable-computer-system.png" alt="Portable 386SX 16 MHz Computer System with 2 MB RAM showing a DOS prompt, monochrome LCD, keyboard, trackball, floppy drive, rear ports, and battery pack" loading="lazy" decoding="async"><figcaption><b>Portable Computer System.</b> The CS386SX profile runs at 16 MHz with 2 MiB RAM, a 24-bit address bus, a 16-bit data bus, and 800,000 cycles/tick. Its narrower bus and 80386-derived timing are active execution constraints rather than display-only labels.</figcaption></figure>
      <section class="manual-section"><h3>14.1 Boot sequence</h3><ol class="manual-procedure"><li><b>Mount C:.</b> Restore the persisted, quota-limited guest filesystem and reset <code>C:\\TEMP</code>.</li><li><b>Read CONFIG.SYS.</b> Process at most 64 lines; every unsupported or invalid directive is reported.</li><li><b>Run AUTOEXEC.BAT.</b> Execute it through the same bounded batch engine used for operator scripts.</li><li><b>Present the prompt.</b> <code>PROMPT</code>, current drive, environment, and <code>PATH</code> are now active.</li></ol><pre><code>DEVICE=C:\\DOS\\HIMEM.SYS
DEVICE=C:\\DOS\\EMM386.EXE NOEMS
DOS=HIGH,UMB
FILES=32
BUFFERS=16</code></pre><p>The supported CONFIG.SYS surface is deliberately narrow: <code>FILES=1…255</code>, <code>BUFFERS=1…99</code>, <code>DEVICE</code>/<code>DEVICEHIGH</code> for the built-in HIMEM and EMM386 models, and <code>DOS=HIGH|LOW,UMB|NOUMB</code>. These settings configure guest accounting; they do not load host drivers.</p></section>
      <section class="manual-section"><h3>14.2 The 2 MiB memory map</h3><table><thead><tr><th>Region</th><th>Address range</th><th>Nominal size</th><th>Use</th></tr></thead><tbody><tr><td>Conventional</td><td>0–639 KiB</td><td>640 KiB</td><td>DOS-compatible resident state and guest program working set</td></tr><tr><td>Upper memory blocks</td><td>640–767 KiB</td><td>128 KiB</td><td>Available when EMM386 and <code>DOS=UMB</code> are active</td></tr><tr><td>Reserved upper area</td><td>768–1023 KiB</td><td>256 KiB</td><td>Compatibility reservation; not allocatable</td></tr><tr><td>Extended / XMS</td><td>1–2 MiB</td><td>1024 KiB</td><td>Exposed by HIMEM; the first 64 KiB models HMA use for <code>DOS=HIGH</code></td></tr></tbody></table><pre><code>MEM
MEM /C
MEM /D
MEM /F
REM MEM /P is explicitly unsupported</code></pre><p><code>MEM</code> derives all totals in O(1) from the installed hardware, current runtime use, and boot flags. No scan grows with filesystem or program size.</p></section>
      <section class="manual-section"><h3>14.3 Processor and protected mode</h3><p><code>CPU</code> reports the 24-bit address bus, 16-bit data bus, 16 MHz clock, and modeled real/protected/virtual-8086 capability. Guest execution currently runs inside the <b>protected sandbox</b>. EMM386 supplies the DOS-visible UMB/v86 compatibility model. Paging, native descriptor tables, ring transitions, BIOS interrupts, DOS interrupts, TSR residency, and arbitrary x86 opcodes are not emulated.</p><aside class="manual-warning"><b>Compatibility is not native emulation</b><p>The assembler and compilers emit the checked Computer System executable format. A downloaded DOS <code>.COM</code> or <code>.EXE</code> cannot run, and no guest can escape through an interrupt or host driver.</p></aside></section>
      <section class="manual-section"><h3>14.4 AUTOEXEC and environment</h3><pre><code>@ECHO OFF
SET MODE=PORTABLE
PATH C:\\TOOLS;C:\\DOS;C:\\COMMAND
PROMPT [$N]$P$G
REM READY</code></pre><table><thead><tr><th>Command</th><th>Contract</th></tr></thead><tbody><tr><td>SET [NAME[=VALUE]]</td><td>List, query, assign, or remove a case-insensitive environment variable</td></tr><tr><td>PATH [directories]</td><td>Show or replace up to the first 16 semicolon-separated search entries</td></tr><tr><td>PROMPT [template]</td><td>Set at most 64 characters; <code>$P $N $G $L $B $Q $V $_ $$</code> are recognized</td></tr><tr><td>ECHO ON / OFF</td><td>Control batch command echo; a leading <code>@</code> suppresses one line</td></tr><tr><td>REM text</td><td>Comment with no output or side effect</td></tr></tbody></table></section>
      <section class="manual-section"><h3>14.5 Batch programs</h3><pre><code>@ECHO OFF
REM C:\\TOOLS\\BUILD.BAT
ECHO SCRIPT=%0
ECHO SOURCE=%1
CC %1 -O %2
ECHO STATUS=%ERRORLEVEL%</code></pre><p>A command without a path is resolved in the current directory and then <code>PATH</code>; the <code>.BAT</code> suffix may be omitted. CRLF and LF are accepted. Batch substitution supports <code>%VAR%</code>, <code>%0</code> through <code>%9</code>, and <code>%ERRORLEVEL%</code>. The shared safe shell also accepts pipes, redirects, <code>&amp;&amp;</code>, and <code>||</code> as documented extensions—not as full COMMAND.COM emulation.</p><table><thead><tr><th>Bound</th><th>Limit</th><th>Failure</th></tr></thead><tbody><tr><td>Batch lines</td><td>256</td><td>Explicit line-limit status</td></tr><tr><td>Nested batch/script depth</td><td>8</td><td>Explicit depth status</td></tr><tr><td>Positional arguments</td><td>9</td><td>Additional arguments are not exposed as <code>%n</code></td></tr><tr><td>Pipeline/output buffer</td><td>256,000 characters</td><td>Explicit bounded-output status</td></tr></tbody></table><p>Labels, <code>GOTO</code>, <code>CALL</code>, <code>CHOICE</code>, and native COMMAND.COM binary behavior are not currently implemented.</p></section>
      <section class="manual-section"><h3>14.6 Command correspondence</h3><table><thead><tr><th>Task</th><th>Linux</th><th>DOS</th></tr></thead><tbody><tr><td>List / read</td><td>ls / cat</td><td>DIR / TYPE</td></tr><tr><td>Directory tree / volume</td><td>find / df</td><td>TREE / VOL</td></tr><tr><td>Edit full screen</td><td>vi</td><td>EDIT / VI</td></tr><tr><td>Create / remove directory</td><td>mkdir / rm</td><td>MD / RD (CHDIR and RMDIR aliases)</td></tr><tr><td>Copy / move / rename</td><td>cp / mv</td><td>COPY / MOVE / REN or RENAME</td></tr><tr><td>Remove file</td><td>rm</td><td>DEL or ERASE</td></tr><tr><td>Clock / measurement</td><td>date / time</td><td>TIME / TIMER</td></tr><tr><td>History</td><td>history</td><td>DOSKEY /HISTORY</td></tr><tr><td>Clear / version</td><td>clear / uname</td><td>CLS / VER</td></tr><tr><td>Hardware</td><td>cpuinfo / free</td><td>CPU / MEM, MEM /F</td></tr><tr><td>System summary</td><td>uname -a</td><td>SYSTEMINFO</td></tr></tbody></table><p>DOS-facing commands and errors use CRLF and DOS-specific wording. Commands and paths are case-insensitive. Backslash is preserved as the displayed separator. <code>DIR /B</code> produces a bare listing; <code>TREE [/F] [/A]</code> is an O(N) traversal capped at 512 entries and 32 levels. <code>C:\\TEMP</code> is volatile across boot. <code>NUL</code> and <code>CON</code> are bounded compatibility sink devices; CON is not a raw host console.</p></section>
      <section class="manual-section"><h3>14.7 Portable toolchains</h3><pre><code>AS ANSWER.ASM -O ANSWER
CC TOTAL.C -O TOTAL
C++ ANSWER.CPP -O ANSWERCPP
BASIC DEMO.BAS
BASICC DEMO.BAS -O DEMO
RUN --STATS ANSWERCPP</code></pre><p>ASM, the supported C subset, the supported C++ subset (including restricted inline assembly), and BASIC all produce or execute the common checked instruction format. Each run uses CS386SX timings and the 2 MiB limit. MicroPython commands and <code>/startup.py</code> are unavailable on Portable; MCP returns status 127 instead of silently using a different VM.</p></section>
      <section class="manual-section"><h3>14.8 C++ exercise</h3><pre><code>REM ANSWER.CPP
int main() {
  int answer = 6 * 7;
  std::cout &lt;&lt; answer &lt;&lt; std::endl;
  return 0;
}

C++ ANSWER.CPP -O ANSWER
RUN --STATS ANSWER</code></pre><p>Record output, instructions, and cycles. On the 16-bit external bus, memory traffic and output can dominate. Reduce the algorithmic term first, then repeated loads, taken branches, division, and PRINT traffic.</p></section>
      <section class="manual-section"><h3>14.9 Linux memory comparison</h3><table><thead><tr><th>Portable DOS</th><th>Desktop Linux</th></tr></thead><tbody><tr><td>640 KiB conventional + UMB/reserved + XMS</td><td>32-bit protected flat sandbox</td></tr><tr><td>Inspect with CPU, MEM, MEM /C, MEM /D</td><td>Inspect with cpuinfo, free, /proc/cpuinfo, /proc/meminfo</td></tr><tr><td>DOS system/drivers and guest runtime are separate</td><td>Kernel, services, buffers, and guest runtime are separate</td></tr><tr><td>HIMEM/EMM386 and DOS HIGH are modeled</td><td>Resident OS overhead plus dynamic used/free/available are reported</td></tr><tr><td>No paging or native interrupt execution</td><td>No paging, swap, process table, or MMU page emulation</td></tr></tbody></table></section>
      <section class="manual-section"><h3>14.10 Recovery checklist</h3><ol class="manual-procedure"><li>Run <code>VER</code>, <code>CPU</code>, and <code>MEM /D</code>.</li><li>Inspect <code>TYPE C:\\CONFIG.SYS</code> and <code>TYPE C:\\AUTOEXEC.BAT</code>.</li><li>Use <code>SET</code>, <code>PATH</code>, and <code>PROMPT</code> to confirm boot state.</li><li>Use an explicit path if a BAT or compiled program is not found.</li><li>Correct every boot warning; unsupported directives are never silently accepted.</li></ol></section>
      <aside class="manual-callout"><b>Portable profile</b><p>A newly created Portable Computer System selects CS-DOS plus CS386SX automatically. Customized OS, CPU, clock, or RAM settings remain attached to its Computer identity.</p></aside>`,
  },
  {
    id: "worked-project",
    number: "09",
    title: "Worked project",
    summary: "Build, inspect, benchmark, deploy",
    html: `
      <header class="manual-page-header"><p class="manual-kicker">Chapter 09 · Laboratory exercise</p><h2>Build a signal threshold controller</h2><p class="manual-lead">This exercise joins filesystem work, source editing, redstone events, diagnostic output, and bounded execution into one repeatable operator workflow.</p></header>
      <section class="manual-section"><h3>9.1 Define the contract</h3><table><thead><tr><th>Input</th><th>Rule</th><th>Output</th></tr></thead><tbody><tr><td>Analog left, 0…15</td><td>level ≥ 8</td><td>Digital right, on</td></tr><tr><td>Analog left, 0…7</td><td>level &lt; 8</td><td>Digital right, off</td></tr></tbody></table></section>
      <section class="manual-section"><h3>9.2 Implement <code>/startup.py</code></h3><pre><code>import os
import redstone

def update():
    level = redstone.get_analog_input("left")
    redstone.set_output("right", level &gt;= 8)
    print("level", level)

update()
while True:
    os.pull_event("redstone")
    update()</code></pre></section>
      <section class="manual-section"><h3>9.3 Commissioning procedure</h3><ol class="manual-procedure"><li>Save with <code>:wq</code>, then run <code>reboot</code>.</li><li>Apply levels 0, 7, 8, and 15 to the left face.</li><li>Verify the right output changes only at the threshold.</li><li>Disconnect and reconnect the terminal; verify the program and machine identity persist.</li><li>Inspect <code>free -h</code> and <code>quota</code> after the test.</li></ol></section>
      <aside class="manual-warning"><b>Acceptance rule</b><p>A controller is not complete because it compiled. It is complete when boundary values, startup state, event waiting, persisted source, and reconnect behavior have observable results.</p></aside>`,
  },
  {
    id: "api-reference",
    number: "07",
    title: "MicroPython API reference",
    summary: "Native functions and return values",
    html: `
      <header class="manual-page-header"><p class="manual-kicker">Chapter 07 · Native API</p><h2>Runtime function reference</h2><p class="manual-lead">Snake-case names are canonical below. Selected camelCase aliases exist for ComputerCraft familiarity; portable programs should prefer one naming convention consistently.</p></header>
      <section class="manual-section"><h3>7.1 os</h3><table><thead><tr><th>Function</th><th>Result / effect</th></tr></thead><tbody><tr><td>get_computer_id()</td><td>Stable numeric Computer identity</td></tr><tr><td>clock()</td><td>Elapsed tick time in seconds</td></tr><tr><td>sleep(seconds)</td><td>Yield for a bounded tick duration</td></tr><tr><td>pull_event([filter])</td><td>Yield until the next matching event</td></tr><tr><td>queue_event(name, ...args)</td><td>Append a bounded local event</td></tr><tr><td>start_timer(seconds)</td><td>Return timer id</td></tr><tr><td>cancel_timer(id)</td><td>Return whether cancellation succeeded</td></tr><tr><td>shutdown() / reboot()</td><td>Request explicit lifecycle transition</td></tr></tbody></table></section>
      <section class="manual-section"><h3>7.2 term</h3><div class="manual-command-bank"><p><b>Writing</b> write(text), clear(), clear_line(), scroll(lines)</p><p><b>Cursor</b> set_cursor_pos(x, y), get_cursor_pos(), set_cursor_blink(bool)</p><p><b>Geometry</b> get_size()</p><p><b>Color</b> set_text_color(mask), get_text_color(), set_background_color(mask), get_background_color(), is_color()</p></div></section>
      <section class="manual-section"><h3>7.3 fs and redstone</h3><table><thead><tr><th>Module</th><th>Functions</th></tr></thead><tbody><tr><td>fs</td><td>exists, is_dir, list, make_dir, read_file, write_file, append_file, delete, copy, move, get_size, get_free_space</td></tr><tr><td>redstone</td><td>get_input(side), get_analog_input(side), get_output(side), set_output(side, bool)</td></tr></tbody></table></section>
      <aside class="manual-callout"><b>Coordinate and color rules</b><p>Terminal coordinates are one-based. Color arguments use a single power-of-two mask; getters return that mask. Invalid arity, side, coordinate, color, path, or unavailable capability raises a guest-visible error.</p></aside>`,
  },
  {
    id: "optimization",
    number: "13",
    title: "Optimization workshop",
    summary: "Measure, identify, change, compare",
    html: `
      <header class="manual-page-header"><p class="manual-kicker">Chapter 13 · Performance engineering</p><h2>Optimization is part of the machine</h2><p class="manual-lead">Use deterministic guest metrics. Host timing is affected by Minecraft ticks, other Computers, and the global scheduler cap.</p></header>
      <section class="manual-section"><h3>13.1 The loop</h3><ol class="manual-procedure"><li><b>Establish correctness.</b> Save expected output.</li><li><b>Measure.</b> Record instructions and cycles with <code>run --stats</code>.</li><li><b>Find the dominant term.</b> Count loop iterations and expensive opcodes.</li><li><b>Change one idea.</b> Algorithm, invariant motion, strength reduction, or memory layout.</li><li><b>Compare.</b> Require equal output and lower cost.</li></ol></section>
      <section class="manual-section"><h3>13.2 Cost priorities</h3><table><thead><tr><th>Priority</th><th>Question</th><th>Typical action</th></tr></thead><tbody><tr><td>O(N)</td><td>Does work scale with input or nested iteration?</td><td>Change the algorithm first</td></tr><tr><td>Serial fraction</td><td>What remains under global scheduling?</td><td>Remove repeated setup and output</td></tr><tr><td>Opcode cost</td><td>Are DIV/MOD, taken branches, dword bus transfers, or PRINT dominant?</td><td>Strength-reduce, improve locality, or batch</td></tr><tr><td>Memory pressure</td><td>Are live objects forcing O(N) scans?</td><td>Release references and reuse buffers</td></tr></tbody></table><p>Compare optimizations on the same processor profile: CS386SX and CS486DX intentionally assign different costs to the same instruction stream.</p></section>
      <section class="manual-section manual-grid-2"><div><h3>Before</h3><pre><code>mov eax, 0
mov ecx, 100
loop:
 add eax, ecx
 sub ecx, 1
 cmp ecx, 0
 jg loop</code></pre></div><div><h3>After</h3><pre><code>; equivalent for fixed N
mov eax, 5050</code></pre></div></section>
      <aside class="manual-callout"><b>Amdahl / Gustafson</b><p>Faster guest code cannot remove the shared serial scheduler cap. As workloads grow across many Computers, bounded independent work scales better than one long synchronous native operation.</p></aside>`,
  },
  {
    id: "faults",
    number: "15",
    title: "Faults and diagnostics",
    summary: "Terminal states and recovery",
    html: `
      <header class="manual-page-header"><p class="manual-kicker">Chapter 15 · Service information</p><h2>Faults are explicit terminal outcomes</h2><p class="manual-lead">Every stateful path assigns a final owner. Crashes, cancellation, disconnect, retry exhaustion, shutdown, reboot, and bounded yields remain observable.</p></header>
      <section class="manual-section"><h3>15.1 CS486 faults</h3><table><thead><tr><th>Fault</th><th>Cause</th><th>Correction</th></tr></thead><tbody><tr><td>ExecutableFormatError</td><td>Bad header, opcode, operand, register, or target</td><td>Reassemble; inspect the source artifact</td></tr><tr><td>MemoryAccessError</td><td>32-bit access outside configured RAM</td><td>Correct address and allocation math</td></tr><tr><td>DivisionByZeroError</td><td>DIV or MOD divisor is zero</td><td>Guard the divisor</td></tr><tr><td>StackOverflowError</td><td>Stack grows below address zero</td><td>Reduce nesting or stack data</td></tr><tr><td>StackUnderflowError</td><td>POP/RET without a stored word</td><td>Balance PUSH/POP and CALL/RET</td></tr><tr><td>OutputLimitError</td><td>Program exceeds bounded output</td><td>Summarize or batch output</td></tr></tbody></table></section>
      <section class="manual-section"><h3>15.2 Shell statuses</h3><table><thead><tr><th>Status</th><th>Meaning</th></tr></thead><tbody><tr><td>0</td><td>Successful completion</td></tr><tr><td>1</td><td>Ordinary command failure / false result</td></tr><tr><td>2</td><td>Usage or explicitly unsupported option</td></tr><tr><td>124</td><td>CS486 instruction bound reached; yielded</td></tr><tr><td>127</td><td>Command not found for the active OS profile</td></tr></tbody></table></section>
      <section class="manual-section"><h3>15.3 Diagnostic sequence</h3><pre><code>cpuinfo
free -h
quota
objdump program
run --stats program
echo $?</code></pre></section>
      <aside class="manual-warning"><b>Server remains authoritative</b><p>A guest fault must never mutate host files or broaden permissions. If BDS or the terminal disconnects, reconnect and inspect the persisted Computer rather than retrying in an unbounded loop.</p></aside>`,
  },
  {
    id: "limits-glossary",
    number: "16",
    title: "Limits and glossary",
    summary: "Ceilings, terms, quick lookup",
    html: `
      <header class="manual-page-header"><p class="manual-kicker">Chapter 16 · Technical appendix</p><h2>Limits, units, and terminology</h2><p class="manual-lead">A limit is part of the programming model, not an exceptional host failure. Design programs so every ceiling has a useful observable outcome.</p></header>
      <section class="manual-section"><h3>16.1 Independent resource ceilings</h3><table><thead><tr><th>Resource</th><th>Measured as</th><th>Inspect with</th></tr></thead><tbody><tr><td>CPU</td><td>Instructions and modeled cycles</td><td>run --stats, time, cpuinfo</td></tr><tr><td>RAM</td><td>Live VM values and CS486 memory</td><td>free -h, /proc/meminfo</td></tr><tr><td>Disk</td><td>Persisted file bytes and entries</td><td>df, du, quota</td></tr><tr><td>Terminal</td><td>Rows × columns and bounded output</td><td>term.get_size()</td></tr><tr><td>Events</td><td>Queued records and wait ownership</td><td>Program diagnostics</td></tr><tr><td>Scheduler</td><td>Per-machine and global tick work</td><td>cpuinfo, run --stats</td></tr></tbody></table></section>
      <section class="manual-section"><h3>16.2 Terms</h3><table><thead><tr><th>Term</th><th>Definition</th></tr></thead><tbody><tr><td>Computer identity</td><td>Stable id binding block, item, storage, terminal, and runtime state</td></tr><tr><td>Guest</td><td>Code executing inside the sandboxed machine</td></tr><tr><td>Host</td><td>BDS, Minecraft, and the companion processes outside the guest boundary</td></tr><tr><td>Cycle debt</td><td>Modeled work awaiting fair scheduler service</td></tr><tr><td>Writer lease</td><td>Exclusive authority for one Web Terminal session to submit input</td></tr><tr><td>Terminal state</td><td>Explicit completion such as success, fault, cancel, close, shutdown, or yield</td></tr></tbody></table></section>
      <section class="manual-section"><h3>16.3 Quick diagnostic card</h3><pre><code>whoami             # identity and user
uname -a           # OS profile
cpuinfo            # modeled processor
free -h            # memory use
df                  # filesystem capacity
quota               # guest disk limits
history             # recent commands
echo $?             # previous status</code></pre></section>
      <aside class="manual-callout"><b>Reading path</b><p>New operators: 01 → 03 → 04 → 06 → 09. Low-level programmers: 02 → 10 → 12 → 13. Integrators: 05 → 07 → 08 → 15. Keep this appendix open while commissioning a machine.</p></aside>`,
  },
];

export const manualChapters = [...chapters].sort((left, right) =>
  left.number.localeCompare(right.number),
);
