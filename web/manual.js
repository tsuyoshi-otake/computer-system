const rawChapters = [
  {
    id: "orientation",
    html: `
      <header class="manual-page-header">
        <p class="manual-kicker">Chapter 01 · Operator orientation</p>
        <h2>From powered block to running program</h2>
        <p class="manual-lead">A Computer is a persistent, sandboxed machine. The desktop runs Computer System Linux 1.0 (CS-Linux 1.0); the portable runs Computer System DOS 6.2 (CS-DOS 6.2). Its terminal, files, redstone state, CPU budget, and RAM belong to its identity and survive normal world reloads.</p>
      </header>
      <div class="manual-spec-line"><span>Desktop</span><b>CS486DX · 33 MHz · 2 MiB</b><span>Advanced</span><b>CS486DX2 · 66 MHz · 8 MiB</b><span>Portable</span><b>CS386SX · 16 MHz · 2 MiB</b></div>
      <section class="manual-section"><h3>1.1 Choose a machine</h3><table><thead><tr><th>Machine</th><th>Default profile</th><th>Disk</th><th>Display</th><th>Languages</th></tr></thead><tbody><tr><td>Desktop</td><td>CS486DX · CS-Linux 1.0</td><td>40 MiB IDE</td><td>Exactly one adjacent Monitor</td><td>Computer System Python, ASM, BASIC, C, C++</td></tr><tr><td>Advanced Desktop</td><td>CS486DX2 · CS-Linux 1.0</td><td>80 MiB IDE</td><td>Exactly one adjacent Monitor</td><td>Computer System Python, ASM, BASIC, C, C++</td></tr><tr><td>Portable</td><td>CS386SX · CS-DOS 6.2</td><td>20 MiB IDE</td><td>Built-in; held or placed</td><td>ASM, BASIC, C, C++; no user Python</td></tr></tbody></table><p>The initial CS-Linux image allocates roughly 2–4 MiB and CS-DOS roughly 0.5–1 MiB. These are real guest files with sizes, permissions, and inode identities. Hardware identity, OS profile, storage, and the permanent browser connection number persist with the Computer identity.</p></section>
      <section class="manual-section"><h3>1.2 Power on, connect, and sign in</h3><ol class="manual-procedure"><li><b>Power on.</b> CSBIOS reports the persisted hardware, then hands control to the selected OS.</li><li><b>Connect.</b> Activate the eligible machine and enter its four-digit number on the Web Terminal entry page.</li><li><b>Initialize credentials.</b> A new CS-Linux installation asks for and confirms the password of its initial <code>cs</code> account before exposing the shell.</li><li><b>Authenticate later boots.</b> Existing CS-Linux installations ask for a username at <code>login:</code> and then that account's password; CS-DOS presents <code>C:\\&gt;</code> after its bounded startup files finish.</li></ol><p><code>cs</code> is UID/GID 1000 with home <code>/home/cs</code> and membership in <code>sudo</code>. UID 1000 is the protected boot-service account: its name and home may be changed while it is inactive, but it cannot be deleted. Root is UID/GID 0 and initially password-locked. Each OS boot resets the display but does not format the guest disk. Password plaintext is never stored or written to terminal history.</p></section>
      <section class="manual-section">
        <h3>1.3 Operating cycle</h3>
        <ol class="manual-procedure">
          <li><b>Inspect.</b> Run <code>cpuinfo</code>, <code>free -h</code>, and <code>quota</code>.</li>
          <li><b>Edit.</b> Use <code>vi</code> for source files. Desktop Computer System Python starts at <code>/startup.py</code>; the portable DOS profile uses <code>AUTOEXEC.BAT</code>.</li>
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
      <section class="manual-section"><h3>1.4 First inspection</h3><pre><code>whoami
pwd
cpuinfo
free -h
df
quota
ls -la /</code></pre></section>
      <section class="manual-section"><h3>1.5 Choose a reading route</h3><table><thead><tr><th>Goal</th><th>Route</th></tr></thead><tbody><tr><td>First program</td><td>01 → 02 → 03 → 05</td></tr><tr><td>Python + Redstone</td><td>01 → 02 → 03 → 05 → 06 → 07</td></tr><tr><td>CS-Linux operator</td><td>01 → 02 → 03 → 04 → 15</td></tr><tr><td>Native development</td><td>01 → 03 → 09 → 10 / 11 / 12 → 13</td></tr><tr><td>Portable / CS-DOS</td><td>01 → 02 → 14 → 09 → 10 / 11 / 12</td></tr><tr><td>Diagnose a problem</td><td>15 → 16</td></tr></tbody></table><p>Reference chapters are destinations, not prerequisites. Follow one route, then use manual search to jump directly to a command, API, instruction, fault, or concept.</p></section>`,
  },
  {
    id: "architecture",
    html: `
      <header class="manual-page-header"><p class="manual-kicker">Chapter 02 · Hardware model</p><h2>Three machine profiles, one safe instruction format</h2><p class="manual-lead">Desktop Computer Systems select a CS486DX at 33 MHz with 2 MiB RAM; Advanced Desktop Computer Systems select a CS486DX2 at 66 MHz with 8 MiB RAM; the Portable Computer System selects a CS386SX at 16 MHz with 2 MiB RAM. The persisted CPU model selects timing in O(1), while the bounded scheduler arbitrates actual BDS work fairly.</p></header>
      <figure class="manual-figure manual-figure--desktop"><img src="/assets/manual/desktop-computer-system.png" width="452" height="511" alt="Desktop Computer System with a 486DX 33 MHz system unit, monochrome CRT, keyboard, mouse, and floppy drives" loading="lazy" decoding="async"><figcaption><b>Desktop Computer System.</b> The workstation illustration establishes the nominal CS486DX hardware identity. The Minecraft implementation models the machine rather than emulating the pictured host hardware literally.</figcaption></figure>
      <section class="manual-section"><h3>2.1 Machine family</h3><div class="manual-asset-grid manual-asset-grid--machines">
        <figure class="manual-asset-card"><img src="/assets/machines/cs-computer.png" width="1920" height="1920" alt="Desktop Computer System single-drive chassis" loading="lazy" decoding="async"><figcaption><b>Desktop Computer System</b><span>CS486DX · 33 MHz · 2 MiB · CS-Linux 1.0</span></figcaption></figure>
        <figure class="manual-asset-card"><img src="/assets/machines/cs-advanced-computer.png" width="1920" height="1920" alt="Advanced Desktop Computer System dual-drive chassis" loading="lazy" decoding="async"><figcaption><b>Advanced Desktop Computer System</b><span>CS486DX2 · 66 MHz · 8 MiB · CS-Linux 1.0</span></figcaption></figure>
        <figure class="manual-asset-card"><img src="/assets/machines/cs-monitor.png" width="1920" height="1920" alt="Computer System CRT monitor" loading="lazy" decoding="async"><figcaption><b>Monitor</b><span>Terminal and display peripheral; no independent CPU or RAM.</span></figcaption></figure>
        <figure class="manual-asset-card"><img src="/assets/machines/cs-portable-computer.png" width="1920" height="1920" alt="Portable Computer System laptop with trackball" loading="lazy" decoding="async"><figcaption><b>Portable Computer System</b><span>CS386SX · 16 MHz · 2 MiB · CS-DOS 6.2 · held or placed</span></figcaption></figure>
      </div></section>
      <section class="manual-section"><h3>2.2 Processor identity</h3><div class="manual-asset-grid manual-asset-grid--cpu">
        <figure class="manual-asset-card"><img src="/assets/cpu/CS486DX.png" width="1920" height="1883" alt="CS486DX processor identification plate" loading="lazy" decoding="async"><figcaption><b>CS486DX</b><span>Standard desktop processor</span></figcaption></figure>
        <figure class="manual-asset-card"><img src="/assets/cpu/CS486DX2.png" width="1268" height="1241" alt="CS486DX2 processor identification plate" loading="lazy" decoding="async"><figcaption><b>CS486DX2</b><span>Advanced desktop processor</span></figcaption></figure>
        <figure class="manual-asset-card"><img src="/assets/cpu/CS386SX.png" width="1920" height="1883" alt="CS386SX processor identification plate" loading="lazy" decoding="async"><figcaption><b>CS386SX</b><span>Portable processor with a 16-bit external data bus</span></figcaption></figure>
      </div></section>
      <section class="manual-section"><h3>2.3 Register file</h3>
        <table><thead><tr><th>Register</th><th>Conventional use</th><th>Width</th></tr></thead><tbody>
          <tr><td>EAX</td><td>Accumulator and expression result</td><td>32 bit</td></tr><tr><td>EBX</td><td>Secondary operand</td><td>32 bit</td></tr>
          <tr><td>ECX</td><td>Loop counter</td><td>32 bit</td></tr><tr><td>EDX</td><td>General data</td><td>32 bit</td></tr>
          <tr><td>ESI / EDI</td><td>Source / destination index</td><td>32 bit</td></tr><tr><td>ESP / EBP</td><td>Stack top / initial stack base</td><td>32 bit</td></tr>
        </tbody></table>
      </section>
      <aside class="manual-callout"><b>Checked stack/static-data boundary</b><p>Linked <code>.rodata</code>, <code>.data</code>, and <code>.bss</code> occupy the low-address static-data region. The stack starts at the top of RAM and grows downward, but <code>PUSH</code> and <code>CALL</code> may not cross the aligned static-data floor. <code>POP</code> and <code>RET</code> may not move above RAM, and an invalid return address faults instead of completing accidentally. These checks apply to direct ASM and to every language that runs through the shared CS486 process.</p></aside>
      <section class="manual-section manual-grid-2"><div><h3>2.4 Memory model</h3><p>RAM is a checked, little-endian linear byte array. <code>LOAD</code> and <code>STORE</code> transfer signed 32-bit words. CS386SX exposes a 24-bit address bus and a 16-bit data bus, with 2 MiB provided by two 1 MiB 30-pin SIMM DRAM modules. An even-addressed dword needs two 16-bit transfers; an odd-addressed dword needs three and records an unaligned access. CS486DX uses four 512 KiB 30-pin SIMMs, while CS486DX2 uses two 4 MiB 72-pin SIMMs. The stack begins at the top of RAM and grows downward.</p><p>Memory reports include bounded OS overhead as well as live guest data. CS-Linux separates resident kernel, system services, buffers, and guest runtime. CS-DOS separates DOS system/drivers and guest runtime while preserving conventional, upper, reserved, and XMS region totals.</p></div><div class="manual-memory-map"><span>LOW ADDRESS</span><b>OS resident memory</b><b>compiler variables / heap</b><b>free space</b><b>↓ stack growth</b><span>HIGH ADDRESS</span></div></section>
      <section class="manual-section"><h3>2.5 Model-specific cycle classes</h3><table><thead><tr><th>Class</th><th>CS486DX / CS486DX2</th><th>CS386SX</th></tr></thead><tbody><tr><td>Simple ALU</td><td>1</td><td>2</td></tr><tr><td>LOAD / STORE base</td><td>2 / 2 plus cache and write-through</td><td>6 / 4 plus odd-address penalty</td></tr><tr><td>PUSH / POP base</td><td>2 / 2</td><td>4 / 6</td></tr><tr><td>Conditional branch</td><td>3 taken / 1 not taken</td><td>7 taken / 3 not taken</td></tr><tr><td>CALL / RET</td><td>3 / 3</td><td>9 / 12</td></tr><tr><td>MUL</td><td>9</td><td>9–38, operand early-out</td></tr><tr><td>DIV / MOD</td><td>40</td><td>43</td></tr><tr><td>PRINT</td><td>8 + payload</td><td>12 + 16-bit bus payload</td></tr></tbody></table><p>At 20 ticks per second the standard desktop receives 1,650,000 cycles/tick, the Advanced Desktop receives 3,300,000 cycles/tick, and the portable receives 800,000 cycles/tick. CS486DX and CS486DX2 have a cold 8 KiB four-way unified L1 with 16-byte lines and write-through stores; Advanced adds a 256 KiB external L2. CS386SX has neither cache. Cache tags, recency, prefetch state, and counters are transient per process. Every access remains O(1).</p></section>
      <section class="manual-section"><h3>2.6 CSBIOS and VGA display profiles</h3><p>Power-on first enters the original <b>CSBIOS System Configuration</b> screen in 80x25 text mode. The POST table is generated from the Computer's persisted CPU, clock, RAM, display adapter, VRAM, and disk quota. On the next runtime step CSBIOS clears its frame and explicitly hands control to CS-DOS or CS-Linux. CS-DOS then shows only its identity, a blank line, and <code>C:\\&gt;</code>; CS-Linux shows only its identity, a blank line, and the password or shell prompt. Neither advertises a simulated tty or startup shell-version banner.</p><table><thead><tr><th>Machine</th><th>VRAM</th><th>Physical presentation</th><th>640x480 maximum mode</th></tr></thead><tbody><tr><td>Portable</td><td>256 KiB</td><td>800x480 LCD, centered 640x480 with 80 px side bars</td><td>16 colors, four VGA planes</td></tr><tr><td>Desktop</td><td>512 KiB</td><td>640x480 Monitor</td><td>256 indexed colors</td></tr><tr><td>Advanced Desktop</td><td>512 KiB</td><td>640x480 Monitor</td><td>256 indexed colors with lower modeled transfer cost</td></tr></tbody></table><p>Every model also supports 320x200 with 256 colors. The 800x480 Portable panel is not a guest mode, and no model advertises a resolution above 640x480. VRAM is volatile and allocated only while powered; World Dynamic Properties store the small display-profile ID, never framebuffer bytes. Dirty graphics work uses a fixed-capacity queue with O(1) marking and bounded O(D) extraction. One Computer-scoped broker drains it once and shares each immutable update across attached sessions, with queued keyframes for late connections, epoch changes on mode replacement, and fixed Computer, tile, and byte budgets. This keeps publication work O(D+S). The Web text presentation keeps a fixed 80x25 guest grid and scales it to the viewport. Web Canvas delivery and guest graphics APIs remain the next implementation stage.</p></section>
      <aside class="manual-warning"><b>Terminal condition required</b><p>A direct run halts normally, faults, or yields after 10,000 instructions with exit status 124. It never owns the server tick indefinitely.</p></aside>`,
  },
  {
    id: "assembly",
    html: `
      <header class="manual-page-header"><p class="manual-kicker">Chapter 10 · Low-level programming</p><h2>CS486 assembly language</h2><p class="manual-lead">One instruction per line. Labels end in a colon; semicolons begin comments. Registers are case-insensitive. Memory operands use square brackets.</p></header>
      <section class="manual-section"><h3>10.1 Build and inspect</h3><pre><code># CS-Linux: direct executable
as total.asm -o total
objdump total
run --stats total

# CS-Linux: object plus static link
as -c fast.asm -o fast.o
nm fast.o
objdump fast.o
ld fast.o -o fast -e start

REM CS-DOS: the aliases accept DOS switches
ASM /C FAST.ASM /OUT:FAST.O
LINK FAST.O /OUT:FAST /ENTRY:START
RUN FAST /STATS</code></pre><p>CS-Linux uses <code>as</code>/<code>ld</code> with <code>-c</code>, <code>-o</code>, and <code>-e</code>. CS-DOS additionally exposes <code>ASM</code>/<code>LINK</code> and accepts <code>/C</code>, <code>/OUT:</code>, and <code>/ENTRY:</code>; output paths still obey strict DOS 8.3 rules and diagnostics use CRLF. Relocatable assembly declares exported labels with <code>global name</code> and imported labels with <code>extern name</code>. Unmarked labels remain local to that object.</p><p>The resulting <code>CS486OBJ</code> v2 object stores sections, typed symbols, initialized data, alignment, and structured relocations. <code>nm</code> and <code>objdump</code> inspect those records; the linker resolves symbols through bounded maps without rewriting assembly text. Existing v1 objects remain readable.</p></section>
      <section class="manual-section"><h3>10.2 Instruction set</h3><table class="manual-instruction-table"><thead><tr><th>Form</th><th>Operation</th></tr></thead><tbody>
        <tr><td>MOV reg, src</td><td>Copy immediate or register</td></tr><tr><td>LOAD reg, [addr]</td><td>Read signed 32-bit word</td></tr><tr><td>STORE [addr], reg</td><td>Write signed 32-bit word</td></tr>
        <tr><td>ADD / SUB / MUL / DIV / MOD</td><td>Integer arithmetic into destination</td></tr><tr><td>AND / OR / XOR</td><td>Bitwise operation</td></tr><tr><td>SHL / SHR</td><td>Signed 32-bit shift; count masked to 0…31</td></tr>
        <tr><td>CMP reg, src</td><td>Set internal comparison result</td></tr><tr><td>JMP / JE / JNE</td><td>Unconditional / equal / unequal branch</td></tr><tr><td>JL / JLE / JG / JGE</td><td>Signed relational branch</td></tr>
        <tr><td>PUSH / POP</td><td>32-bit stack transfer</td></tr><tr><td>CALL / RET</td><td>Push return address / resume caller</td></tr><tr><td>PRINT src</td><td>Write register, immediate, or quoted string</td></tr><tr><td>HALT</td><td>Successful terminal state</td></tr>
      </tbody></table><p>The source path flows through a dedicated tokenizer, bounded preprocessor, parser, constant-expression evaluator, and two assembly passes. Source-span diagnostics identify the guest file, line, and column. Directives include <code>section .text</code>, <code>.rodata</code>, <code>.data</code>, <code>.bss</code>, <code>global</code>, <code>extern</code>, <code>type</code>, <code>align</code>, <code>equ</code>, initialized <code>db</code>/<code>dw</code>/<code>dd</code> data, and reserved <code>resb</code>/<code>resw</code>/<code>resd</code> storage. DOS source may use <code>.CODE</code>, <code>.CONST</code>, <code>PUBLIC</code>, and <code>EXTRN</code> aliases.</p><pre><code>%define COUNT 5
%include "common.inc"
%macro add_to 2
  add %1, %2
%%done:
%endmacro</code></pre><p>Includes are resolved relative to the source inside the credentialed guest filesystem. The preprocessor reads at most 1,000,000 source characters in total and allows at most 100,000 lexical tokens, 64 include files at depth 8, 256 macro definitions, 32 arguments per call, macro expansion depth 16, and 100,000 expanded tokens. Source characters and lexical tokens are checked before token arrays are materialized; expanded tokens are reserved before definition or macro output is appended. Exceeding a bound, a circular include, or recursive expansion is an explicit source error. DOS also accepts <code>INCLUDE</code> and <code>name MACRO</code> ... <code>ENDM</code>. Labels beginning with <code>%%</code> are local to one macro expansion.</p><p><code>.rodata</code> is a layout and symbol-type category, not runtime page protection. Relocations distinguish control-flow targets from data addresses; a call to a data symbol, a data reference to a function, duplicate symbols, unresolved symbols, bad relocation fields, or total RAM overflow stops the link.</p></section>
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
    html: `
      <header class="manual-page-header"><p class="manual-kicker">Chapter 06 · Desktop language runtime</p><h2>Computer System Python on CS486</h2><p class="manual-lead">On the desktop CS486DX and CS486DX2 profiles, the MicroPython-compatible language compiles to the same resumable guest process as C, C++, ASM, and BASIC; there is no separate Python VM. Source in <code>/startup.py</code> starts when the Computer powers on. The portable CS386SX DOS profile does not expose user MicroPython.</p></header>
      <section class="manual-section manual-grid-2"><div><h3>6.1 Edit and boot</h3><pre><code>vi /startup.py
        reboot</code></pre><p>Normal completion powers the program down. Infinite work remains preemptible by the common scheduler.</p><p>CS-Linux can also compile and run a source file as a foreground process from the normal Web Terminal:</p><pre><code>python /tmp/program.py
python --stats /tmp/program.py
micropython /tmp/program.py</code></pre><p><code>python</code> and <code>micropython</code> are aliases for the same Computer System Python frontend. The shell waits while the process runs, routes guest events to it, and restores the prompt after completion, failure, or <kbd>Ctrl</kbd>+<kbd>C</kbd>. Add <code>--stats</code> to print machine instructions, modeled CPU cycles, and virtual time. Foreground Python is intentionally rejected inside pipelines, redirects, scripts, and command chains. Desktop boot creates an empty mode-0644 <code>/startup.py</code> owned by the current UID 1000 service account while keeping <code>/</code> root-owned. Empty source selects the built-in shell boot program; after <code>cs</code> saves non-empty source with <code>vi</code>, later boots execute it with UID 1000's current primary and supplementary groups. The native <code>shell</code> module is internal to that built-in empty-startup program and is unavailable to user-authored <code>/startup.py</code>, foreground Python, and MCP Python. The MCP form remains a bounded non-TUI debug probe.</p></div><div><h3>6.2 Core language</h3><p>Variables, numbers, strings, booleans, lists, tuples, dictionaries, functions, imports, conditionals, loops, exceptions, formatting, and bounded built-ins compile to shared call/jump control flow and allowlisted managed-runtime syscalls.</p></div></section>
      <section class="manual-section"><h3>6.3 Native modules</h3><table><thead><tr><th>Module</th><th>Purpose</th><th>Representative calls</th></tr></thead><tbody>
        <tr><td>os</td><td>Identity, time, events, timers, lifecycle</td><td>get_computer_id, clock, sleep, pull_event, queue_event, shutdown, reboot</td></tr>
        <tr><td>term</td><td>Fixed-cell terminal</td><td>write, clear, set_cursor_pos, set_text_color</td></tr>
        <tr><td>fs</td><td>Sandbox filesystem</td><td>read_file, write_file, exists, make_dir, get_size, get_free_space</td></tr>
        <tr><td>redstone</td><td>Six-sided digital / analog I/O</td><td>get_input, get_analog_input, set_output</td></tr>
        <tr><td>serial</td><td>Six full-duplex RS-232C ports</td><td>read, write, status</td></tr>
        <tr><td>spi</td><td>Bounded controller transfers</td><td>transfer</td></tr>
        <tr><td>i2c</td><td>Bounded addressed controller transfers</td><td>scan, transfer</td></tr>
      </tbody></table><p><code>shell</code> is deliberately absent from the public module table. It carries the authenticated terminal adapter and is granted only to the built-in shell program selected by an empty <code>/startup.py</code>; user Python cannot import it.</p></section>
      <section class="manual-section"><h3>6.4 Python modules</h3><pre><code># /home/cs/main.py
import helper
print(helper.answer())</code></pre><p>Module lookup checks the importing file's directory, then <code>/lib/python</code> and <code>/usr/lib/computer-system/python</code>. A <code>.py</code> module initializes once. Missing, circular, oversized, and failed imports stop with <code>ImportError</code>.</p></section>
      <section class="manual-section"><h3>6.5 Import a C or C++ object</h3><pre><code>cc -c /fastmath.c -o /fastmath.o
vi /startup.py

# /startup.py
import fastmath
print(fastmath.answer())

reboot</code></pre><p>A sibling <code>CS486OBJ</code> file or one in a Python library directory becomes a module. Its global functions use the current zero-argument integer ABI and return through EAX. The function executes inside the calling Python CS486 process, so its instructions, cycles, faults, and RAM accesses use the same limits. This is sandboxed static extension loading, not a host DLL or shared object.</p></section>
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
    html: `
      <header class="manual-page-header"><p class="manual-kicker">Chapter 04 · Command environment</p><h2>Computer System Bash</h2><p class="manual-lead">A bounded compatibility shell implemented inside the application layer. It is not host Bash and cannot escape to a native process.</p></header>
      <section class="manual-section"><h3>4.1 Grammar</h3><table><thead><tr><th>Feature</th><th>Syntax</th></tr></thead><tbody><tr><td>Pipeline</td><td><code>a | b</code></td></tr><tr><td>Redirection</td><td><code>&lt;</code>, <code>&gt;</code>, <code>&gt;&gt;</code></td></tr><tr><td>Control</td><td><code>&amp;&amp;</code>, <code>||</code>, <code>;</code></td></tr><tr><td>Expansion</td><td><code>$VAR</code>, <code>$?</code>, positional parameters</td></tr><tr><td>Scripts</td><td>if/else, for, while, functions, break, continue, return, source</td></tr></tbody></table></section>
      <section class="manual-section"><h3>4.2 Command families</h3><div class="manual-command-bank"><p><b>Files</b> pwd cd ls cat mkdir touch rm cp mv find stat df du quota</p><p><b>Text</b> echo printf head tail wc grep sort uniq tr cut seq</p><p><b>Shell</b> sh bash source env export unset which type history time umask</p><p><b>Identity</b> whoami id groups login logout passwd su sudo getent</p><p><b>Accounts</b> useradd userdel usermod groupadd groupdel</p><p><b>Processes and sessions</b> ps top kill jobs fg bg wait tty who w last</p><p><b>System</b> hostname uname date uptime sleep service man apropos sync shutdown reboot</p></div></section>
      <section class="manual-section manual-grid-2"><div><h3>4.3 Startup</h3><pre><code>/etc/profile
/etc/bash.bashrc
~/.bashrc</code></pre><p>Files are created non-destructively and loaded in that order only after authentication succeeds.</p></div><div><h3>4.4 Example</h3><pre><code>for name in alpha beta alpha; do
  echo "$name"
done | sort | uniq</code></pre></div></section>
      <section class="manual-section"><h3>4.5 Boot and first login</h3><ol class="manual-procedure"><li><b>Reset the display.</b> Each OS boot clears the terminal cells, colors, and cursor before printing one boot banner. This does not format the guest disk.</li><li><b>Restore the system.</b> Files under <code>/etc</code>, <code>/home</code>, and <code>/usr</code>, including the account database, remain persisted; volatile <code>/tmp</code> is rebuilt.</li><li><b>Initialize credentials.</b> On a new CS-Linux installation, the boot banner and <code>New password:</code> prompt each appear once for <code>cs</code>. No simulated first-boot notice or startup transcript is printed. Enter 8–64 UTF-8 characters, then confirm at <code>Retype new password:</code>.</li><li><b>Authenticate later boots.</b> Existing installations stop at <code>login:</code>, accept an unlocked username, and then ask for <code>Password:</code>. Three failures add a two-second guest delay.</li></ol><p>The password is not reversibly encrypted. CS-Linux stores a salted, bounded 512-round one-way SHA-256 payload in root-readable <code>/etc/shadow</code>; plaintext is never stored. Secret Web input is masked and excluded from history and Tab completion. User startup files run only after authentication succeeds.</p></section>
      <section class="manual-section"><h3>4.6 Users and superuser</h3><table><thead><tr><th>Identity or command</th><th>Contract</th></tr></thead><tbody><tr><td><code>cs</code></td><td>Initial administrator and protected boot-service identity, UID/GID 1000, home <code>/home/cs</code>, member of <code>sudo</code>.</td></tr><tr><td><code>root</code></td><td>The only UID 0 superuser. Its password starts locked and must be deliberately assigned before password login or <code>su</code> can select it.</td></tr><tr><td><code>passwd</code></td><td>Changes a permitted account's password without echoing or retaining plaintext.</td></tr><tr><td><code>sudo</code></td><td>Available only to <code>sudo</code> members; authenticates the caller and grants scoped effective privilege for the requested work.</td></tr><tr><td><code>su</code></td><td>Authenticates the target account and enters that account context until the nested session exits.</td></tr><tr><td><code>useradd</code>, <code>userdel</code>, <code>usermod</code></td><td>Superuser-only bounded user management backed by the account files; UID 1000 cannot be deleted, and active identities cannot be renamed or have their home moved.</td></tr><tr><td><code>groupadd</code>, <code>groupdel</code></td><td>Superuser-only bounded group management with referential checks.</td></tr></tbody></table><pre><code>sudo useradd alice
sudo passwd alice
sudo usermod -aG sudo alice
getent passwd alice
sudo -i
exit
su - alice
sudo userdel -r alice</code></pre><p><code>useradd</code> creates a mode-0700 home by default; use <code>-M</code> to skip it. <code>userdel -r</code> removes the home after the bounded account transaction. <code>sudo -i</code> enters a nested login context and <code>exit</code> restores the caller. A successful caller-password check is cached for five guest minutes; <code>sudo -k</code> clears it, while <code>sudo -n command</code> succeeds only when no prompt is needed. Scripts and pipelines cannot own login/logout or open a password prompt. MCP accepts only that non-interactive <code>sudo -n</code> form and never consumes a secret prompt. The final terminal disconnect cancels any secret prompt, clears the timestamp and nested identity state, cancels foreground, compiler, and queued MCP work that captured the session credentials, and returns to <code>login:</code>. Runtime finalization applies even when user Python ignores <code>terminal_closed</code>, so reconnecting cannot inherit an unattended root shell or stale elevated process.</p><p><code>/etc/passwd</code>, <code>/etc/group</code>, and <code>/etc/shadow</code> are the authoritative account database. Direct writes, links, moves, metadata changes, and deletion are rejected even for root; use the account commands so all three validated records commit together. A failed mutation leaves an explicit nonzero result and never a knowingly partial account. Leaving an elevated or switched session restores the caller, including after failure or cancellation.</p></section>
      <section class="manual-section"><h3>4.7 Prompt, MOTD, and persistent history</h3><p>An authenticated prompt uses <code>login@computer-id:path$</code>; effective UID 0 uses <code>#</code>. A later login shows the previous tty and guest tick, then reads the real <code>/etc/motd</code>. The user's mode-0600 <code>.bash_history</code> retains at most 100 entries, 512 UTF-8 bytes per line, and 32 KiB total across logout, disconnect, and reboot. Password conversations never enter history.</p><pre><code>cs@c-xxxxxx:~$ tty
/dev/tty1
cs@c-xxxxxx:~$ who
cs@c-xxxxxx:~$ last</code></pre></section>
      <section class="manual-section"><h3>4.8 Processes, signals, and jobs</h3><p>PID 1 is <code>/sbin/cs-init</code>; <code>cs-login</code> owns a waiting getty, and the authenticated shell and admitted Python/CS486 work become explicit child processes. <code>ps -f</code> shows PID, PPID, UID, state, modeled cycles, start tick, and command. <code>top</code> is one bounded snapshot, not a refresh loop. <code>kill</code> supports HUP, INT, TERM, KILL, STOP, and CONT with guest ownership checks and protects PID 1.</p><pre><code>sleep 30 &amp;
jobs
ps -f
kill -STOP 4
bg %1
wait %1</code></pre><p>Only one interactive <code>sleep</code>, <code>python</code>/<code>micropython</code>, or <code>run</code> command may end in <code>&amp;</code>. Redirects, pipelines, scripts, aliases, functions, TUI or secret-prompt work, lifecycle commands, MCP submissions, and unsupported commands fail before side effects. Completed jobs remain zombies only until <code>wait</code> or foreground consumption reaps them.</p></section>
      <section class="manual-section"><h3>4.9 Services, proc, devices, and journals</h3><p><code>service --status-all</code> and <code>service NAME status</code> inspect the real bounded service table. Start, stop, and restart remain owned by <code>cs-init</code> and are not operator commands. <code>man TOPIC</code> and <code>apropos WORD</code> use the installed versioned guest index, never host man pages or the Internet.</p><pre><code>cat /proc/devices
cat /proc/services
cat /proc/self/status
cat /proc/4/cmdline
dmesg
sudo cat /var/log/messages
sudo cat /var/log/auth.log</code></pre><p><code>/proc/&lt;pid&gt;/cmdline</code>, <code>stat</code>, and <code>status</code>, plus <code>/proc/self/*</code>, <code>loadavg</code>, and mount/device/service views all come from one per-Computer OS state. The journal defaults to 256 records and 32 KiB total. The device registry includes tty/console/null/zero, the fixed disk, and an absent-media floppy; none are host device files.</p></section>
      <section class="manual-section"><h3>4.10 Sync, graceful stop, and safe recovery</h3><p><code>sync</code> crosses the real Computer persistence boundary. Shutdown and reboot stop new admission, signal owned work, drain already-admitted block I/O, save data, unmount, stop services/devices, then record <code>final sync requested</code> and that the intent is prepared for final persistence before saving the final cold projection. Only then may the machine power off or reboot. The two neutral terminal records survive cold restore exactly once; no unsaved success line is added after the callback. If marker creation or the callback fails, only that attempt's provisional markers are removed before the fault is published. A later automatic dirty save can retain the fault but cannot turn the failed final boundary into apparent success. Each phase has a 200-tick deadline, and a durability or drain failure faults visibly instead of claiming a clean stop.</p><p>The runtime has a one-shot safe-boot boundary that preserves but bypasses a broken <code>/startup.py</code> and records that choice in the boot journal. It is available only while the Computer is <code>crashed</code>. In Minecraft, open the crashed Computer normally to see the recovery instruction, then sneak while opening it to safe boot. On an attached Web Terminal, the crashed-state power control changes to safe boot. Both controls preserve the exact startup file; neither resets or edits it. Safe boot is unavailable from the guest shell and MCP command path.</p></section>
      <aside class="manual-callout"><b>Account transaction bounds</b><p>The legacy name <code>computer</code> is permanently reserved for both users and groups, keeping full migration unambiguous. A user may have at most 32 supplementary groups; adding a 33rd is rejected without changing any account file. Default <code>useradd</code> recursively provisions missing home ancestors as one all-or-nothing operation, so a failure leaves neither the account nor a partial home tree.</p></aside>
      <aside class="manual-callout"><b>Calendar safety</b><p>CS-Linux and CS-DOS preserve four-digit UTC years. <code>date</code>/<code>DATE</code> do not apply a two-digit-year pivot, correctly represent 2000-02-29, and use timestamps beyond the signed 32-bit 2038 boundary.</p></aside>
      <aside class="manual-callout"><b>Cost ownership</b><p>Commands, script lines, loop iterations, and output create bounded cycle debt. The shell cannot become a free execution path around the CPU model. Interactive command dispatch and <code>.sh</code> scripts currently use the bounded shell interpreter; unlike Python, scripts have not yet moved to CS486 instructions.</p></aside>`,
  },
  {
    id: "basic",
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
    html: `
      <header class="manual-page-header"><p class="manual-kicker">Chapter 12 · C-family compilers</p><h2>Typed source for the CS486 target</h2><p class="manual-lead">Dedicated bounded tokenizers and parsers accept deliberately small, auditable C and C++ subsets. They do not invoke GCC or Clang and do not claim ISO language or x86 binary compatibility.</p></header>
      <section class="manual-section manual-grid-2"><div><h3>12.1 C</h3><pre><code>cc program.c -o program</code></pre><p><code>int</code>/<code>long</code> locals, integer expressions, assignment, canonical for loops, <code>printf("%d\\n", value)</code>, and return.</p></div><div><h3>12.2 C++</h3><pre><code>c++ program.cpp -o program</code></pre><p>The C subset plus <code>std::cout &lt;&lt; value &lt;&lt; std::endl</code>. Classes, templates, exceptions, RTTI, and the standard library are not implemented.</p></div></section>
      <section class="manual-section"><h3>12.3 Summation in C</h3><pre><code>int main() {
  int total = 0;
  for (int i = 1; i &lt;= 100; i++) {
    total = total + i;
  }
  printf("%d\\n", total);
  return 0;
}</code></pre></section>
      <section class="manual-section"><h3>12.4 Frontend, CSIR, and register allocation</h3><p>The source-character and token ceilings are checked before arrays grow. The tokenizer records source spans; the parser builds a typed AST with lexical scopes and rejects undeclared, duplicate, malformed, or unsupported constructs before producing an object. A function declaration or prototype must precede each call, and an in-scope local with the same name shadows the function and is not callable.</p><p>The typed AST lowers to CSIR. Every computed value has one SSA definition, while mutable C locals remain explicit <code>load-local</code>/<code>store-local</code> operations: this is value SSA, not memory SSA. A bounded verifier checks types, definitions, dominance, control-flow targets, and explicit block terminators. Pass-capped deterministic optimization performs constant folding, copy propagation, unreachable-block cleanup, and dead-pure-value elimination.</p><p>The backend uses bounded deterministic linear-scan allocation and checked stack spills. ESP and EBP are reserved, values live across a call are conservatively spilled, and locals occupy EBP-relative stack-frame slots. Graph coloring is not required and is not implemented. Inspect the typed symbols, relocations, and final instruction stream with <code>nm</code> and <code>objdump</code>.</p></section>
      <section class="manual-section"><h3>12.5 Objects, static linking, and Python imports</h3><pre><code>cc -c main.c -o main.o
as -c fast.asm -o fast.o
nm main.o
ld main.o fast.o -o program
 run --stats program</code></pre><p>New writers emit version 2 of the validated <code>CS486OBJ</code> format. It carries ordered <code>.text</code>, <code>.rodata</code>, <code>.data</code>, and <code>.bss</code> sections, typed local/global/undefined symbols, optional <code>()-&gt;i32</code>/<code>()-&gt;void</code> function signatures, alignment, initialized bytes, and structured instruction/data relocations; the reader retains v1 object compatibility. <code>extern int fast();</code> creates an undefined zero-argument text-function symbol with the integer-return signature, and C/C++ definitions record the same contract. Known return-signature conflicts stop the link deterministically. ASM may opt in with <code>signature fast, i32</code> or remain untyped for v1 compatibility. Integer callees return through EAX. Each compiled definition owns an EBP-based stack frame whose epilogue restores ESP and EBP before RET. Duplicate, unresolved, corrupt, or type-mismatched symbols stop the link.</p><p>Linked static bytes are installed in low RAM before execution, and the aligned end of all static data becomes the stack floor. A Python script may <code>import fast</code> only when the valid object exports the current zero-argument EAX-return text-function ABI; a known void function and data-symbol imports are not exposed. Untyped legacy ASM functions remain intentionally compatible. Every imported machine instruction is charged to the same CS486 process.</p></section>
      <section class="manual-section"><h3>12.6 Cross-profile executable compatibility</h3><p><code>as</code>, <code>basicc</code>, <code>cc</code>, and <code>c++</code> write the same validated <b>Computer System CS486 executable</b> format under CS-Linux and CS-DOS. <code>CS486OBJ</code> is not Linux ELF or OMF, and <code>CS486</code> is not a native DOS <code>.COM</code>/<code>.EXE</code> or host x86 machine code. Neither profile invokes a host assembler, linker, or loader. A CS486 executable built under CS-Linux can run under CS-DOS after it is transferred intact to a valid DOS 8.3 path. The destination Computer supplies the CPU timing, cache or bus behavior, RAM ceiling, and filesystem rules.</p><p>There is currently no guest command for copying a file between two different Computer identities and no shared guest disk. Therefore format compatibility does not imply that <code>cp</code> can cross machines, and this common format alone is not a demonstration of an operator-visible cross-machine transfer. Dynamic linking, native object ingestion, native GDB or DOS DEBUG emulation, source-level debug metadata, PIC/IRQ/IDT execution, BIOS/DOS interrupts, and native COM/EXE loading are not implemented; use the versioned static object/ABI boundary.</p></section>
      <section class="manual-section"><h3>12.7 Restricted inline assembly</h3><pre><code>int answer = 0;
asm("mov eax, 6");
asm("mul eax, 7");
asm("store [answer], eax");</code></pre><p>Inline assembly executes at a statement boundary. It may use ordinary arithmetic and checked memory operations. Labels, branches, CALL/RET, PUSH/POP, HALT, and ESP/EBP access are rejected. Dynamic libraries are not yet supported.</p></section>
      <aside class="manual-callout"><b>Manual optimization</b><p>Reduce repeated DIV/MOD, simplify constant expressions, remove redundant variables, and compare the generated instruction stream. A shorter source file is not necessarily a cheaper executable.</p></aside>`,
  },
  {
    id: "io-files",
    html: `
      <header class="manual-page-header"><p class="manual-kicker">Chapter 05 · Filesystem interface</p><h2>Filesystem and storage</h2><p class="manual-lead">Minecraft behavior is exposed through bounded adapters. The domain/runtime core does not import Minecraft APIs.</p></header>
      <section class="manual-section"><h3>5.1 Linux layout</h3><table><thead><tr><th>Path</th><th>Role</th></tr></thead><tbody><tr><td>/etc</td><td>Root-owned system configuration, account files, MOTD, and Bash startup</td></tr><tr><td>/dev</td><td>State-backed guest device identities</td></tr><tr><td>/proc</td><td>Dynamic CPU, memory, process, service, device, version, uptime, load, and mount views</td></tr><tr><td>/run</td><td>Volatile runtime mount</td></tr><tr><td>/tmp</td><td>Volatile mode-1777 sticky working files</td></tr><tr><td>/usr/share/man</td><td>Installed versioned manual index notice</td></tr><tr><td>/var/log</td><td>Bounded messages and authentication journal views</td></tr><tr><td>/startup.py</td><td>Mode-0644 desktop boot source owned and executed by the authoritative UID 1000 account</td></tr><tr><td>/home/cs</td><td>Initial UID/GID 1000 user home and mode-0600 shell history</td></tr><tr><td>/root</td><td>UID/GID 0 superuser home</td></tr></tbody></table><p>CS-Linux persists mode, UID, GID, modification time, symbolic links, hard-link groups, deletion tombstones, and a cold OS-runtime projection. Older snapshots without these optional fields remain readable and receive safe defaults on boot; they never resurrect a stale process, job, mount, or authenticated session.</p></section>
      <section class="manual-section manual-grid-2"><div><h3>5.2 Terminal state</h3><p>The fixed-cell model is the source of truth. Web and Resource Pack UIs render snapshots. A newly opened Web Terminal receives control immediately and demotes the previous writer; a viewer may reclaim control explicitly.</p></div><div><h3>5.3 World state</h3><p>Inputs and outputs are side-addressed. Digital and analog observations enter through bounded events; output state persists with the Computer record.</p></div></section>
      <section class="manual-section"><h3>5.4 Storage model</h3><p>The guest filesystem maps paths to inodes and content-addressed blobs. Immutable OS images are shared by all Computers; each machine persists only its copy-on-write files, metadata changes, hard links, and deletion tombstones. Utilities are executable files under <code>/usr/bin</code> or <code>C:\\COMMAND</code>: deleting one makes that command unavailable until its file is restored. Bedrock World Dynamic Properties remain canonical and retain the current and previous complete generations with checksum-backed, content-addressed pages.</p><p>HDD requests model controller setup, CHS seek, 3,600 RPM rotation, PIO transfer, and write settling. The shell waits for the exact completion event. A future 1.44 MiB floppy uses the same block-device boundary with media generation, 300 RPM, spin-up, write protection, and explicit ejection cancellation. No operator media-insertion command ships yet, so the FDD indicator remains <b>ABSENT</b> until a future adapter attaches media.</p><pre><code>df -h
du -sh /home/cs
quota
stat /startup.py</code></pre></section>
      <section class="manual-section"><h3>5.5 CS-Linux command surface</h3><table><thead><tr><th>Area</th><th>Commands</th></tr></thead><tbody><tr><td>Identity</td><td>whoami, id, groups, login, logout, passwd, su, sudo, getent</td></tr><tr><td>Accounts</td><td>useradd, userdel, usermod, groupadd, groupdel</td></tr><tr><td>Processes and jobs</td><td>ps, top, kill, jobs, fg, bg, wait</td></tr><tr><td>Sessions and services</td><td>tty, who, w, last, service</td></tr><tr><td>Manual and logs</td><td>man, apropos, dmesg</td></tr><tr><td>Files and metadata</td><td>ls, stat, chmod, chown, chgrp, ln, readlink, realpath, rmdir, umask</td></tr><tr><td>Text and inspection</td><td>tee, cmp, diff, file, sha256sum, od, hexdump, xargs</td></tr><tr><td>System</td><td>hostname, uname, date, uptime, free, df, du, mount, sync, mktemp, shutdown, reboot</td></tr><tr><td>Bash builtins</td><td>alias, unalias, command, read, local, shift, getopts</td></tr></tbody></table><p>Linux-facing commands use LF, Linux-style labels, and observable nonzero status for errors. <code>date --game</code> and <code>date --virtual</code> remain documented CS-Linux extensions. <code>yes</code>, <code>xargs</code>, dumps, hashes, and diffs stop at explicit sandbox limits.</p></section>
      <section class="manual-section"><h3>5.6 Dynamic proc files</h3><pre><code>cat /proc/cpuinfo
cat /proc/meminfo
cat /proc/version
cat /proc/uptime
cat /proc/loadavg
cat /proc/mounts
cat /proc/devices
cat /proc/services
cat /proc/self/status
cat /proc/1/cmdline</code></pre><p>These entries are read-only views generated from the Computer identity, hardware, clock, process, service, device, and mount model. Every live PID exposes bounded <code>cmdline</code>, <code>stat</code>, and <code>status</code> views. They are not host Linux files. Directory and hard-link indexes keep ordinary listings O(N); no command scans the host filesystem.</p></section>
      <section class="manual-section"><h3>5.7 Ownership, DAC, and umask</h3><p>Every guest-facing file operation uses one credentialed filesystem boundary. Owner, group, and other bits control reading, writing, execution, and directory traversal; effective UID/GID and supplementary groups determine the selected class. New entries inherit the caller's effective UID/GID after the active <code>umask</code>, initially <code>022</code>. Owners may make permitted mode and group changes; ownership transfer remains superuser work. The mode-1777 <code>/tmp</code> directory enforces sticky deletion, hard-link creation is protected, symbolic-link traversal is bounded, and setuid/setgid bits never grant hidden credentials.</p><p>These checks also apply to editors, compilers, Computer System Python imports and <code>fs</code> calls, startup programs, and MCP shell execution. Root may perform administrative filesystem work, but no guest path bypasses the account and DAC boundary to reach host files.</p></section>
      <section class="manual-section"><h3>5.8 Complete legacy account migration</h3><p>A recognized older installation with the default <code>computer</code> account is migrated once to <code>cs</code>. The user, primary group, supplementary memberships, and shadow key are renamed, and <code>/home/computer</code> moves to <code>/home/cs</code>. The old username and path are then absent: there is no alias and no compatibility symlink.</p><p>The conversion preserves the exact password payload, UID/GID 1000, file contents, modes, ownership, mtimes, symbolic-link targets, hard-link identities and shared contents, and deletion tombstones. Restarting is idempotent. If an unrelated <code>/home/cs</code> or incompatible account record makes the result ambiguous, migration fails explicitly instead of merging or discarding data.</p></section>
      <aside class="manual-callout"><b>Reserved legacy key</b><p>After migration, administrators still cannot create or rename a user or group to <code>computer</code>. Keeping that key permanently unavailable prevents a later account from being mistaken for an incomplete legacy migration.</p></aside>
      <aside class="manual-warning"><b>Independent ceilings</b><p>RAM, disk quota, per-file size, entry count, pipeline buffer, output size, and CPU cycles are separate limits. Free disk does not imply free VM RAM.</p></aside>`,
  },
  {
    id: "terminal-editor",
    html: `
      <header class="manual-page-header"><p class="manual-kicker">Chapter 03 · Operator console</p><h2>Terminal control and source editing</h2><p class="manual-lead">The terminal is a fixed-cell machine display. The Web Terminal keeps the guest grid at 80x25 and scales its glyphs with the browser viewport while preserving the same cells, cursor, colors, and input semantics.</p></header>
      <section class="manual-section"><h3>3.1 Web access and session states</h3><p>When the published numeric address belongs to the companion host, no custom public origin is configured, and automatic opening is not explicitly disabled, clicking an eligible Computer opens its one-use path through loopback in that host's default browser. This opens the server host's browser, not a remote player's browser; the four-digit entry page remains available to remote players. Operators may set <code>WEB_COMPANION_AUTO_OPEN=0</code> to disable opening or <code>1</code> to enable it explicitly while retaining listener-reachability checks.</p><p>A host administrator may persist a different listener port and advertised origin with <code>npm run web:config -- set --port 80 --url http://server-address</code>. Use <code>npm run web:config -- show</code> to inspect the active file and restart the companion after changing it. Environment variables remain one-start overrides. Plain HTTP is for a trusted LAN only; Internet publication requires an HTTPS reverse proxy.</p><table><thead><tr><th>State</th><th>What the operator can do</th><th>Terminal outcome</th></tr></thead><tbody><tr><td>Writer</td><td>Type, paste, submit, interrupt, and edit. A newly opened session takes control immediately.</td><td>Input is accepted at both transport boundaries.</td></tr><tr><td>Viewer</td><td>Select and copy. Use <b>Take control</b> to reclaim the single writer lease.</td><td>Viewer input is rejected explicitly.</td></tr><tr><td><code>out_of_range</code></td><td>Return within three blocks of a placed machine.</td><td>The live stream pauses without destroying the session.</td></tr><tr><td>Disconnected</td><td>Reconnect with the remembered four-digit number.</td><td>The bearer token rotates; persisted machine state remains.</td></tr><tr><td>Closed</td><td>No further input is accepted.</td><td>Only the final detached session emits <code>terminal_closed</code>.</td></tr></tbody></table></section>
      <section class="manual-section"><h3>3.2 Keyboard map</h3><table><thead><tr><th>Key</th><th>Shell action</th><th>vi action</th></tr></thead><tbody><tr><td>Enter</td><td>Submit command</td><td>Insert newline</td></tr><tr><td>Tab</td><td>Complete command or path</td><td>Insert indentation</td></tr><tr><td>↑ / ↓</td><td>Command history</td><td>Move cursor</td></tr><tr><td>Ctrl+C</td><td>Bounded interrupt</td><td>Interrupt current input</td></tr><tr><td>Ctrl+V</td><td>Paste clipboard text</td><td>Paste in insert mode</td></tr></tbody></table></section>
      <section class="manual-section manual-grid-2"><div><h3>3.3 Normal mode</h3><div class="manual-command-bank"><p><b>Move</b> h j k l, arrows, gg/G, PageUp/PageDown</p><p><b>Edit</b> i/I, a/A, o/O, x, dd</p><p><b>History</b> u</p><p><b>Save + quit</b> Shift+ZZ</p><p><b>Discard + quit</b> Shift+ZQ</p><p><b>Leave insert</b> Esc or Ctrl+[</p></div></div><div><h3>3.4 Command mode</h3><div class="manual-command-bank"><p><b>Save</b> :w</p><p><b>Name and save</b> :w path</p><p><b>Quit</b> :q</p><p><b>Save + quit</b> :wq, :wq!, or :x</p><p><b>Discard</b> :q!</p><p><b>Cancel empty :</b> Backspace</p></div><p>Bare <code>vi</code> opens <code>[No Name]</code>. It must be named with <code>:w path</code> before an unnamed save can succeed.</p></div></section>
      <section class="manual-section"><h3>3.5 DOS-style EDIT</h3><p>On the DOS profile, <code>EDIT [path]</code> opens a blue full-screen editor. Bare <code>EDIT</code> starts an <code>UNTITLED</code> buffer and F2 saves it as <code>C:\\NONAME.TXT</code>. Linux does not expose EDIT and uses <code>vi</code>. The top bar exposes File, Edit, Search, Options, and Help; the lower rows show the DOS path, modified state, line, column, and INS/OVR mode.</p><table><thead><tr><th>Key</th><th>Action</th></tr></thead><tbody><tr><td>F2 / Ctrl+S</td><td>Save and report success or failure</td></tr><tr><td>F10 / Alt+F</td><td>Open keyboard menus; arrows and Enter select</td></tr><tr><td>Ctrl+F / F3</td><td>Find text / find next with bounded forward search</td></tr><tr><td>Ctrl+Home / Ctrl+End</td><td>Move to the start or end of the document</td></tr><tr><td>Ctrl+Left / Ctrl+Right</td><td>Move by word</td></tr><tr><td>Ctrl+Y / Ctrl+Z</td><td>Delete the current line / undo</td></tr><tr><td>Insert</td><td>Toggle insert and overwrite modes</td></tr><tr><td>Alt+F, X</td><td>Exit; a dirty buffer requires Save, Discard, or Cancel</td></tr></tbody></table></section>
      <section class="manual-section"><h3>3.6 Editing procedure</h3><ol class="manual-procedure"><li>On DOS, use <code>EDIT C:\\WORK\\PROGRAM.C</code> for direct full-screen editing. On Linux, use <code>vi program.py</code>.</li><li>In EDIT, type directly and navigate with arrows, Home/End, or PageUp/PageDown. Save with F2.</li><li>In vi, press <code>i</code>, enter source, press Escape, type <code>:w</code>, and press Enter.</li><li>Run or compile from the shell. Reopen the file to correct reported lines.</li></ol></section>
      <section class="manual-section"><h3>3.7 Static GitHub Pages reference</h3><p>The project GitHub Pages site publishes this same canonical 16-chapter field manual as a static reference. Chapter and section links use stable URL fragments, search remains bounded to 24 section results, and the complete publication remains readable with JavaScript unavailable.</p><p>The Pages site is documentation only. It cannot connect to BDS, accept a four-digit Computer number, obtain a bearer token, display a live terminal, submit guest input, or prove that a Web Terminal session is available. To operate a Computer, start the local companion with <code>npm run dev:bds:web</code> and use the address activated from Minecraft. Never enter a Computer connection number or terminal credential into the Pages site.</p><aside class="manual-callout"><b>One publication, two presentations</b><p>The in-session Manual dialog and the static Pages manual are generated from <code>web/manual.js</code>. If their chapter order, section IDs, or wording differ, treat the repository source and its publication tests as authoritative and report the deployed site as stale.</p></aside></section>
      <aside class="manual-callout"><b>Top-bar controls</b><p>Copy is followed by the PWR, HDD, and FDD indicators and the Power button, then Manual. PWR follows lifecycle state; HDD and FDD reflect real block-device activity or absent media. Only the active writer can use Power. Drag across terminal text to select it; with no selection Copy copies the visible screen. A viewer can select and copy, but cannot submit input until it takes control.</p></aside>`,
  },
  {
    id: "redstone-peripherals",
    html: `
      <header class="manual-page-header"><p class="manual-kicker">Chapter 08 · World interface</p><h2>Connecting programs to Minecraft</h2><p class="manual-lead">World I/O crosses a narrow adapter boundary. A program observes snapshots and bounded events; it never calls Bedrock APIs directly.</p></header>
      <div class="manual-spec-line"><span>Sides</span><b>6</b><span>Digital</span><b>false / true</b><span>Analog input</span><b>0…15</b></div>
      <section class="manual-section"><h3>8.1 Display connections</h3><table><thead><tr><th>Machine</th><th>Web Terminal rule</th></tr></thead><tbody><tr><td>Desktop / Advanced Desktop</td><td>Requires exactly one adjacent Monitor. Selecting a bare Computer does not open a terminal.</td></tr><tr><td>Monitor</td><td>Resolves the physically adjacent Desktop Computer System. No connection and ambiguous multiple connections fail explicitly.</td></tr><tr><td>Portable Computer System</td><td>Its display is built in. Use it while held, or place and touch the open-laptop block; no external Monitor is required.</td></tr></tbody></table><p>Each Computer has a permanent four-digit connection number. Touching an eligible machine activates it once for two minutes; enter it at the stable LAN Web Terminal page. After connection, the browser stores the number locally and changes the bookmarkable URL to <code>/?computer=NNNN</code>; bearer tokens are never placed in that query. Invalid guesses are rate-limited and simultaneous number collisions fail explicitly. Placed-machine control requires the player to remain within three blocks. Leaving the radius or dimension pauses input as <code>out_of_range</code> without destroying the bounded session; returning resumes the existing tab, while a reloaded bookmark rotates the bearer token and reconnects automatically. Portable placement transfers the same persistent Computer identity from item to block. Breaking it returns an identity-carrying Portable Computer System item.</p></section>
      <section class="manual-section"><h3>8.2 Side names</h3><table><thead><tr><th>Name</th><th>Meaning</th><th>Use</th></tr></thead><tbody><tr><td>top / bottom</td><td>Vertical faces</td><td>Stacks and floor wiring</td></tr><tr><td>front / back</td><td>Relative to block orientation</td><td>Operator-facing machines</td></tr><tr><td>left / right</td><td>Relative lateral faces</td><td>Relay and control pairs</td></tr></tbody></table></section>
      <section class="manual-section"><h3>8.3 Six-face serial, SPI, and I2C</h3><table><thead><tr><th>Linux bus / DOS bus</th><th>Face</th><th>Linux devices</th><th>DOS devices</th></tr></thead><tbody><tr><td>0 / 1</td><td>bottom</td><td><code>ttyS0</code>, <code>spidev0.0</code>, <code>i2c-0</code></td><td><code>COM1</code>, <code>SPI1</code>, <code>I2C1</code></td></tr><tr><td>1 / 2</td><td>right</td><td><code>ttyS1</code>, <code>spidev1.0</code>, <code>i2c-1</code></td><td><code>COM2</code>, <code>SPI2</code>, <code>I2C2</code></td></tr><tr><td>2 / 3</td><td>front</td><td><code>ttyS2</code>, <code>spidev2.0</code>, <code>i2c-2</code></td><td><code>COM3</code>, <code>SPI3</code>, <code>I2C3</code></td></tr><tr><td>3 / 4</td><td>back</td><td><code>ttyS3</code>, <code>spidev3.0</code>, <code>i2c-3</code></td><td><code>COM4</code>, <code>SPI4</code>, <code>I2C4</code></td></tr><tr><td>4 / 5</td><td>top</td><td><code>ttyS4</code>, <code>spidev4.0</code>, <code>i2c-4</code></td><td><code>COM5</code>, <code>SPI5</code>, <code>I2C5</code></td></tr><tr><td>5 / 6</td><td>left</td><td><code>ttyS5</code>, <code>spidev5.0</code>, <code>i2c-5</code></td><td><code>COM6</code>, <code>SPI6</code>, <code>I2C6</code></td></tr></tbody></table><p>RS-232C is 9600 baud, 8N1, full duplex, and direct Computer-to-Computer. At 20 ticks per second each direction advances at most 48 bytes per tick. A full receive queue applies backpressure; disconnect and power changes clear stale bytes. SPI is mode 0 at 1 MHz with 8-bit MSB-first words and a 256-byte atomic limit. I2C is 100 kHz, 7-bit, and limits each combined write/read transaction to 256 bytes. SPI/I2C controller contracts are ready for future IoT blocks; an unattached target fails explicitly.</p><pre><code>printf hello &gt; /dev/ttyS0
cat /dev/ttyS0
spi 0 0 9f0000
i2c 0 scan
i2c 0 0x48 00 2</code></pre></section>
      <section class="manual-section"><h3>8.4 Polling and events</h3><pre><code>import os
import redstone

while True:
    os.pull_event("redstone")
    level = redstone.get_analog_input("left")
    redstone.set_output("right", level &gt;= 8)</code></pre><p>Use <code>pull_event</code> instead of a tight polling loop. It yields the VM until relevant work exists and avoids consuming the machine's cycle budget while idle.</p></section>
      <section class="manual-section"><h3>8.5 Output checklist</h3><ol class="manual-procedure"><li>Confirm orientation before assigning side names.</li><li>Read the existing input and decide a safe default output.</li><li>Handle startup before waiting for the first change event.</li><li>On failure, leave an explicit terminal state; do not spin-retry.</li></ol></section>
      <aside class="manual-warning"><b>Capability-dependent interfaces</b><p>Computer, Portable Computer System, Monitor, Speaker, and other block behavior is exposed only when the relevant adapter exists. Missing capability calls fail explicitly rather than impersonating unavailable hardware.</p></aside>`,
  },
  {
    id: "dos-profile",
    html: `
      <header class="manual-page-header"><p class="manual-kicker">Chapter 14 · Computer System DOS 6.2</p><h2>Operating CS-DOS 6.2 on the CS386SX portable</h2><p class="manual-lead">Computer System DOS 6.2 (CS-DOS 6.2) is the portable profile for a CS386SX 16 MHz machine with 2 MiB RAM. It supports ASM, C, C++, BASIC, and bounded batch files. User MicroPython is unavailable. Storage, identity, execution limits, and the host security boundary remain shared with the CS-Linux desktop.</p></header>
      <figure class="manual-figure manual-figure--portable"><img src="/assets/manual/portable-computer-system.png" width="1029" height="1528" alt="Portable 386SX 16 MHz Computer System with 2 MB RAM showing a DOS prompt, VGA LCD, keyboard, trackball, floppy drive, rear ports, and battery pack" loading="lazy" decoding="async"><figcaption><b>Portable Computer System.</b> The CS386SX profile runs at 16 MHz with 2 MiB RAM, a 24-bit address bus, a 16-bit data bus, 256 KiB VRAM, and 800,000 cycles/tick. Its 800x480 physical VGA LCD centers guest modes up to 640x480; its narrower bus and 80386-derived timing are active execution constraints rather than display-only labels.</figcaption></figure>
      <section class="manual-section"><h3>14.1 Boot sequence</h3><ol class="manual-procedure"><li><b>Mount C:.</b> Restore the persisted, quota-limited guest filesystem and reset <code>C:\\TEMP</code>.</li><li><b>Read CONFIG.SYS.</b> Process at most 64 lines; every unsupported or invalid directive is reported. HIMEM/EMM386 changes memory state only when the referenced installed file contains the expected versioned CS-DOS driver capsule.</li><li><b>Run AUTOEXEC.BAT.</b> Execute it through the same bounded batch engine used for operator scripts.</li><li><b>Present the prompt.</b> Start at <code>C:\\&gt;</code>; <code>PROMPT</code>, current drive, environment, and <code>PATH</code> are now active.</li></ol><pre><code>DEVICE=C:\\DOS\\HIMEM.SYS
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
ECHO STATUS=%ERRORLEVEL%</code></pre><p>A command without a path is resolved in the current directory and then <code>PATH</code>; the <code>.BAT</code> suffix may be omitted. CRLF and LF are accepted. Batch substitution supports <code>%VAR%</code>, <code>%0</code> through <code>%9</code>, and <code>%ERRORLEVEL%</code>. Labels, <code>GOTO</code>/<code>GOTO :EOF</code>, internal and external <code>CALL</code>, <code>SHIFT</code>, <code>IF [NOT] ERRORLEVEL</code>, <code>IF [NOT] EXIST</code>, and <code>COMMAND /C</code> or <code>/K</code> use the dedicated bounded BAT engine. Unquoted Unix-style <code>&amp;&amp;</code> and <code>||</code> chains are rejected inside BAT control flow. Pipes and redirections remain documented safe-shell extensions, not claims of native COMMAND.COM semantics.</p><table><thead><tr><th>Bound</th><th>Limit</th><th>Failure</th></tr></thead><tbody><tr><td>Batch lines / labels</td><td>256 / 256</td><td>Explicit line or label status</td></tr><tr><td>Call depth / positional arguments</td><td>8 / 9</td><td>Explicit depth or argument status</td></tr><tr><td>Jumps / executed steps</td><td>1,024 / 4,096</td><td>Explicit control-flow status</td></tr><tr><td>Loaded programs</td><td>64</td><td>Explicit program-load status</td></tr><tr><td>Expanded command / output</td><td>4,096 / 256,000 characters</td><td>Explicit bounded-output status</td></tr></tbody></table><p><code>CHOICE</code> and native COMMAND.COM binary behavior are not implemented. Missing or duplicate labels, recursion, and exhausted bounds terminate explicitly without invoking a host or native DOS process.</p></section>
      <section class="manual-section"><h3>14.6 Command correspondence</h3><table><thead><tr><th>Task</th><th>Linux</th><th>DOS</th></tr></thead><tbody><tr><td>List / read</td><td>ls / cat</td><td>DIR / TYPE</td></tr><tr><td>Directory tree / volume</td><td>find / df</td><td>TREE / VOL / LABEL / CHKDSK</td></tr><tr><td>Attributes / metadata</td><td>chmod / stat</td><td>ATTRIB / DIR /A</td></tr><tr><td>Edit full screen</td><td>vi</td><td>EDIT / VI</td></tr><tr><td>Create / remove directory</td><td>mkdir / rm</td><td>MD / RD (CHDIR and RMDIR aliases)</td></tr><tr><td>Copy / move / rename</td><td>cp / mv</td><td>COPY / MOVE / REN or RENAME</td></tr><tr><td>Remove file</td><td>rm</td><td>DEL or ERASE</td></tr><tr><td>Clock / measurement</td><td>date / time</td><td>TIME / TIMER</td></tr><tr><td>History</td><td>history</td><td>DOSKEY /HISTORY</td></tr><tr><td>Clear / version</td><td>clear / uname</td><td>CLS / VER</td></tr><tr><td>Hardware</td><td>cpuinfo / free</td><td>CPU / MEM, MEM /F</td></tr><tr><td>System summary</td><td>uname -a</td><td>SYSTEMINFO</td></tr></tbody></table><p>DOS-facing commands and errors use CRLF and DOS-specific wording. Commands and paths are case-insensitive, but every directory and file name follows strict 8.3 form: a 1–8 character base plus an optional 1–3 character extension. Invalid long names fail explicitly and are never silently truncated. Backslash is preserved as the displayed separator. <code>DIR /B</code> produces a bare listing; <code>DIR /A[:attributes]</code> filters persisted FAT metadata; <code>TREE [/F] [/A]</code> is an O(N) traversal capped at 512 entries and 32 levels. <code>CHKDSK</code> never changes guest file contents, labels, or attributes and never repairs a volume, but it may materialize missing versioned FAT metadata while reconciling a legacy entry. <code>C:\\TEMP</code> is volatile across boot. <code>NUL</code> and <code>CON</code> are bounded compatibility sink devices; CON is not a raw host console.</p></section>
      <section class="manual-section"><h3>14.7 Drives, wildcards, FAT metadata, and floppy limits</h3><p>The DOS runtime owns exactly A: and C:. C: contains the persistent system volume. Each drive keeps its own current directory, so selecting another drive and returning restores the prior directory. Production A: reports <code>Not ready</code> until a future Bedrock media adapter inserts a Floppy Disk; cold restore always returns to C: and detaches transient A: media.</p><pre><code>CD C:\\WORK
DIR *.TXT
COPY *.TXT C:\\BACKUP
REN *.BAK *.OLD
ATTRIB +R +H SECRET.TXT
DIR /A:H
LABEL C: PROJECT
CHKDSK C:</code></pre><p>The shipped DOS <code>*</code> and <code>?</code> traversal examines at most 512 entries, returns at most 512 matches, and stops recursion at 32 levels. It is valid for bounded discovery but never as a new 8.3 filename. Every file retains a two-second FAT modification time and R/H/S/A metadata. Read-only state is enforced by write, delete, rename, copy, and editor paths. <code>ATTRIB /S</code> is bounded; <code>LABEL</code> is generation-bound; <code>CHKDSK</code> reports actual file, directory, byte, free-space, label, and metadata state without changing file contents, labels, or attributes. It may materialize missing versioned FAT metadata for a legacy entry, but performs no repair.</p><p>The current CS-DOS image is v3. Older v1/v2 image definitions remain registered so existing overlays migrate without duplicating the immutable base. The cold DOS snapshot preserves C:, labels, attributes, and timestamps, but never resurrects stale A: media or its generation metadata.</p></section>
      <section class="manual-section"><h3>14.8 Local bus commands</h3><pre><code>ECHO HELLO&gt;COM1
TYPE COM1
SPI 1 0 9F0000
I2C 1 SCAN
I2C 1 72 00 2</code></pre><p><code>COM1</code> through <code>COM6</code> are the six machine-relative RS-232C ports and work with redirection and <code>TYPE</code>. <code>SPI</code> accepts a one-based bus, chip select, and hexadecimal byte pairs. <code>I2C</code> accepts a one-based bus plus <code>SCAN</code>, or an address, write bytes (use <code>-</code> for none), and read length. These commands are valid in bounded batch files. A missing neighbor, unattached peripheral, NACK, address conflict, full queue, or powered-off endpoint returns a nonzero explicit status.</p></section>
      <section class="manual-section"><h3>14.9 Portable toolchains</h3><pre><code>REM Direct assembly executable
ASM ANSWER.ASM /OUT:ANSWER
RUN ANSWER /STATS

REM Relocatable assembly and explicit entry point
ASM /C ANSWER.ASM /OUT:ANSWER.O
LINK ANSWER.O /OUT:ANSWER /ENTRY:START

CC TOTAL.C -O TOTAL
C++ ANSWER.CPP -O ANSCPP
BASIC DEMO.BAS
BASICC DEMO.BAS -O DEMO</code></pre><p><code>AS</code>/<code>LD</code> remain available, while <code>ASM</code>/<code>LINK</code> provide DOS-friendly aliases. The assembler accepts CRLF source, relative <code>INCLUDE</code>, <code>PUBLIC</code>/<code>EXTRN</code>, <code>.CODE</code>/<code>.CONST</code>, and bounded <code>name MACRO</code> ... <code>ENDM</code> forms. It deliberately rejects <code>ORG</code>, <code>INT</code>, segment models, and other constructs that would imply native OMF, COM, EXE, BIOS, or DOS-interrupt execution.</p><p>ASM, the supported C subset, the supported C++ subset (including restricted inline assembly), and BASIC all produce or execute the common checked instruction format. The linker applies the same typed-symbol, structured-relocation, section-size, object-count, and RAM bounds as CS-Linux. Each run uses CS386SX timings, its 16-bit external bus, and the 2 MiB limit. MicroPython commands and <code>/startup.py</code> are unavailable on Portable; MCP returns status 127 instead of silently using a different VM.</p></section>
      <section class="manual-section"><h3>14.10 Instruction debugger</h3><pre><code>DEBUG ANSWER
BP MAIN
G
R
U MAIN 8
D 0 16
T
G 1000
Q</code></pre><p><code>DEBUG</code> is the CS-DOS command spelling for the same bounded CS486 instruction debugger exposed as <code>csdb</code> on CS-Linux. It loads only validated CS486 executables, treats unprefixed DOS addresses as hexadecimal, and uses CRLF output. <code>BP</code>/<code>BC</code> manage breakpoints, <code>T</code> steps one instruction, <code>G</code> continues with an optional bounded instruction count, <code>R</code> reads registers, <code>U</code> disassembles, and <code>D</code> reads memory without modifying it.</p><p>This command is not native DOS DEBUG emulation. It cannot write memory, run COM/EXE files, reconstruct C/C++ source variables, or invoke BIOS/DOS interrupts, PIC, IRQ, or IDT behavior.</p></section>
      <section class="manual-section"><h3>14.11 C++ exercise</h3><pre><code>REM ANSWER.CPP
int main() {
  int answer = 6 * 7;
  std::cout &lt;&lt; answer &lt;&lt; std::endl;
  return 0;
}

C++ ANSWER.CPP -O ANSWER
RUN --STATS ANSWER</code></pre><p>Record output, instructions, and cycles. On the 16-bit external bus, memory traffic and output can dominate. Reduce the algorithmic term first, then repeated loads, taken branches, division, and PRINT traffic.</p></section>
      <section class="manual-section"><h3>14.12 Linux memory comparison</h3><table><thead><tr><th>Portable DOS</th><th>Desktop Linux</th></tr></thead><tbody><tr><td>640 KiB conventional + UMB/reserved + XMS</td><td>32-bit protected flat sandbox</td></tr><tr><td>Inspect with CPU, MEM, MEM /C, MEM /D</td><td>Inspect with cpuinfo, free, /proc/cpuinfo, /proc/meminfo</td></tr><tr><td>DOS system/drivers and guest runtime are separate</td><td>Kernel, services, buffers, and guest runtime are separate</td></tr><tr><td>HIMEM/EMM386 and DOS HIGH are modeled</td><td>Resident OS overhead plus dynamic used/free/available are reported</td></tr><tr><td>No paging or native interrupt execution</td><td>Bounded process table; no paging, swap, or MMU page emulation</td></tr></tbody></table></section>
      <aside class="manual-callout"><b>DOS update boundary</b><p>Single-path writes, <code>MD</code>/<code>RD</code>, wildcard <code>COPY</code>/<code>REN</code>/<code>DEL</code>, <code>MOVE</code>, and <code>ATTRIB</code> trial their complete FAT aggregate before one combined filesystem-and-FAT undo transaction. A multi-entry wildcard <code>COPY</code> reuses the outer snapshot for every nested write, and every operand of <code>MD C:\\FIRST C:\\SECOND</code> commits or rolls back together. Capacity rejection and injected post-mutation write, delete, rename, move, attribute, directory, FAT, and persistence-observer failures restore the exact filesystem/FAT snapshots, inode and hard-link identities, revisions, free space, and blob metrics. Observer failure also restores and republishes the prior drive, per-drive current directory, prompt, label, and lazily synthesized FAT state. Transaction callbacks are synchronous: declared async callbacks never run, and a disguised Promise or thenable rolls back its pre-<code>await</code> work and cannot mutate that state after <code>await</code> while it settles. The shared quarantine also blocks a second filesystem instance, another DOS aggregate, and cross-subsystem mutation until settlement.</p></aside>
      <aside class="manual-callout"><b>Portable profile</b><p>A newly created Portable Computer System selects CS-DOS plus CS386SX automatically. Customized OS, CPU, clock, or RAM settings remain attached to its Computer identity.</p></aside>`,
  },
  {
    id: "worked-project",
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
      <section class="manual-section"><h3>9.4 Verify boundary and failure cases</h3><table><thead><tr><th>Case</th><th>Verify</th><th>Expect</th></tr></thead><tbody><tr><td>Below threshold</td><td><b>Verify:</b> Apply analog levels 0 and 7 to the left face.</td><td><b>Expect:</b> The right output stays off and the terminal reports each level.</td></tr><tr><td>At and above threshold</td><td><b>Verify:</b> Apply analog levels 8 and 15.</td><td><b>Expect:</b> The right output turns on exactly at level 8.</td></tr><tr><td>Startup</td><td><b>Verify:</b> Reboot once with a stable input.</td><td><b>Expect:</b> The output reflects the input before the first event wait.</td></tr><tr><td>Connection loss</td><td><b>Verify:</b> Disconnect, reconnect, and inspect the same Computer identity.</td><td><b>Expect:</b> Source and output state persist; reconnect work remains bounded.</td></tr></tbody></table></section>
      <section class="manual-section"><h3>9.5 Measure and inspect</h3><pre><code>cpuinfo
free -h
quota</code></pre><p><b>Verify:</b> Record processor identity and clock, command status, live memory, and disk use before and after one controlled input sequence.</p><p><b>Expect:</b> Output remains correct, idle event waiting does not create a polling storm, and resource use remains within the independent ceilings.</p></section>
      <section class="manual-section"><h3>9.6 Deploy and roll back</h3><ol class="manual-procedure"><li>Copy the last known-good source before replacing <code>/startup.py</code>.</li><li>Reboot once and repeat the four boundary inputs.</li><li>If startup faults, stop retrying. Preserve the broken file and world. Open the crashed Computer normally for the recovery instruction, then sneak while opening it; or use the safe-boot power control in an already attached Web Terminal. Restore the known-good source from that one boot.</li></ol><p>Safe boot exists only for the <code>crashed</code> lifecycle and preserves the exact <code>/startup.py</code>. It is not a guest-shell or MCP command.</p><p><b>Verify:</b> Confirm the file is unchanged before repair, inspect the boot journal, then power-cycle, reconnect, and repeat levels 7 and 8.</p><p><b>Expect:</b> Recovery bypasses the broken file once without resetting it. After an explicit repair, the persisted program starts once, waits for events, and switches only at the documented boundary.</p></section>
      <aside class="manual-warning"><b>Acceptance rule</b><p>A controller is not complete because it compiled. It is complete when boundary values, startup state, event waiting, persisted source, and reconnect behavior have observable results.</p></aside>`,
  },
  {
    id: "api-reference",
    html: `
      <header class="manual-page-header"><p class="manual-kicker">Chapter 07 · Native API</p><h2>Runtime function reference</h2><p class="manual-lead">Snake-case names are canonical below. Selected camelCase aliases exist for ComputerCraft familiarity; portable programs should prefer one naming convention consistently.</p></header>
      <section class="manual-section"><h3>7.1 os</h3><table><thead><tr><th>Function</th><th>Result / effect</th></tr></thead><tbody><tr><td>get_computer_id()</td><td>Stable numeric Computer identity</td></tr><tr><td>clock()</td><td>Elapsed tick time in seconds</td></tr><tr><td>sleep(seconds)</td><td>Yield for a bounded tick duration</td></tr><tr><td>pull_event([filter])</td><td>Yield until the next matching event</td></tr><tr><td>queue_event(name, ...args)</td><td>Append a bounded local event</td></tr><tr><td>start_timer(seconds)</td><td>Return timer id</td></tr><tr><td>cancel_timer(id)</td><td>Return whether cancellation succeeded</td></tr><tr><td>shutdown() / reboot()</td><td>Request explicit lifecycle transition</td></tr></tbody></table></section>
      <section class="manual-section"><h3>7.2 term</h3><div class="manual-command-bank"><p><b>Writing</b> write(text), clear(), clear_line(), scroll(lines)</p><p><b>Cursor</b> set_cursor_pos(x, y), get_cursor_pos(), set_cursor_blink(bool)</p><p><b>Geometry</b> get_size()</p><p><b>Color</b> set_text_color(mask), get_text_color(), set_background_color(mask), get_background_color(), is_color()</p></div></section>
      <section class="manual-section"><h3>7.3 fs and redstone</h3><table><thead><tr><th>Module</th><th>Functions</th></tr></thead><tbody><tr><td>fs</td><td>exists, is_dir, list, make_dir, read_file, write_file, append_file, delete, copy, move, get_size, get_free_space</td></tr><tr><td>redstone</td><td>get_input(side), get_analog_input(side), get_output(side), set_output(side, bool)</td></tr></tbody></table></section>
      <section class="manual-section"><h3>7.4 serial, spi, and i2c</h3><table><thead><tr><th>Module</th><th>Functions</th><th>Bus numbering</th></tr></thead><tbody><tr><td>serial</td><td>read(port [, maximum]), write(port, text), status(port)</td><td>0..5</td></tr><tr><td>spi</td><td>transfer(bus, chip_select, byte_list)</td><td>0..5</td></tr><tr><td>i2c</td><td>scan(bus), transfer(bus, address, write_bytes, read_length)</td><td>0..5</td></tr></tbody></table><p>These modules are available to desktop Computer System Python. The portable CS386SX DOS profile uses the batch-capable <code>SPI</code>/<code>I2C</code> commands and COM devices because user Python is unavailable.</p></section>
      <aside class="manual-callout"><b>Coordinate and color rules</b><p>Terminal coordinates are one-based. Color arguments use a single power-of-two mask; getters return that mask. Invalid arity, side, coordinate, color, path, or unavailable capability raises a guest-visible error.</p></aside>`,
  },
  {
    id: "optimization",
    html: `
      <header class="manual-page-header"><p class="manual-kicker">Chapter 13 · Performance engineering</p><h2>Optimization is part of the machine</h2><p class="manual-lead">Use deterministic guest metrics. Host timing is affected by Minecraft ticks, other Computers, and the global scheduler cap.</p></header>
      <section class="manual-section"><h3>13.1 The loop</h3><ol class="manual-procedure"><li><b>Establish correctness.</b> Save expected output.</li><li><b>Measure.</b> Record instructions and cycles with <code>run --stats</code>.</li><li><b>Find the dominant term.</b> Count loop iterations and expensive opcodes.</li><li><b>Change one idea.</b> Algorithm, invariant motion, strength reduction, or memory layout.</li><li><b>Compare.</b> Require equal output and lower cost.</li></ol></section>
      <section class="manual-section"><h3>13.2 Archived pre-CSIR strength-reduction benchmark</h3><p>These are historical live BDS measurements captured through the Computer System MCP on 2026-07-15, before the dedicated C/C++ tokenizer, typed AST, CSIR optimizer, and register allocator shipped. The C and C++ rows are retained as pre-CSIR provenance and must not be used as current compiler measurements; rerun every hardware profile before publishing a current comparison. All sources compute <code>sum(i*i + 3*i + 7)</code> for <code>i = 1..1500</code>. The baseline performs two multiplications per iteration; the optimized source advances the term with first differences. Every supported run started cold and printed the same checksum, <code>1129513000</code>. Compile time, Web transport, browser rendering, Minecraft wall time, and MCP overhead are excluded. Each cell is <b>instructions · modeled CPU cycles · virtual microseconds</b>; the final column is cycle reduction.</p>
      <h4>Advanced Desktop · 9367 · CS486DX2 66 MHz · <code>c-hvq8k7</code></h4><table><thead><tr><th>Frontend</th><th>Baseline</th><th>Strength-reduced</th><th>Reduction</th></tr></thead><tbody><tr><td>ASM</td><td>15,004 · 42,106 · 637.970 µs</td><td>9,006 · 12,084 · 183.091 µs</td><td>71.3%</td></tr><tr><td>BASIC</td><td>66,019 · 279,527 · 4,235.258 µs</td><td>54,027 · 218,089 · 3,304.379 µs</td><td>22.0%</td></tr><tr><td>C</td><td colspan="2">Not re-measured after the CSIR backend; authoritative guest MCP rerun pending.</td><td>—</td></tr><tr><td>C++</td><td colspan="2">Not re-measured after the CSIR backend; authoritative guest MCP rerun pending.</td><td>—</td></tr><tr><td>Computer System Python</td><td>52,532 · 638,275 · 9,670.833 µs</td><td>46,540 · 551,399 · 8,354.530 µs</td><td>13.6%</td></tr></tbody></table>
      <h4>Desktop · 1272 · CS486DX 33 MHz · <code>c-s33g1r</code></h4><table><thead><tr><th>Frontend</th><th>Baseline</th><th>Strength-reduced</th><th>Reduction</th></tr></thead><tbody><tr><td>ASM</td><td>15,004 · 42,058 · 1,274.485 µs</td><td>9,006 · 12,048 · 365.091 µs</td><td>71.4%</td></tr><tr><td>BASIC</td><td>66,019 · 211,787 · 6,417.788 µs</td><td>54,027 · 159,325 · 4,828.030 µs</td><td>24.8%</td></tr><tr><td>C</td><td colspan="2">Not re-measured after the CSIR backend; authoritative guest MCP rerun pending.</td><td>—</td></tr><tr><td>C++</td><td colspan="2">Not re-measured after the CSIR backend; authoritative guest MCP rerun pending.</td><td>—</td></tr><tr><td>Computer System Python</td><td>52,532 · 638,083 · 19,335.848 µs</td><td>46,540 · 551,195 · 16,702.879 µs</td><td>13.6%</td></tr></tbody></table>
      <h4>Portable · 2985 · CS386SX 16 MHz · <code>c-cqvhcs</code></h4><table><thead><tr><th>Frontend</th><th>Baseline</th><th>Strength-reduced</th><th>Reduction</th></tr></thead><tbody><tr><td>ASM</td><td>15,004 · 68,478 · 4,279.875 µs</td><td>9,006 · 25,522 · 1,595.125 µs</td><td>62.7%</td></tr><tr><td>BASIC</td><td>66,019 · 339,520 · 21,220.000 µs</td><td>54,027 · 250,632 · 15,664.500 µs</td><td>26.2%</td></tr><tr><td>C</td><td colspan="2">Not re-measured after the CSIR backend; authoritative guest MCP rerun pending.</td><td>—</td></tr><tr><td>C++</td><td colspan="2">Not re-measured after the CSIR backend; authoritative guest MCP rerun pending.</td><td>—</td></tr><tr><td>Computer System Python</td><td colspan="2">Unavailable: both MCP commands returned status 127 and <code>Bad command or file name</code>.</td><td>—</td></tr></tbody></table>
      <p>The archived ordering is a property of this workload and the frontends captured on that date, not a general language ranking or a claim about the current CSIR backend. The captured C and C++ frontends emitted the same instruction stream. CS486DX2 does not simply halve every cycle count: its external L2 participates in cold misses, while its 66 MHz clock still lowers virtual time. CS386SX has no cache and charges its 16-bit external bus, so the same executable has a different cycle total.</p><aside class="manual-warning"><b>Measurement boundary</b><p>Use <code>run --stats</code> for compiled executables and the bounded MCP Python debug form for Python. Compare modeled CPU cycles or derived virtual time, never host JavaScript time or browser latency. The historical raw result set and exact sources are retained under <code>docs/benchmarks/strength-reduction/</code>; replace the table only after a complete cold remeasurement of all listed profiles.</p></aside></section>
      <section class="manual-section"><h3>13.3 Cost priorities</h3><table><thead><tr><th>Priority</th><th>Question</th><th>Typical action</th></tr></thead><tbody><tr><td>O(N)</td><td>Does work scale with input or nested iteration?</td><td>Change the algorithm first</td></tr><tr><td>Serial fraction</td><td>What remains under global scheduling?</td><td>Remove repeated setup and output</td></tr><tr><td>Opcode cost</td><td>Are DIV/MOD, taken branches, dword bus transfers, or PRINT dominant?</td><td>Strength-reduce, improve locality, or batch</td></tr><tr><td>Memory pressure</td><td>Are live objects forcing O(N) scans?</td><td>Release references and reuse buffers</td></tr></tbody></table><p>Compare optimizations on the same processor profile: CS386SX and CS486DX intentionally assign different costs to the same instruction stream.</p></section>
      <section class="manual-section"><h3>13.4 Alignment and cache locality</h3><p>Align C/C++ data and ASM buffers to four-byte boundaries. On CS386SX, any even dword address uses two 16-bit bus transfers, while an odd address uses three. Four-byte ABI alignment remains the portable convention. On CS486, keep hot code and data in nearby 16-byte cache lines. Reusing a line produces L1 hits; scattered or conflicting addresses cause bounded line fills. The Advanced external L2 can satisfy a line evicted from L1. Stores are write-through, so reducing unnecessary writes still matters.</p><pre><code>RUN --STATS LOCAL
RUN --STATS SCATTER</code></pre><p>The second statistics line reports L1 and L2 hits/misses, bus transfers, unaligned dwords, and pipeline flushes. Every run starts cold, so comparisons are reproducible and do not inherit another program's cache.</p></section>
      <section class="manual-section"><h3>13.5 Branches and pipelines</h3><p>Neither CS386SX nor CS486 implements dynamic branch prediction. CS386SX models prefetch overlap and charges taken branches more than fall-through. CS486 models a five-stage refill: a not-taken conditional branch costs one base cycle, while a taken conditional branch costs three and records a pipeline flush. JMP, CALL, RET, and runtime control transfers also flush. Prefer branch removal only after the algorithm and memory-access pattern are correct.</p></section>
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
    html: `
      <header class="manual-page-header"><p class="manual-kicker">Chapter 15 · Service information</p><h2>Faults are explicit terminal outcomes</h2><p class="manual-lead">Every stateful path assigns a final owner. Crashes, cancellation, disconnect, retry exhaustion, shutdown, reboot, and bounded yields remain observable.</p></header>
      <section class="manual-section"><h3>15.1 Start from the observed symptom</h3><table><thead><tr><th>Symptom</th><th>Check</th><th>Recovery owner</th></tr></thead><tbody><tr><td>Web Terminal cannot accept input</td><td>Check writer/viewer, <code>out_of_range</code>, connection number activation, and the exactly-one-Monitor rule.</td><td>Take control, return to range, or reconnect once after correcting the physical connection.</td></tr><tr><td>CS-Linux stops before the prompt</td><td>Check first-boot <code>cs</code> password setup, later username/password login, locked-account state, and startup/journal failure.</td><td>Complete authentication. For a broken <code>/startup.py</code>, stop retries. When lifecycle is <code>crashed</code>, sneak while opening the Computer or use the attached Web Terminal's safe-boot power control. Repair from that one boot; the broken file is preserved until you edit it.</td></tr><tr><td>Program is not found or does not start</td><td>Check OS profile, path, filename rules, executable/object format, execute permission, and status 127.</td><td>Use an explicit permitted guest path or the toolchain for the active profile.</td></tr><tr><td>Permission denied</td><td>Check <code>id</code>, <code>groups</code>, owner/group/other mode bits, ancestor traversal, and the active <code>umask</code>.</td><td>Correct ownership or mode through a permitted account; do not bypass the credentialed filesystem.</td></tr><tr><td>Program is slow</td><td>Check hidden polling, repeated output, <code>run --stats</code>, cache/bus counters, and the dominant O(N) term.</td><td>Bound or deduplicate repeated work before changing machine limits.</td></tr></tbody></table></section>
      <section class="manual-section"><h3>15.2 CS486 faults</h3><table><thead><tr><th>Fault</th><th>Cause</th><th>Correction</th></tr></thead><tbody><tr><td>ExecutableFormatError</td><td>Bad header, opcode, operand, register, section, symbol, relocation, or target</td><td>Reassemble; inspect the source artifact</td></tr><tr><td>MemoryAccessError</td><td>32-bit access outside configured RAM</td><td>Correct address and allocation math</td></tr><tr><td>DivisionByZeroError</td><td>DIV or MOD divisor is zero</td><td>Guard the divisor</td></tr><tr><td>StackOverflowError</td><td>PUSH/CALL crosses the aligned static-data floor</td><td>Reduce nesting, stack use, or linked static data</td></tr><tr><td>StackUnderflowError</td><td>POP/RET starts above the last addressable stack word</td><td>Keep ESP at or below the top-of-RAM boundary</td></tr><tr><td>OutputLimitError</td><td>Program exceeds bounded output</td><td>Summarize or batch output</td></tr></tbody></table><p>ESP remains a general register: moving it to an in-range address can make POP read that RAM word, even when no PUSH produced it. The runtime guarantees RAM and static-data boundaries, not stack-word provenance. RET additionally validates the popped instruction target. An instruction pointer below zero or beyond the executable range faults; only the exact instruction immediately after the program is a normal fall-through completion.</p></section>
      <section class="manual-section"><h3>15.3 Shell statuses</h3><table><thead><tr><th>Status</th><th>Meaning</th></tr></thead><tbody><tr><td>0</td><td>Successful completion</td></tr><tr><td>1</td><td>Ordinary command failure / false result</td></tr><tr><td>2</td><td>Usage or explicitly unsupported option</td></tr><tr><td>124</td><td>CS486 instruction bound reached; yielded</td></tr><tr><td>127</td><td>Command not found for the active OS profile</td></tr></tbody></table></section>
      <section class="manual-section"><h3>15.4 Instruction debugger and diagnostic sequence</h3><div class="manual-grid-2"><div><h4>CS-Linux debugger</h4><pre><code>csdb program
break main
continue
regs
disasm main 8
memory 0 16
step
continue 1000
quit</code></pre></div><div><h4>General inspection</h4><pre><code>cpuinfo
free -h
quota
nm program
objdump program
run --stats program
echo $?</code></pre></div></div><p><code>csdb</code> pauses only at CS486 instruction boundaries. It can set and clear address or symbol breakpoints, step, continue, read registers, show validated disassembly, and read memory without modifying it. A request is capped at 256 breakpoints, 100,000 continued instructions, 256 disassembled instructions, or 4,096 memory bytes. Hitting a breakpoint, halting, faulting, exhausting the requested limit, interruption, and quit are distinct terminal outcomes; logout, user switch, and terminal disconnect discard the debugger state.</p><aside class="manual-warning"><b>Debugger boundary</b><p>This is a bounded instruction debugger, not native GDB or native DOS DEBUG. It has no source-level stepping, C/C++ local-variable reconstruction, writable memory, dynamic linker, PIC/IRQ/IDT execution, or native interrupt path.</p></aside></section>
      <section class="manual-section"><h3>15.5 OS presence diagnostic sequence</h3><ol class="manual-procedure"><li>Run <code>ps -f</code>, <code>jobs</code>, <code>who</code>, and <code>service --status-all</code>.</li><li>Read <code>/proc/loadavg</code>, the relevant PID's <code>status</code>, and <code>/proc/mounts</code>.</li><li>Compare <code>dmesg</code>, <code>/var/log/messages</code>, and <code>/var/log/auth.log</code> under permitted credentials.</li><li>Run <code>sync</code> before a requested stop when preserving an explicit checkpoint matters.</li><li>After reboot, use <code>last</code> and the retained journal to confirm the prior terminal transition.</li></ol><p><b>Expect:</b> Process, job, session, service, proc, and log views agree because they render one bounded per-Computer state. A failed sync or shutdown phase faults explicitly. Host BDS logs remain outside these guest files.</p></section>
      <section class="manual-section"><h3>15.6 CS-DOS recovery checklist</h3><ol class="manual-procedure"><li>Run <code>VER</code>, <code>CPU</code>, <code>MEM /D</code>, and read-only <code>CHKDSK C:</code>.</li><li>Inspect <code>TYPE C:\\CONFIG.SYS</code> and <code>TYPE C:\\AUTOEXEC.BAT</code>.</li><li>Use <code>SET</code>, <code>PATH</code>, <code>PROMPT</code>, <code>VOL</code>, and <code>ATTRIB</code> to confirm boot and FAT state.</li><li>Use an explicit path if a BAT or compiled program is not found.</li><li>Correct every boot warning; unsupported directives are never silently accepted.</li></ol><p><b>Verify:</b> Reboot once after the correction and inspect every boot line, label, attribute, and timestamp.</p><p><b>Expect:</b> Startup reaches <code>C:\\&gt;</code> or stops at one explicit, actionable failure. CHKDSK reports but never repairs, and A: remains not ready without inserted media.</p></section>
      <section class="manual-section"><h3>15.7 Storage migration after an update</h3><p>An older world may pause Computer interactions while BDS converts indexed Dynamic Property pages and inline filesystem files. Progress is reported as <code>CS_STORAGE_MIGRATION</code>. Each Computer is written and verified before a legacy identity registry is switched, so an interruption keeps the older complete generation readable and the next start safely resumes by rescanning and skipping completed Computers. The same scan runs when the identity pages are already current: changed Computer payloads are saved and reload-verified, while a healthy current identity head remains unchanged. If a current-format Computer or identity head is invalid but its previous generation validates, that recovered value repairs the head and must reload without fallback before migration completes. A valid head is also retained when its previous manifest is corrupt. Recovery repairs or removes that invalid fallback metadata and incrementally removes target-only content blobs, legacy indexed pages, and stray manifests that corrupt metadata can no longer name. This whole-prefix search runs only during repair; ordinary saves never enumerate every stored page. Page-count or manifest-length overflow is rejected before a generation changes storage.</p><p>When the recognized legacy CS-Linux default account is present, boot also completes the <code>computer</code>-to-<code>cs</code> account and home migration described in Chapter 5. This is a rename, not an alias: the old passwd/group/shadow name and <code>/home/computer</code> disappear after success, while the exact password payload and filesystem data/metadata/link identities remain intact.</p><p>Optional OS-runtime fields migrate independently and idempotently. Linux restores only cold journal, last-login, service/mount definition, and offline-device state; it never revives a process, job, active mount, or authenticated session. DOS preserves C: drive/label/FAT metadata, activates C:, and always detaches transient A: media and stale generation metadata. The current CS-DOS v3 image remains compatible with registered v1/v2 immutable bases.</p><ol class="manual-procedure"><li>Stop BDS before copying or restoring a world; never copy a live LevelDB directory.</li><li>Back up the complete world directory before the first start with a storage-format update.</li><li>Start BDS and wait for the migration-complete message before using Computers or running headless probes.</li><li>If migration fails, stop BDS, preserve the logs and failed world, then restore the stopped backup or correct the reported corrupt property.</li></ol><p><b>Verify:</b> Find a terminal <code>CS_STORAGE_MIGRATION</code> record with <code>state</code> equal to <code>complete</code>, then inspect the same Linux and DOS Computers after two starts.</p><p><b>Expect:</b> The Computer ID, OS profile, hardware, terminal state, password payload, guest files, modes, ownership, mtimes, symbolic links, hard-link identities, tombstones, Linux cold history, and DOS C: metadata are unchanged except for the complete user/group/shadow and home-path rename. No live Linux process/session or A: media is resurrected, and a second boot performs no further migration.</p></section>
      <section class="manual-section"><h3>15.8 Future network-state migration</h3><p>The optional network-state boundary remains absent from an empty OS snapshot, so a preserved legacy Computer and a new Computer with no guest NIC have the same canonical shape. If a future adapter registers interfaces and addresses, cold restore retains those definitions but forces every link down, resets counters to zero, and removes all process-owned sockets and listeners. A second cold projection is identical.</p><p>This boundary owns at most eight interfaces, 32 addresses, and 64 sockets. It is not packet transport: no default <code>lo</code> or <code>eth0</code>, route table, DNS resolver, <code>ip</code>, <code>ping</code>, or <code>ss</code> ships in this release. Web Terminal connectivity remains host transport.</p></section>
      <aside class="manual-warning"><b>Server remains authoritative</b><p>A guest fault must never mutate host files or broaden permissions. If BDS or the terminal disconnects, reconnect and inspect the persisted Computer rather than retrying in an unbounded loop.</p></aside>`,
  },
  {
    id: "limits-glossary",
    html: `
      <header class="manual-page-header"><p class="manual-kicker">Chapter 16 · Technical appendix</p><h2>Limits, units, and terminology</h2><p class="manual-lead">A limit is part of the programming model, not an exceptional host failure. Design programs so every ceiling has a useful observable outcome.</p></header>
      <section class="manual-section"><h3>16.1 Future network-state limits</h3><table><thead><tr><th>State</th><th>Default ceiling</th><th>Cold restore</th></tr></thead><tbody><tr><td>Interfaces</td><td>8; name at most 15 UTF-8 bytes</td><td>Definition retained, link down, counters zero</td></tr><tr><td>IPv4/IPv6 addresses</td><td>32</td><td>Definition retained</td></tr><tr><td>TCP/UDP sockets and listeners</td><td>64; backlog at most 128</td><td>All removed</td></tr></tbody></table><p>This empty-by-default state is reserved for a future network adapter. It creates no guest NIC and routes no packets. No network command can inspect it in this release.</p></section>
      <section class="manual-section"><h3>16.2 Canonical compatibility matrix</h3><table><thead><tr><th>Capability</th><th>CS486DX desktop</th><th>CS486DX2 advanced</th><th>CS386SX portable</th></tr></thead><tbody><tr><td>Default OS</td><td>CS-Linux 1.0</td><td>CS-Linux 1.0</td><td>CS-DOS 6.2</td></tr><tr><td>Computer System Python</td><td>Supported</td><td>Supported</td><td>Not available</td></tr><tr><td>ASM / BASIC / C / C++</td><td>Supported</td><td>Supported</td><td>Supported</td></tr><tr><td>Web Terminal display</td><td>Exactly one adjacent Monitor</td><td>Exactly one adjacent Monitor</td><td>Built in; held or placed</td></tr><tr><td>Maximum guest display</td><td>640x480x8</td><td>640x480x8</td><td>640x480x4</td></tr></tbody></table><p>This matrix is the canonical quick compatibility lookup. Profile chapters explain behavior; they do not broaden a capability marked unavailable here.</p></section>
      <section class="manual-section"><h3>16.3 Independent resource ceilings</h3><table><thead><tr><th>Resource</th><th>Measured as</th><th>Inspect with</th></tr></thead><tbody><tr><td>CPU</td><td>Instructions and modeled cycles</td><td>run --stats, time, cpuinfo</td></tr><tr><td>RAM</td><td>Live VM values and CS486 memory</td><td>free -h, /proc/meminfo</td></tr><tr><td>Disk</td><td>Persisted file bytes and entries</td><td>df, du, quota</td></tr><tr><td>Processes / jobs</td><td>64 / 32 per Computer by default</td><td>ps, jobs, /proc/loadavg</td></tr><tr><td>Sessions / last logins</td><td>8 active / 64 retained</td><td>who, w, last</td></tr><tr><td>Services / mounts / devices</td><td>32 / 16 / 64 records</td><td>service, mount, /proc/devices</td></tr><tr><td>Journal</td><td>256 records, 32 KiB total, 1 KiB each</td><td>dmesg, /var/log/messages, auth.log</td></tr><tr><td>DOS FAT metadata</td><td>4,096 records; 255-character normalized path</td><td>ATTRIB, DIR /A, LABEL, CHKDSK</td></tr><tr><td>Terminal</td><td>Rows × columns and bounded output</td><td>term.get_size()</td></tr><tr><td>Events</td><td>Queued records and wait ownership</td><td>Program diagnostics</td></tr><tr><td>Scheduler</td><td>Per-machine and global tick work</td><td>cpuinfo, run --stats</td></tr><tr><td>Stopping</td><td>200 ticks per phase; 16 Computers advanced per host tick</td><td>messages journal and PWR/HDD state</td></tr></tbody></table></section>
      <section class="manual-section"><h3>16.4 Terms</h3><table><thead><tr><th>Term</th><th>Definition</th></tr></thead><tbody><tr><td>Computer identity</td><td>Stable id binding block, item, storage, terminal, and runtime state</td></tr><tr><td>Guest</td><td>Code executing inside the sandboxed machine</td></tr><tr><td>Host</td><td>BDS, Minecraft, and the companion processes outside the guest boundary</td></tr><tr><td>Cycle debt</td><td>Modeled work awaiting fair scheduler service</td></tr><tr><td>Writer lease</td><td>Exclusive authority for one Web Terminal session to submit input</td></tr><tr><td>Terminal state</td><td>Explicit completion such as success, fault, cancel, close, shutdown, or yield</td></tr></tbody></table></section>
      <section class="manual-section"><h3>16.5 Quick diagnostic card</h3><pre><code>whoami             # identity and user
uname -a           # OS profile
cpuinfo            # modeled processor
free -h            # memory use
df                  # filesystem capacity
quota               # guest disk limits
history             # recent commands
echo $?             # previous status</code></pre></section>
      <section class="manual-section"><h3>16.6 Canonical numeric ceilings</h3><table><thead><tr><th>Resource</th><th>Ceiling</th><th>Observable outcome</th></tr></thead><tbody><tr><td>Direct CS486 run</td><td>10,000 instructions per bounded direct run</td><td>Status 124 / yielded</td></tr><tr><td>CS-DOS batch</td><td>256 lines; nesting depth 8</td><td>Explicit line-limit or depth status</td></tr><tr><td>CONFIG.SYS</td><td>64 lines</td><td>Explicit unsupported or invalid directive</td></tr><tr><td>Pipeline / output buffer</td><td>256,000 characters</td><td>Explicit bounded-output status</td></tr><tr><td>DOS TREE</td><td>512 entries; 32 levels</td><td>Explicit traversal limit</td></tr><tr><td>Manual search</td><td>24 section results</td><td>Highest-ranked bounded results</td></tr></tbody></table></section>
      <section class="manual-section"><h3>16.7 Command, API, instruction, and error indexes</h3><table><thead><tr><th>Lookup</th><th>Primary chapter</th><th>Examples</th></tr></thead><tbody><tr><td>Commands</td><td>04 CS-Linux shell; 14 CS-DOS</td><td><code>ls</code>, <code>grep</code>, <code>DIR</code>, <code>MEM /F</code></td></tr><tr><td>Python API</td><td>08 API reference</td><td><code>os.pull_event</code>, <code>term.write</code>, <code>redstone.set_output</code></td></tr><tr><td>Instructions</td><td>10 Assembly language</td><td><code>LOAD</code>, <code>STORE</code>, <code>CALL</code>, <code>RET</code></td></tr><tr><td>Errors and statuses</td><td>15 Diagnostics</td><td><code>MemoryAccessError</code>, 124, 127, <code>out_of_range</code></td></tr></tbody></table><p>Manual search returns the matching section with a type, applicability, and bounded snippet; use these chapters when the exact contract matters.</p></section>
      <section class="manual-section"><h3>16.8 Reading paths</h3><table><thead><tr><th>Goal</th><th>Chapters</th></tr></thead><tbody><tr><td>First program</td><td>01 → 02 → 03 → 05</td></tr><tr><td>Python + Redstone</td><td>01 → 02 → 03 → 05 → 06 → 07</td></tr><tr><td>CS-Linux operator</td><td>01 → 02 → 03 → 04 → 15</td></tr><tr><td>Native development</td><td>01 → 03 → 09 → 10 / 11 / 12 → 13</td></tr><tr><td>Portable / CS-DOS</td><td>01 → 02 → 14 → 09 → 10 / 11 / 12</td></tr><tr><td>Diagnose a problem</td><td>15 → 16</td></tr></tbody></table></section>
      <aside class="manual-callout"><b>Reading path</b><p>Choose one goal in Chapter 01, follow its stable chapter route, and keep this appendix open while commissioning a machine.</p></aside>`,
  },
];

const publicationOrder = [
  "orientation",
  "terminal-editor",
  "io-files",
  "shell",
  "micropython",
  "redstone-peripherals",
  "worked-project",
  "api-reference",
  "architecture",
  "assembly",
  "basic",
  "c-family",
  "optimization",
  "dos-profile",
  "faults",
  "limits-glossary",
];

const allProfiles = ["cs-linux", "cs-dos", "cs486dx", "cs486dx2", "cs386sx"];

const chapterMetadata = {
  orientation: {
    title: "System orientation & machine choice",
    summary: "Choose hardware, boot, connect, and begin",
    partId: "start-operate",
    kind: "tutorial",
    appliesTo: allProfiles,
  },
  "terminal-editor": {
    title: "Terminal, Web access, and editors",
    summary: "Connect, control, type, edit, and close",
    partId: "start-operate",
    kind: "how-to",
    appliesTo: allProfiles,
  },
  "io-files": {
    title: "Filesystem, storage, and persistence",
    summary: "Paths, permissions, quota, and durable state",
    partId: "start-operate",
    kind: "concept",
    appliesTo: allProfiles,
  },
  shell: {
    title: "CS-Linux shell and utilities",
    summary: "Commands, pipelines, scripts, and startup files",
    partId: "start-operate",
    kind: "how-to",
    appliesTo: ["cs-linux", "cs486dx", "cs486dx2"],
  },
  micropython: {
    title: "Computer System Python on CS486",
    summary: "Edit, run, import, and deploy",
    partId: "build-connect",
    kind: "tutorial",
    appliesTo: ["cs-linux", "cs486dx", "cs486dx2"],
  },
  "redstone-peripherals": {
    title: "Redstone, peripherals, and events",
    summary: "Connect displays, sides, signals, and events",
    partId: "build-connect",
    kind: "how-to",
    appliesTo: allProfiles,
  },
  "worked-project": {
    title: "Worked project: build, test, measure, deploy",
    summary: "Complete and verify a threshold controller",
    partId: "build-connect",
    kind: "tutorial",
    appliesTo: ["cs-linux", "cs486dx", "cs486dx2"],
  },
  "api-reference": {
    title: "Computer System Python API reference",
    summary: "Native functions, return values, errors, and limits",
    partId: "build-connect",
    kind: "reference",
    appliesTo: ["cs-linux", "cs486dx", "cs486dx2"],
  },
  architecture: {
    title: "Machine architecture and execution model",
    summary: "Registers, memory, cycles, display, and faults",
    partId: "understand-compile",
    kind: "concept",
    appliesTo: allProfiles,
  },
  assembly: {
    title: "Assembly language",
    summary: "Build, inspect, execute, and reference instructions",
    partId: "understand-compile",
    kind: "tutorial",
    appliesTo: allProfiles,
  },
  basic: {
    title: "BASIC",
    summary: "Structured and numbered compiled programs",
    partId: "understand-compile",
    kind: "tutorial",
    appliesTo: allProfiles,
  },
  "c-family": {
    title: "C and C++",
    summary: "Safe compiled subsets, objects, and linking",
    partId: "understand-compile",
    kind: "tutorial",
    appliesTo: allProfiles,
  },
  optimization: {
    title: "Optimization workshop",
    summary: "Measure, identify, change, and compare",
    partId: "understand-compile",
    kind: "how-to",
    appliesTo: allProfiles,
  },
  "dos-profile": {
    title: "CS-DOS 6.2 on CS386SX",
    summary: "Portable boot, memory, batch, commands, and toolchains",
    partId: "profiles-support",
    kind: "concept",
    appliesTo: ["cs-dos", "cs386sx"],
  },
  faults: {
    title: "Faults, diagnostics, and recovery",
    summary: "Symptoms, terminal states, checks, and recovery",
    partId: "profiles-support",
    kind: "how-to",
    appliesTo: allProfiles,
  },
  "limits-glossary": {
    title: "Limits, compatibility, glossary, and indexes",
    summary: "Canonical ceilings, matrices, terms, and quick lookup",
    partId: "profiles-support",
    kind: "reference",
    appliesTo: allProfiles,
  },
};

export const manualParts = [
  {
    id: "start-operate",
    number: "I",
    title: "Start and operate",
    summary: "Choose a machine and learn the everyday operator workflow.",
    chapterIds: publicationOrder.slice(0, 4),
  },
  {
    id: "build-connect",
    number: "II",
    title: "Build and connect",
    summary: "Create programs and connect them to the Minecraft world.",
    chapterIds: publicationOrder.slice(4, 8),
  },
  {
    id: "understand-compile",
    number: "III",
    title: "Understand and compile",
    summary: "Study the shared process, toolchains, and measured optimization.",
    chapterIds: publicationOrder.slice(8, 13),
  },
  {
    id: "profiles-support",
    number: "IV",
    title: "Profiles and support",
    summary: "Operate CS-DOS, recover faults, and look up canonical limits.",
    chapterIds: publicationOrder.slice(13, 16),
  },
];

export const manualPaths = [
  {
    id: "first-program",
    title: "First program",
    summary: "Choose, connect, save, and run a CS486 program.",
    chapterIds: ["orientation", "terminal-editor", "io-files", "micropython"],
  },
  {
    id: "python-redstone",
    title: "Python + Redstone",
    summary: "Build and verify an event-driven world controller.",
    chapterIds: [
      "orientation",
      "terminal-editor",
      "io-files",
      "micropython",
      "redstone-peripherals",
      "worked-project",
    ],
  },
  {
    id: "linux-operator",
    title: "CS-Linux operator",
    summary: "Operate the terminal, filesystem, shell, and recovery tools.",
    chapterIds: [
      "orientation",
      "terminal-editor",
      "io-files",
      "shell",
      "faults",
    ],
  },
  {
    id: "native-development",
    title: "Native development",
    summary: "Understand, compile, inspect, and optimize native programs.",
    chapterIds: [
      "orientation",
      "io-files",
      "architecture",
      "assembly",
      "basic",
      "c-family",
      "optimization",
    ],
  },
  {
    id: "portable-dos",
    title: "Portable / CS-DOS",
    summary: "Operate and program the Portable Computer System.",
    chapterIds: [
      "orientation",
      "terminal-editor",
      "dos-profile",
      "architecture",
      "assembly",
      "basic",
      "c-family",
    ],
  },
  {
    id: "diagnostics",
    title: "Diagnose a problem",
    summary: "Start from an observed symptom and finish at a bounded outcome.",
    chapterIds: ["faults", "limits-glossary"],
  },
];

const htmlEntities = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

function decodeEntities(value) {
  return value.replace(
    /&(#(?:x[\da-f]+|\d+)|amp|apos|gt|lt|nbsp|quot);/gi,
    (_match, entity) => {
      if (entity[0] !== "#") {
        return htmlEntities[entity.toLowerCase()] ?? _match;
      }
      const hexadecimal = entity[1].toLowerCase() === "x";
      const parsed = Number.parseInt(
        entity.slice(hexadecimal ? 2 : 1),
        hexadecimal ? 16 : 10,
      );
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : _match;
    },
  );
}

function plainText(html) {
  return decodeEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSearchText(value) {
  return String(value)
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/\s+/g, " ")
    .trim();
}

function stableSlug(value, fallback) {
  const slug = normalizeSearchText(plainText(value))
    .replace(/^\d{1,2}\.\d+\s+/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

function enrichHeadings(html, chapterId, number) {
  const usedIds = new Map();
  let numberedHeadingIndex = 0;
  let sourceChapterNumber;
  const visibleChapter = String(Number(number));
  const renumbered = html.replace(/\bChapter\s+\d{2}\b/g, `Chapter ${number}`);

  return renumbered.replace(
    /<h3([^>]*)>([\s\S]*?)<\/h3>/gi,
    (_match, attributes, heading) => {
      const numberedHeading = heading.replace(
        /^\s*(\d{1,2})\.(\d+)\s+/,
        (_prefix, rawChapter, rawSection) => {
          numberedHeadingIndex += 1;
          sourceChapterNumber ??= rawChapter;
          if (
            rawChapter !== sourceChapterNumber ||
            Number(rawSection) !== numberedHeadingIndex
          ) {
            throw new Error(
              `Field manual chapter ${chapterId} source headings must be one sequential series; expected ${sourceChapterNumber}.${numberedHeadingIndex}`,
            );
          }
          return `${visibleChapter}.${numberedHeadingIndex} `;
        },
      );
      const baseId = `${chapterId}-${stableSlug(numberedHeading, "section")}`;
      const occurrence = (usedIds.get(baseId) ?? 0) + 1;
      usedIds.set(baseId, occurrence);
      const id = occurrence === 1 ? baseId : `${baseId}-${occurrence}`;
      const cleanAttributes = attributes.replace(
        /\s+id\s*=\s*(?:"[^"]*"|'[^']*')/i,
        "",
      );
      return `<h3${cleanAttributes} id="${id}">${numberedHeading}</h3>`;
    },
  );
}

function sectionType(chapterId) {
  if (chapterId === "api-reference") return "api";
  if (chapterId === "assembly") return "instruction";
  if (chapterId === "faults") return "error";
  if (chapterId === "shell" || chapterId === "dos-profile") return "command";
  return "concept";
}

function deriveSections(html, chapterId) {
  const headings = [
    ...html.matchAll(/<h3\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/h3>/gi),
  ];
  return headings.map((heading, index) => {
    const title = plainText(heading[2]);
    const contentStart = (heading.index ?? 0) + heading[0].length;
    const contentEnd = headings[index + 1]?.index ?? html.length;
    const text = plainText(html.slice(contentStart, contentEnd));
    return {
      id: heading[1],
      title,
      number: title.match(/^(\d{1,2}\.\d+)/)?.[1] ?? null,
      text,
      type: sectionType(chapterId),
      href: `#${heading[1]}`,
    };
  });
}

const rawChapterById = new Map(
  rawChapters.map((chapter) => [chapter.id, chapter]),
);

const searchTypeTerms = {
  api: ["api", "function"],
  command: ["command", "utility"],
  concept: ["concept", "architecture"],
  error: ["diagnostic", "error", "fault", "status"],
  instruction: ["assembly", "instruction", "opcode"],
};

export const manualChapters = publicationOrder.map((id, index) => {
  const rawChapter = rawChapterById.get(id);
  const metadata = chapterMetadata[id];
  if (!rawChapter || !metadata) {
    throw new Error(`Missing field manual chapter definition: ${id}`);
  }

  const number = String(index + 1).padStart(2, "0");
  const html = enrichHeadings(rawChapter.html, id, number);
  return {
    id,
    number,
    ...metadata,
    appliesTo: [...metadata.appliesTo],
    html,
    sections: deriveSections(html, id),
  };
});

const manualSearchIndex = manualChapters.flatMap((chapter) =>
  chapter.sections.map((section, sectionIndex) => ({
    chapter,
    chapterTitle: normalizeSearchText(`${chapter.title} ${chapter.summary}`),
    section,
    sectionIndex,
    sectionText: normalizeSearchText(section.text),
    sectionTitle: normalizeSearchText(section.title),
  })),
);

function resultScore(query, terms, entry) {
  const { chapterTitle, section, sectionIndex, sectionText, sectionTitle } =
    entry;
  const sectionMatches = terms.every(
    (term) => sectionTitle.includes(term) || sectionText.includes(term),
  );
  const chapterMatches = terms.every((term) => chapterTitle.includes(term));
  if (!sectionMatches && !(sectionIndex === 0 && chapterMatches)) return null;

  let score = 0;
  if (searchTypeTerms[section.type].some((term) => terms.includes(term)))
    score += 500;
  if (sectionTitle === query) score += 1_000;
  else if (sectionTitle.startsWith(query)) score += 800;
  else if (sectionTitle.includes(query)) score += 600;
  if (sectionText.includes(query)) score += 400;
  if (sectionIndex === 0 && chapterTitle.includes(query)) score += 500;
  for (const term of terms) {
    if (sectionTitle.includes(term)) score += 80;
    if (sectionText.includes(term)) score += 20;
  }
  return score;
}

function makeSnippet(text, normalizedText, terms, maximumLength = 160) {
  if (text.length <= maximumLength) return text;
  const firstMatch = Math.min(
    ...terms
      .map((term) => normalizedText.indexOf(term))
      .filter((position) => position >= 0),
  );
  const center = Number.isFinite(firstMatch) ? firstMatch : 0;
  const start = Math.max(0, Math.min(center - 48, text.length - maximumLength));
  const end = Math.min(text.length, start + maximumLength);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${
    end < text.length ? "…" : ""
  }`;
}

export function searchManual(query, options = {}) {
  const normalizedQuery = normalizeSearchText(String(query).slice(0, 160));
  if (!normalizedQuery) return [];
  const terms = normalizedQuery.split(" ").filter(Boolean).slice(0, 8);
  const limitOption = typeof options === "number" ? options : options?.limit;
  const requestedLimit = Number.isFinite(limitOption)
    ? Math.trunc(limitOption)
    : 24;
  const limit = Math.max(0, Math.min(24, requestedLimit));
  if (limit === 0) return [];
  const results = [];

  for (const entry of manualSearchIndex) {
    const { chapter, section } = entry;
    const score = resultScore(normalizedQuery, terms, entry);
    if (score === null) continue;
    results.push({
      type: section.type,
      chapterId: chapter.id,
      chapterNumber: chapter.number,
      chapterTitle: chapter.title,
      sectionId: section.id,
      sectionTitle: section.title,
      href: section.href,
      appliesTo: [...chapter.appliesTo],
      snippet: makeSnippet(
        section.text || section.title,
        entry.sectionText || entry.sectionTitle,
        terms,
      ),
      score,
    });
  }

  return results
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.chapterNumber.localeCompare(right.chapterNumber) ||
        left.sectionTitle.localeCompare(right.sectionTitle),
    )
    .slice(0, limit);
}
