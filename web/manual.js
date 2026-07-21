const rawChapters = [
  {
    id: "orientation",
    html: `
      <header class="manual-page-header">
        <p class="manual-kicker">Chapter 01 · Operator orientation</p>
        <h2>From powered block to running program</h2>
        <p class="manual-lead">A Computer is a persistent, sandboxed machine. The desktop runs Computer System Linux 1.0 (CS-Linux 1.0); the portable runs Computer System DOS 1.0 (CS-DOS 1.0). Its terminal, files, redstone state, CPU budget, and RAM belong to its identity and survive normal world reloads.</p>
      </header>
      <div class="manual-spec-line"><span>Computer</span><b>Computer System Deskpro 486DX · 33 MHz · 2 MiB</b><span>Advanced</span><b>Computer System Deskpro 486DX2 · 66 MHz · 8 MiB</b><span>Portable</span><b>Computer System LTE 386SX · 16 MHz · 2 MiB</b></div>
      <section class="manual-section"><h3>1.1 Choose a machine</h3><table><thead><tr><th>Machine</th><th>Default profile</th><th>Disk</th><th>Display</th><th>Languages</th></tr></thead><tbody><tr><td>Computer System Deskpro 486DX<br><small>Computer</small></td><td>CS486DX · CS-Linux 1.0</td><td>40 MiB IDE</td><td>Built-in 640x480 CRT</td><td>Computer System Python, CS ASM 1.0, CS C/C++ 1.0; no BASIC</td></tr><tr><td>Computer System Deskpro 486DX2<br><small>Advanced</small></td><td>CS486DX2 · CS-Linux 1.0</td><td>80 MiB IDE</td><td>Built-in 640x480 CRT</td><td>Computer System Python, CS ASM 1.0, CS C/C++ 1.0; no BASIC</td></tr><tr><td>Computer System LTE 386SX<br><small>Portable</small></td><td>CS386SX · CS-DOS 1.0</td><td>20 MiB IDE</td><td>Built-in; held or placed</td><td>CS ASM 1.0, CS C/C++ 1.0, CS QBASIC 1.0; no user Python</td></tr></tbody></table><p>The initial CS-Linux image allocates roughly 2–4 MiB and CS-DOS roughly 0.5–1 MiB. These are real guest files with sizes, permissions, and inode identities. Hardware identity, OS profile, storage, and the permanent browser connection number persist with the Computer identity.</p></section>
      <section class="manual-section"><h3>1.2 Power on, connect, and sign in</h3><ol class="manual-procedure"><li><b>Power on.</b> CSBIOS reports the persisted hardware, then hands control to the selected OS.</li><li><b>Connect.</b> Activate the eligible machine and enter its four-digit number on the Web Terminal entry page.</li><li><b>Initialize credentials.</b> A new CS-Linux installation asks for and confirms the password of its initial <code>cs</code> account before exposing the shell.</li><li><b>Authenticate later boots.</b> Existing CS-Linux installations show <code>/etc/issue</code>, ask for a username at <code>&lt;computer-id&gt; login:</code>, and then ask for that account's password; CS-DOS presents <code>C:\\&gt;</code> after its bounded startup files finish.</li></ol><p><code>cs</code> is UID/GID 1000 with home <code>/home/cs</code> and membership in <code>sudo</code>. UID 1000 is the protected boot-service account: its name and home may be changed while it is inactive, but it cannot be deleted. Root is UID/GID 0 and initially password-locked. Each OS boot resets the display but does not format the guest disk. Password plaintext is never stored or written to terminal history.</p></section>
      <section class="manual-section">
        <h3>1.3 Operating cycle</h3>
        <ol class="manual-procedure">
          <li><b>Inspect.</b> Run <code>cpuinfo</code>, <code>free -h</code>, and <code>quota</code>.</li>
          <li><b>Edit.</b> Use <code>vi</code> for source files. Desktop Computer System Python starts at <code>/startup.py</code>; the portable DOS profile uses <code>AUTOEXEC.BAT</code>.</li>
          <li><b>Build.</b> Use <code>as</code>, <code>cc</code>, or <code>c++</code>; add <code>-c</code> for an object and combine objects with <code>ld</code>. On CS-DOS, use <code>QBASIC</code> for BASIC source.</li>
          <li><b>Measure.</b> Run compiled programs with <code>run --stats</code>.</li>
          <li><b>Optimize.</b> Compare instructions, cycles, output, and memory use—not host wall time.</li>
        </ol>
      </section>
      <section class="manual-section manual-grid-2">
        <div><h3>Persistent</h3><p><code>/etc</code>, <code>/usr</code>, home files, executables, terminal snapshot, identity, and configured hardware.</p></div>
        <div><h3>Volatile or bounded</h3><p><code>/tmp</code>, active VM frames, event queues, compiler work, terminal output, retries, and each direct machine run.</p></div>
      </section>
      <aside class="manual-callout"><b>Safety boundary</b><p>No guest language launches PowerShell, cmd.exe, a host compiler, BDS administration, or native binaries. Unsupported behavior fails inside the guest.</p></aside>
      <aside class="manual-callout"><b>Guest resource accounting</b><p>Portable CS-DOS charges its 20 MiB disk with 2,048-byte FAT16-like allocation units, a fixed metadata reserve, directory entries, and a 512-entry root limit; <code>DIR</code> still shows logical file bytes. HDD work above 64 KiB completes as sequential at-most-128-sector requests, preserving the full byte count. At minimal boot, one transient RAM ledger reserves 64 KiB for DOS, so <code>MEM</code> reports 640 KiB conventional total, 64 KiB used, and 576 KiB free. EDIT, CS QBASIC, WorkBench, vi, compilers, linkers, and Program Lists acquire coarse guest-residency leases before admission; the CS process receives only the remaining RAM. These leases model guest accounting, not byte-perfect JavaScript heap use, and are released by the close, cancel, failure, disconnect, or shutdown owner.</p></aside>
      <section class="manual-section"><h3>1.4 First inspection</h3><pre><code>whoami
pwd
cpuinfo
free -h
df
quota
ls -la /</code></pre></section>
      <section class="manual-section"><h3>1.5 Choose a reading route</h3><table><thead><tr><th>Goal</th><th>Route</th></tr></thead><tbody><tr><td>First program</td><td>01 → 02 → 03 → 05</td></tr><tr><td>Python + Redstone</td><td>01 → 02 → 03 → 05 → 06 → 07</td></tr><tr><td>CS-Linux operator</td><td>01 → 02 → 03 → 04 → 15</td></tr><tr><td>Build and play NetHack</td><td>01 → 02 → 03 → 04 → 12</td></tr><tr><td>Native development</td><td>01 → 03 → 09 → 10 / 11 / 12 → 13</td></tr><tr><td>Portable / CS-DOS</td><td>01 → 02 → 14 → 09 → 10 / 11 / 12</td></tr><tr><td>Diagnose a problem</td><td>15 → 16</td></tr></tbody></table><p>Reference chapters are destinations, not prerequisites. Follow one route, then use manual search to jump directly to a command, API, instruction, fault, or concept.</p></section>`,
  },
  {
    id: "architecture",
    html: `
      <header class="manual-page-header"><p class="manual-kicker">Chapter 02 · Hardware model</p><h2>Three machine profiles, one safe instruction format</h2><p class="manual-lead">The Computer System Deskpro 486DX selects a CS486DX at 33 MHz with 2 MiB RAM; the Computer System Deskpro 486DX2 selects a CS486DX2 at 66 MHz with 8 MiB RAM; the Computer System LTE 386SX selects a CS386SX at 16 MHz with 2 MiB RAM. These are the manual model names for the Computer, Advanced, and Portable machine types. The persisted CPU model selects timing in O(1), while the bounded scheduler arbitrates actual BDS work fairly.</p></header>
      <figure class="manual-figure manual-figure--desktop"><img src="/assets/manual/desktop-computer-system.png" width="1122" height="1402" alt="Computer System Deskpro 486 family all-in-one computer with built-in CRT, keyboard, mouse, and two 3.5-inch floppy drives" loading="lazy" decoding="async"><figcaption><b>Computer System Deskpro 486 family.</b> Computer uses the 486DX/33 and Advanced uses the 486DX2/66 configuration of the same square all-in-one CRT chassis. Computer has one 3.5-inch floppy drive; Advanced has two. The Minecraft implementation models the machine rather than emulating the pictured host hardware literally.</figcaption></figure>
      <section class="manual-section"><h3>2.1 Machine family</h3><div class="manual-asset-grid manual-asset-grid--machines">
        <figure class="manual-asset-card"><img src="/assets/machines/cs-computer.png" width="1920" height="1920" alt="Computer System Deskpro 486DX square all-in-one CRT chassis with one right-mounted 3.5-inch floppy drive" loading="lazy" decoding="async"><figcaption><b>Computer System Deskpro 486DX</b><span>Computer · CS486DX · 33 MHz · 2 MiB · CS-Linux 1.0</span></figcaption></figure>
        <figure class="manual-asset-card"><img src="/assets/machines/cs-advanced-computer.png" width="1920" height="1920" alt="Computer System Deskpro 486DX2 square all-in-one CRT chassis with two right-mounted 3.5-inch floppy drives" loading="lazy" decoding="async"><figcaption><b>Computer System Deskpro 486DX2</b><span>Advanced · CS486DX2 · 66 MHz · 8 MiB · CS-Linux 1.0</span></figcaption></figure>
        <figure class="manual-asset-card"><img src="/assets/machines/cs-portable-computer.png" width="1920" height="1920" alt="Computer System LTE 386SX cream laptop with trackball and 3.5-inch floppy drive" loading="lazy" decoding="async"><figcaption><b>Computer System LTE 386SX</b><span>Portable · CS386SX · 16 MHz · 2 MiB · CS-DOS 1.0 · held or placed</span></figcaption></figure>
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
      <section class="manual-section manual-grid-2"><div><h3>2.4 Memory model</h3><p>RAM is a checked, little-endian linear byte array. <code>LOAD</code> and <code>STORE</code> transfer signed 32-bit words. CS386SX exposes a 24-bit address bus and a 16-bit data bus, with 2 MiB provided by two 1 MiB 30-pin SIMM DRAM modules. An even-addressed dword needs two 16-bit transfers; an odd-addressed dword needs three and records an unaligned access. CS486DX uses four 512 KiB 30-pin SIMMs, while CS486DX2 uses two 4 MiB 72-pin SIMMs. The stack begins at the top of RAM and grows downward.</p><p>Memory reports include bounded OS overhead as well as live guest data. CS-Linux separates resident kernel, system services, buffers, and guest runtime. CS-DOS separates DOS system/drivers and guest runtime while preserving conventional, upper, reserved, and XMS region totals. Version 3 executables declare their <code>cs-flat32-v1</code> stack, heap, and auxiliary residency before process construction. The built-in empty-startup shell uses one 64 KiB composite grant; user-authored startup uses one quarter of physical RAM capped at 1 MiB, and foreground Python keeps its 1 MiB managed-runtime quota. Older version 1/2 executables remain readable but take the complete currently free physical remainder exclusively.</p></div><div class="manual-memory-map"><span>LOW ADDRESS</span><b>OS resident memory</b><b>compiler variables / heap</b><b>free space</b><b>↓ stack growth</b><span>HIGH ADDRESS</span></div></section>
      <section class="manual-section"><h3>2.5 Model-specific cycle classes</h3><table><thead><tr><th>Class</th><th>CS486DX / CS486DX2</th><th>CS386SX</th></tr></thead><tbody><tr><td>Simple ALU</td><td>1</td><td>2</td></tr><tr><td>LOAD / STORE base</td><td>2 / 2 plus cache and write-through</td><td>6 / 4 plus odd-address penalty</td></tr><tr><td>PUSH / POP base</td><td>2 / 2</td><td>4 / 6</td></tr><tr><td>Conditional branch</td><td>3 taken / 1 not taken</td><td>7 taken / 3 not taken</td></tr><tr><td>CALL / RET</td><td>3 / 3</td><td>9 / 12</td></tr><tr><td>MUL</td><td>9</td><td>9–38, operand early-out</td></tr><tr><td>DIV / MOD</td><td>40</td><td>43</td></tr><tr><td>PRINT</td><td>8 + payload</td><td>12 + 16-bit bus payload</td></tr></tbody></table><p>At 20 ticks per second the standard desktop receives 1,650,000 cycles/tick, the Advanced Desktop receives 3,300,000 cycles/tick, and the portable receives 800,000 cycles/tick. CS486DX and CS486DX2 have a cold 8 KiB four-way unified L1 with 16-byte lines and write-through stores; Advanced adds a 256 KiB external L2. CS386SX has neither cache. Cache tags, recency, prefetch state, and counters are transient per process. Every access remains O(1).</p></section>
      <section class="manual-section"><h3>2.6 CSBIOS and VGA display profiles</h3><p>Power-on runs an original deterministic <b>CSBIOS Revision 1.1</b> sequence in 80x25 text mode. At 20 server ticks per second its 70 ticks take about 3.5 seconds: black, CS-VGA identification, a short black transition, CSBIOS with a bounded same-row memory count, factual device detection, explicit fixed-disk or floppy source plus CS-Linux/CS-DOS target, a handoff blackout, and the selected <code>Starting ...</code> line. The Computer remains <code>booting</code>; guest CPU work and terminal/debug input stay unavailable until the final handoff. POST values come only from the active CPU, clock, RAM, display, VRAM, floppy state, and disk quota. CSBIOS does not copy AMI vendor strings or advertise an unsupported setup utility or FPU.</p><p>At handoff CSBIOS clears its frame once and explicitly releases control to CS-DOS or CS-Linux. CS-DOS then shows only its identity, a blank line, and <code>C:\\&gt;</code>; CS-Linux shows only its identity, a blank line, and the password or shell prompt. Neither advertises a simulated tty or startup shell-version banner.</p><table><thead><tr><th>Machine</th><th>VRAM</th><th>Physical presentation</th><th>640x480 maximum mode</th></tr></thead><tbody><tr><td>Portable</td><td>256 KiB</td><td>800x480 LCD, centered 640x480 with 80 px side bars</td><td>16 colors, four VGA planes</td></tr><tr><td>Desktop</td><td>512 KiB</td><td>Built-in 640x480 CRT</td><td>256 indexed colors</td></tr><tr><td>Advanced Desktop</td><td>512 KiB</td><td>Built-in 640x480 CRT</td><td>256 indexed colors with lower modeled transfer cost</td></tr></tbody></table><p>Every model also supports 320x200 with 256 colors. The 800x480 Portable panel is not a guest mode, and no model advertises a resolution above 640x480. VRAM is volatile and allocated only while powered; World Dynamic Properties store the small display-profile ID, never framebuffer bytes. Dirty graphics work uses a fixed-capacity queue with O(1) marking and bounded O(D) extraction. One Computer-scoped broker drains it once and shares each immutable update across attached sessions, with queued keyframes for late connections, epoch changes on mode replacement, and fixed Computer, tile, and byte budgets. This keeps publication work O(D+S). The Web text presentation keeps a fixed 80x25 guest grid and scales it to the viewport. Web Canvas delivery and guest graphics APIs remain the next implementation stage.</p></section>
      <section class="manual-section"><h3>2.7 Web raster aspect</h3><p>The Web Terminal uses one shared active-raster layer for command output and full-screen text TUI programs. Its 80x25 IBM VGA text grid is a logical 720x400 glyph raster: 80 columns at 9 pixels and 25 rows at 16 pixels. One blank 16-pixel row above and below supplies CRT vertical raster margin, and a 0.8 horizontal correction presents the complete surface as exact 4:3 glass without changing the guest grid or TUI pointer coordinates. Graphics use mode-specific correction instead: 640x480 VGA is already 4:3 and remains square-pixel at 1.0, while 320x200 receives its own correction. CS Windows is not implemented; this shared layer only preserves the presentation contract needed by a future 640x480 graphics surface.</p></section>
      <aside class="manual-warning"><b>Terminal condition required</b><p>A direct run halts normally, faults, or yields after 10,000 instructions with exit status 124. It never owns the server tick indefinitely.</p></aside>`,
  },
  {
    id: "assembly",
    html: `
      <header class="manual-page-header"><p class="manual-kicker">Chapter 10 · CS ASM 1.0</p><h2>CS ASM 1.0 for the active CS486/CS386 target</h2><p class="manual-lead">An independent, bounded assembler with Linux and DOS command spellings. One instruction occupies each line; labels end in a colon, semicolons begin comments, registers are case-insensitive, and memory operands use square brackets.</p></header>
      <section class="manual-section"><h3>10.1 Build and inspect</h3><pre><code># CS-Linux: direct executable
as total.asm -o total
objdump total
run --stats total

# CS-Linux: object plus static link
as -c fast.asm -o fast.o
nm fast.o
objdump fast.o
ld fast.o -o fast -e start

REM CS-DOS: identity, command-line build, and WorkBench
ASM /VERSION
ASM /C FAST.ASM /OUT:FAST.O
LINK FAST.O /OUT:FAST /ENTRY:START
RUN FAST /STATS
CSASM FAST.ASM
PWB FAST.ASM</code></pre><p>CS-Linux uses <code>as</code>/<code>ld</code> with <code>-c</code>, <code>-o</code>, and <code>-e</code>. CS-DOS additionally exposes <code>ASM</code>/<code>LINK</code> and accepts <code>/C</code>, <code>/OUT:</code>, and <code>/ENTRY:</code>. <code>CSASM</code> opens CS ASM 1.0 in the full-screen WorkBench, while <code>PWB</code> selects assembly mode from the <code>.ASM</code> extension; F2 saves, Shift+F5 builds and runs, and F4 toggles output; output paths still obey strict DOS 8.3 rules and diagnostics use CRLF. Relocatable assembly declares exported labels with <code>global name</code> and imported labels with <code>extern name</code>. Unmarked labels remain local to that object.</p><p>The resulting current <code>CS486OBJ</code> v4 object stores its word32 or byte8 identity, sections, typed symbols, initialized data, alignment, bounded function signatures, and structured relocations. <code>nm</code> and <code>objdump</code> inspect those records; the linker resolves symbols through bounded maps without rewriting assembly text and rejects mixed models. Existing v1-v3 word objects remain readable.</p></section>
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
      <header class="manual-page-header"><p class="manual-kicker">Chapter 06 · Desktop language runtime</p><h2>Computer System Python on CS486</h2><p class="manual-lead">On the desktop CS486DX and CS486DX2 profiles, Computer System Python compiles to the same resumable guest process as CS C/C++ 1.0 and CS ASM 1.0; there is no separate Python VM. Computer System Python 1.0 is targeting Python 3.14 syntax and core semantics under the Python 3.14 CS Profile, while the current implementation remains a bounded partial subset. Source in <code>/startup.py</code> starts when the Computer powers on. The portable CS386SX DOS profile does not expose user Python and returns status 127.</p></header>
      <section class="manual-section manual-grid-2"><div><h3>6.1 Edit and boot</h3><pre><code>vi /startup.py
        reboot</code></pre><p>Normal completion powers the program down. Infinite work remains preemptible by the common scheduler.</p><p>CS-Linux can also compile and run a source file as a foreground process from the normal Web Terminal:</p><pre><code>python /tmp/program.py
python --stats /tmp/program.py
micropython /tmp/program.py</code></pre><p><code>python</code> is the canonical command; <code>micropython</code> remains a compatibility alias for existing worlds and scripts. The shell waits while the process runs, routes guest events to it, and restores the prompt after completion, failure, or <kbd>Ctrl</kbd>+<kbd>C</kbd>. Add <code>--stats</code> to print machine instructions, modeled CPU cycles, and virtual time. Foreground Python is intentionally rejected inside pipelines, redirects, scripts, and command chains. Desktop boot creates an empty mode-0644 <code>/startup.py</code> owned by the current UID 1000 service account while keeping <code>/</code> root-owned. Empty source selects the built-in shell boot program; after <code>cs</code> saves non-empty source with <code>vi</code>, later boots execute it with UID 1000's current primary and supplementary groups. The native <code>shell</code> module is internal to that built-in empty-startup program and is unavailable to user-authored <code>/startup.py</code>, foreground Python, and MCP Python. The MCP form remains a bounded non-TUI debug probe.</p></div><div><h3>6.2 Core language</h3><p>The current subset supports variables, strings, booleans, lists, tuples, dictionaries, bounded mutable sets, functions, imports, conditionals, loops, exceptions, assertions, formatting, Unicode XID/NFKC names, lexical closures, all five parameter kinds, bounded <code>*</code>/<code>**</code> calls, short-circuit comparison chains, condition-first single-branch conditional expressions, expression-only <code>lambda</code> functions on the shared closure/call path, identifier-only assignment expressions on the same lexical binding path, single-RHS left-to-right chained assignment, single-evaluation augmented assignment, starred list/tuple/set displays, dictionary mapping unpacking, eager list/set/dictionary comprehensions, nested destructuring with one starred remainder list per level, built-in string/list/tuple slicing, bounded list slice assignment, and bounded arbitrary-precision integers with base literals, floor/modulo, powers, shifts, and bitwise operators through shared call/jump control flow and allowlisted managed-runtime syscalls. Assignment expressions evaluate one RHS and return the stored value; restricted subexpressions require parentheses. Comprehensions evaluate their leftmost iterable in the enclosing scope, then run synchronous or asynchronous <code>for</code>/<code>if</code> clauses left to right in an implicit scope whose iteration targets do not leak; a contained assignment expression binds in the containing non-comprehension scope. Sets provide explicit/starred displays, bounded <code>set()</code>, deterministic iteration, membership, <code>len</code>, equality, and bounded primitive/tuple hashing; mutable elements raise <code>TypeError</code>. Assertions evaluate one condition, skip their message on success, and raise <code>AssertionError</code> on failure; the profile has no <code>-O</code> mode and <code>__debug__</code> is always true. Slices accept omitted, clipped, and positive/negative-step integer components; strings use Unicode code points, while list stores preflight replacement arity and final capacity before mutation. Expanded collections default to 4,096 items. Integer magnitude defaults to 262,144 bits; float semantics remain partial IEEE 754 binary64. Class-scope comprehension behavior and custom data-model protocols remain outside this implemented phase.</p><p>The final profile targets the Python 3.14 grammar and observable core-language semantics. This is not yet a Python 3.14 compatibility claim. <code>pip</code>, <code>ensurepip</code>, <code>venv</code>, PyPI, and wheel installation are deliberately unavailable; source packages remain in scope and guest native extensions use versioned <code>CS486OBJ</code>, not the CPython extension ABI.</p></div></section>
      <section class="manual-section"><h3>Iterators and generator functions</h3><p><code>iter()</code> creates independent cursors for strings, lists, tuples, dictionaries, and sets; passing an existing iterator returns that same object at its current position. <code>next()</code> advances once, raises catchable <code>StopIteration</code> at stable exhaustion, or returns its optional default. <code>for</code>, unpacking, starred displays, iterable call expansion, slice replacement, and <code>set()</code> all consume that same built-in cursor position instead of restarting an iterator. Built-in advancement is O(1), and whole consumption is bounded by the source and managed-memory limits.</p><p>User-defined iteration resolves inherited <code>__iter__</code> and <code>__next__</code> through the class path and ignores instance-only special methods. Both run through bounded managed Python calls. <code>__iter__</code> may return a built-in cursor, generator, self-iterator, or separate class-backed iterator. <code>iter</code>, <code>next</code>, <code>for</code>, unpacking, starred displays, iterable call expansion, slice replacement, <code>set()</code>, synchronous comprehensions, generator expressions, and <code>yield from</code> share this path. Materializing consumers resume every user-iterator or generator step through ordinary bounded CS486 calls. They retain the current iterator, accumulated values, pending operands, arguments, or targets, and the original physical return slot in one reachable continuation. A callee is not invoked, unpack targets are not stored, slices are not mutated, and new results are not published until iteration and all arity/capacity checks succeed. <code>StopIteration</code> ends traversal, an optional <code>next</code> default is returned exactly, and other faults propagate unchanged.</p><p>When no class-level <code>__iter__</code> exists, inherited <code>__getitem__</code> supplies the legacy sequence protocol. Each independent cursor requests integer indexes from zero and advances only after a successful item; <code>IndexError</code> ends it while other faults propagate. Any class-level <code>__iter__</code>, including explicit <code>None</code>, takes precedence and prevents fallback.</p><p><code>iter(callable, sentinel)</code> evaluates both operands once, then invokes the callable with no arguments through the ordinary bounded CS486 path. Managed functions and lambdas, bound methods, classes, native functions including waits, and filesystem-loaded CS486 extension exports are supported. A result equal under the current CS Profile <code>==</code> semantics is consumed as the sentinel and makes exhaustion stable; a callable-raised <code>StopIteration</code> does the same. Another fault propagates without exhausting the cursor. The callable, sentinel, and exhaustion state stay reachable in one accounted internal iterator shared by every lazy and materializing consumer.</p><p>A directly containing <code>def</code> or <code>lambda</code> with <code>yield</code> creates a lazy generator. Calling it binds arguments without running the body. <code>next()</code>, <code>for</code>, and <code>send(None)</code> resume its compiled CS486 target and make the suspended yield expression evaluate to <code>None</code>; <code>send(value)</code> supplies that exact managed value. Sending non-<code>None</code> before the first yield raises <code>TypeError</code> without consuming the generator. Yield is valid throughout <code>try</code>, <code>except</code>, and <code>finally</code>; active handlers, handled faults, pending finalizers, locals, closure cells, and the managed value stack survive together.</p><p><code>throw(exception)</code> raises at the suspended yield and returns the next yielded value when caught. The bounded legacy type/value form accepts only a <code>None</code> traceback. <code>close()</code> injects <code>GeneratorExit</code>, runs pending <code>finally</code> suites, and returns a handled generator return value. Yielding during close raises <code>RuntimeError</code> and closes the generator; another exception propagates. <code>GeneratorExit</code> derives from <code>BaseException</code>, so <code>except Exception</code> does not catch it. Stored bound <code>send</code>, <code>throw</code>, and <code>close</code> methods remain in the same reachable heap. Return or an escaping fault owns closure; no second Python VM or scheduler is introduced.</p><p><code>yield from expression</code> evaluates one iterable once and passes its values to the caller lazily. A subgenerator return becomes the expression result; built-in iterator exhaustion supplies <code>None</code>, while user-iterator exhaustion supplies the exact <code>StopIteration.value</code>. <code>send</code>, <code>throw</code>, and <code>close</code> forward to a generator delegate through nested calls on the same CS486 process. A built-in or user iterator has no delegated methods in this phase, so a non-<code>None</code> send reports the missing <code>send</code> method and a thrown exception is raised at the yield-from point. Delegates and their suspended children remain in the same reachable heap.</p><p>A synchronous generator expression such as <code>(value * 2 for value in values if value)</code> uses the same implicit comprehension scope and generator protocol. Its leftmost iterable expression and <code>iter()</code> run once when the expression is constructed, so a non-iterable fails immediately. Elements, filters, and later iterables remain lazy. Iteration targets do not leak, a contained <code>:=</code> binds in the containing non-comprehension scope, and the sole argument to a call may omit one extra pair of parentheses. Independent expressions reuse <code>next</code>, <code>send</code>, <code>throw</code>, <code>close</code>, call-depth admission, and reachable heap accounting.</p><p>Custom <code>__call__</code>, custom <code>__eq__</code>, automatic garbage-collection close, and other generator consumers remain later phases.</p></section>
      <p>A sequence-fallback cursor keeps its source instance and current index reachable. An escaping <code>StopIteration</code> also makes exhaustion sticky; any other fault leaves the index unchanged. Every <code>__getitem__</code> request uses the ordinary bounded managed-CS486 call path.</p>
      <section class="manual-section"><h3>Exception groups and except-star</h3><pre><code>try:
    raise ExceptionGroup("batch", (ValueError("left"), TypeError("right")))
except* ValueError as errors:
    print(errors.message, errors.exceptions)
except* TypeError:
    pass</code></pre><p><code>BaseExceptionGroup</code> and <code>ExceptionGroup</code> retain a non-empty nested exception tree. Read-only <code>message</code> and <code>exceptions</code> fields expose its shape; <code>derive()</code>, <code>subgroup()</code>, and <code>split()</code> preserve matching branches and their cause, context, notes, and profile traceback metadata. A <code>BaseExceptionGroup</code> whose leaves all derive from <code>Exception</code> automatically becomes an <code>ExceptionGroup</code>.</p><p>An <code>except*</code> clause recursively receives only its matching subgroup. Ordinary <code>except</code> and <code>except*</code> cannot appear in the same <code>try</code>, a type is required, and <code>return</code>, <code>break</code>, and <code>continue</code> are forbidden in the handler suite. A plain exception is wrapped only while matching; an unmatched one propagates without that temporary group. Newly raised exceptions merge deterministically with unmatched leaves, while a bare <code>raise</code> retains the original subgroup identity and tree.</p><p><code>subgroup()</code> and <code>split()</code> accept an exception type or a managed Python function, lambda, or managed bound method. Managed predicates run node-by-node through ordinary bounded CS486 calls, and predicate faults use the normal exception path. Native, class, extension, and scheduler-yielding callable predicates are not available in this profile phase.</p><p>Exception trees default to at most 64 levels and 4,096 admitted nodes. The tree, active handler, unmatched leaves, new faults, and callable state remain in the reachable managed heap across generator or coroutine suspension and low instruction slices. Runtime traceback objects remain outside this phase; <code>pip</code> and <code>venv</code> remain unavailable.</p></section>
      <section class="manual-section"><h3>Synchronous context managers</h3><pre><code>with Lock("outer") as first, Lock("inner") as second:
    print(first, second)</code></pre><p>A synchronous <code>with</code> statement accepts one or more items, optional assignment targets, and a parenthesized item list. Managers enter from left to right and successfully entered managers exit exactly once from right to left. The runtime resolves class-backed <code>__enter__</code> and <code>__exit__</code>, retains the bound exit before calling enter, and treats an <code>as</code> assignment failure as a protected suite fault.</p><p>Normal completion, <code>return</code>, <code>break</code>, and <code>continue</code> call <code>__exit__(None, None, None)</code> and ignore its result. A fault supplies its stable type, exact value, and the CS Profile traceback value <code>None</code>. A truthy exit result suppresses the fault; a false result reraises that same value, and a new exit fault routes through already-entered outer managers. Bound exits remain reachable across generator suspension and <code>close()</code>. The runtime preflights the implicit receiver plus all three explicit exit arguments before entering, so a capacity rejection cannot strand an entered manager.</p><p><code>contextlib</code>, generator-based context-manager decorators, descriptor or metaclass customization of special-method lookup, and runtime traceback objects remain later work.</p></section>
      <section class="manual-section"><h3>Coroutines and async protocols</h3><pre><code>async def read_all(source, manager):
    async with manager as opened:
        total = 0
        async for value in opened:
            total = total + await source.transform(value)
        return total</code></pre><p>Calling <code>async def</code> binds its arguments and returns an unstarted coroutine without running the body. <code>await</code> resumes native coroutines through ordinary CS486 call and return targets; a class-backed <code>__await__</code> iterator is accepted when it completes without yielding work to an external scheduler. Results and faults propagate exactly through the awaiting coroutine, and completion or <code>close()</code> makes later reuse fail explicitly.</p><p>The low-level driver surface is <code>coroutine.send(None)</code>, <code>coroutine.throw(exception)</code>, and <code>coroutine.close()</code>. There is no hidden <code>asyncio</code> event loop or second Python scheduler. <code>async for</code> resolves class-backed <code>__aiter__</code> and <code>__anext__</code>, awaits every step, consumes <code>StopAsyncIteration</code>, and preserves <code>break</code>/<code>continue</code>. <code>async with</code> awaits class-backed <code>__aenter__</code> and <code>__aexit__</code>; multiple managers enter left-to-right and exit exactly once right-to-left, including return and fault paths, and a truthy exit result suppresses the exact fault.</p><p>An <code>async def</code> containing <code>yield</code> returns an unstarted asynchronous generator. <code>__anext__()</code>, <code>asend()</code>, <code>athrow()</code>, and <code>aclose()</code> each return a single-use awaitable operation on the same CS486 process. Normal completion raises <code>StopAsyncIteration</code>, while <code>aclose()</code> injects <code>GeneratorExit</code>, runs pending finalizers exactly once, and rejects a yielded value. Eager asynchronous list, set, and dictionary comprehensions run inside a coroutine; asynchronous generator expressions remain lazy and can mix synchronous and asynchronous clauses.</p><p>Created coroutine and asynchronous-generator frames, locals, closure cells, handlers, pending control, protocol owners, and operation arguments remain in the same reachable managed heap and share the 64-call-depth, 4,096-item, and resumable instruction-slice limits. Custom awaitables that yield an external scheduler token and <code>asyncio</code> loops, tasks, futures, or host-I/O integration remain unavailable in this phase.</p></section>
      <section class="manual-section"><h3>Classes and instances</h3><p>Bounded <code>class</code> definitions evaluate zero or more bases exactly once from left to right in the enclosing scope. The suite runs in an isolated class namespace, then bounded C3 MRO construction and every authored <code>__set_name__</code> notification complete before the class name is published. Calling a class resolves inherited <code>__new__</code> through its C3 MRO. A plain <code>def __new__</code> is an implicit static method and receives the requested class plus original arguments exactly once. Strict <code>object.__new__(cls)</code> allocates a heap-accounted bare instance. If custom <code>__new__</code> returns an instance of the requested class or subclass, the returned instance type resolves <code>__init__</code> with the original arguments and must return <code>None</code>; any other value is returned unchanged without initialization. <code>object</code>, <code>isinstance</code>, and <code>issubclass</code> are available. Classes expose <code>__name__</code>, <code>__base__</code>, and stable read-only <code>__bases__</code>/<code>__mro__</code> tuples; instances expose <code>__class__</code>. Class and instance namespaces share the 4,096-entry collection ceiling and managed heap, and each C3 MRO admits 64 classes including the class itself and <code>object</code>.</p><h4>Cooperative super and class cells</h4><p>Methods and lambdas that reference <code>__class__</code> or builtin <code>super</code> capture one hidden class cell distinct from authored class-body, outer, and parameter bindings. Successful completion initializes it to the exact class after C3 and heap admission and before <code>__set_name__</code>; a rejected set-name completion clears it. <code>super()</code>, <code>super(type)</code>, and <code>super(type, instance-or-subclass)</code> continue after the named class in the receiver C3 MRO and reuse ordinary managed function, property, custom descriptor, and classmethod binding. Proxies expose stable read-only <code>__thisclass__</code>, <code>__self__</code>, and <code>__self_class__</code>; cooperative initialization may terminate at <code>object.__init__</code>.</p><p>Function and class decorator expressions run in the containing scope from top to bottom before defaults or class construction, then apply from bottom to top through the same bounded call path. The definition name is bound only after every decorator succeeds, with at most 4,096 decorators per definition.</p><h4>Descriptors and method variants</h4><p>Instance reads follow Python descriptor precedence: data descriptor, instance attribute, non-data descriptor, then inherited class value. Class-owned <code>__get__</code> receives the descriptor, the instance or <code>None</code>, and the most-derived accessed class; inherited <code>__set__</code> owns a store before the instance map changes.</p><pre><code>class Reading:
    def __set_name__(self, owner, name):
        self.name = name
    def __get__(self, instance, owner):
        return owner.__name__ if instance is None else instance._value
    def __set__(self, instance, value):
        instance._value = value

class Sensor:
    reading = Reading()

    @property
    def doubled(self):
        return self.reading * 2

    @staticmethod
    def clamp(value):
        return value if value &gt; 0 else 0

    @classmethod
    def model(cls):
        return cls.__name__</code></pre><p>Ordinary managed functions remain non-data descriptors. A method found through an instance class lookup binds its receiver and exposes read-only <code>__self__</code> and <code>__func__</code>; a function stored directly on an instance remains unbound. <code>property</code> supports getter, setter, and deleter replacement decorators, read-only <code>fget</code>/<code>fset</code>/<code>fdel</code> reflection, class access returning the property itself, and explicit <code>AttributeError</code> when an accessor is absent. <code>staticmethod</code> returns its wrapped value unchanged. <code>classmethod</code> binds the most-derived accessed class from either class or instance access. A class-owned <code>__delete__</code> or property deleter owns deletion before the instance map changes.</p><h4>Attribute hooks and deletion</h4><pre><code>class Config:
    def __getattr__(self, name):
        return "missing:" + name
    def __setattr__(self, name, value):
        object.__setattr__(self, name, value)

config = Config()
setattr(config, "cache", 41)
del config.cache
print(getattr(config, "cache", 42))</code></pre><p>Inherited <code>__getattribute__</code> runs for each explicit instance read. Only <code>AttributeError</code>, including one raised by a descriptor getter, proceeds to inherited <code>__getattr__</code>. Inherited <code>__setattr__</code> and <code>__delattr__</code> own explicit writes and deletions; the three <code>object</code> methods provide bounded base delegation. <code>getattr</code>, <code>setattr</code>, and <code>delattr</code> use the same path. A <code>getattr</code> default is returned only after lookup and <code>__getattr__</code> both end in <code>AttributeError</code>. Implicit special-method lookup remains class-owned and bypasses instance attribute hooks.</p><p><code>del</code> supports names, attributes, built-in list/dictionary items, list slices including extended slices, and nested list/tuple target lists. Targets delete left to right: a later fault retains earlier deletions and stops the remaining targets.</p><p>Descriptor and hook calls, pending stores/deletions/defaults, names, wrappers, owner classes, receivers, and bound methods use the ordinary CS486 call/return, exception, 64-call-depth, 4,096-item namespace ceiling, managed heap, and resumable instruction-slice paths. Metaclasses, custom generic subscription hooks, <code>__slots__</code>, module/metaclass attribute hooks, user-defined <code>__delitem__</code>, arbitrary native/asynchronous descriptor or attribute hooks, object-lifetime <code>__del__</code>, and operator protocols remain later work.</p></section>
      <section class="manual-section"><h3>Deferred annotations</h3><pre><code>def decode(packet: Packet) -&gt; Result:
    return Result(packet)

class Packet:
    payload: Payload

function_types = decode.__annotations__
field_types = Packet.__annotations__</code></pre><p>Parameter, return, and simple module/class variable annotations follow the Python 3.14 deferred model: the annotation expressions do not run when the definition or assignment executes. The first successful <code>__annotations__</code> access evaluates them in authored order and caches one mutable dictionary. Forward names may therefore be defined before access. If evaluation faults, no dictionary is cached and a later access retries. A circular importer that inspects a partially initialized module receives a fresh dictionary containing only annotation statements executed so far.</p><p>Annotation scopes may retain enclosing function cells. Class and method annotations may also read the completed immediately enclosing class namespace. A function-local annotation only makes a simple name local; it is never evaluated or stored. Non-simple attribute or subscript annotations preserve target and optional RHS behavior but never evaluate the annotation. Results share the 4,096-entry collection ceiling, 1,024-scope/64-nesting frontend ceilings, managed heap, call depth, resumable CS486 slices, and modeled cycle debt.</p><p>Generic functions, classes, and soft-keyword <code>type</code> aliases accept <code>T</code>, <code>*Ts</code>, and <code>**P</code> parameters. The completed object exposes one stable authored-order <code>__type_params__</code> tuple while the names remain private to its annotation scope. Function defaults and decorators use the containing scope; annotations, class bodies/bases, and alias values may retain the parameter cells. Bounds, tuple constraints, defaults, and alias <code>__value__</code> evaluate on first access through ordinary managed CS486 calls. Success caches with stable identity after heap admission; faults publish no cache and retry. Missing defaults share a <code>typing.NoDefault</code>-shaped sentinel.</p><p>Generic classes and aliases support bounded subscription such as <code>Box[int]</code>, <code>Alias[str]</code>, <code>list[int]</code>, and <code>dict[str, int]</code>. Each process caches a stable type-erased alias with read-only <code>__origin__</code>, <code>__args__</code>, and <code>__parameters__</code>. Open and nested aliases may be subscribed again; ordinary and <code>ParamSpec</code> defaults evaluate through managed CS486 calls, while one <code>TypeVarTuple</code> consumes a bounded variable-width argument segment. An explicit <code>ParamSpec</code> accepts list or tuple form; when it is the sole type parameter, expanded arguments normalize to one tuple-shaped slot. Parameterized class calls construct the original class, but parameterized aliases are rejected in <code>isinstance</code>/<code>issubclass</code> checks. The cache, nested substitution, and reachable heap share the 4,096-item and 64-level ceilings.</p><p>The runtime-owned <code>typing</code> core is available without a guest module file or host Python. It provides stable <code>Any</code>, <code>Never</code>, <code>NoReturn</code>, <code>Self</code>, <code>LiteralString</code>, and <code>NoDefault</code> values; bounded <code>Union</code>, <code>Optional</code>, <code>Literal</code>, <code>Annotated</code>, <code>Callable</code>, qualifier, guard, unpack, and concatenate forms; and runtime <code>TypeVar</code>, <code>ParamSpec</code>, and <code>TypeVarTuple</code> constructors. <code>get_origin</code> and <code>get_args</code> expose aliases, <code>Annotated.__metadata__</code> is read-only, and <code>cast</code>/<code>assert_type</code> preserve the supplied value without enforcing its type. <code>Optional[T]</code> reflects a canonical <code>Union</code> origin with <code>T</code> and a stable <code>NoneType</code> token.</p><pre><code>from typing import Annotated, Optional, TypeVar, get_args, get_origin

T = TypeVar("T", default=str)
maybe = Optional[int]
tagged = Annotated[int, "user-id"]
print(get_origin(maybe), get_args(maybe), tagged.__metadata__)</code></pre><p>The name <code>typing</code> is reserved before guest-file lookup, so a guest <code>typing.py</code> cannot shadow this intrinsic module.</p><p>Static-checker behavior, <code>get_type_hints</code>/<code>ForwardRef</code> evaluation, <code>TypedDict</code>/<code>NamedTuple</code> generation, overload registries, structural <code>Protocol</code> checks, <code>runtime_checkable</code>, annotationlib alternate formats, arbitrary <code>__class_getitem__</code>/metaclass hooks, <code>from __future__ import annotations</code> stringization, and writable/deletable reflection descriptors remain later work. This support does not add <code>pip</code> or <code>venv</code>.</p></section>
      <section class="manual-section"><h3>Structural pattern matching</h3><pre><code>match packet:
    case {"kind": "point", "x": x, "y": y} if x >= 0:
        print(x, y)
    case [head, *middle, tail]:
        print(head, middle, tail)
    case _:
        print("unsupported")</code></pre><p><code>match</code>, <code>case</code>, and <code>_</code> are soft keywords. The subject runs once, cases run from top to bottom, and a guard runs only after its complete pattern succeeds. Literal/singleton, dotted value, capture/wildcard, OR/AS, list-or-tuple sequence, built-in dictionary mapping with <code>**rest</code>, and C3 multiple-inheritance class patterns are supported. Class positional patterns use inherited <code>__match_args__</code>; keyword patterns use ordinary instance/class lookup.</p><p>A failed pattern or failed OR alternative publishes no partial captures. Successful captures are preflighted and published together before the guard; Python-visible bindings remain after a false or faulting guard. Patterns are limited to 4,096 nodes, nesting 64, and 4,096 items per construct. Custom sequence/mapping protocols and descriptor/metaclass customization remain unavailable.</p></section>
      <section class="manual-section"><h3>Template strings and string.templatelib</h3><pre><code>from string.templatelib import Interpolation, Template, convert
precision = 2
template = t"left={3!s:.{precision}f}; debug={ precision = }"</code></pre><p>Python 3.14 <code>t</code>/<code>T</code> and raw <code>tr</code>/<code>rt</code> literals evaluate each replacement and nested format field once from left to right, but retain the resulting value instead of formatting it. Authored expression text, debug equals, <code>s</code>/<code>r</code>/<code>a</code> conversion, escaped braces, and nested format text remain available through each interpolation.</p><p>The intrinsic <code>string.templatelib</code> module exposes read-only <code>Template</code> fields <code>strings</code>, <code>interpolations</code>, and <code>values</code>, plus read-only <code>Interpolation</code> fields <code>value</code>, <code>expression</code>, <code>conversion</code>, and <code>format_spec</code>. Direct constructors, <code>convert()</code>, iteration that omits empty strings, Template-to-Template concatenation, and the documented four-position Interpolation pattern are available without host Python, <code>pip</code>, or <code>venv</code>.</p><p>One parse admits 256 replacements including nested format fields. Runtime strings admit 65,536 code units, Template collections admit 4,096 items, and retained values, metadata, iteration state, and reflected tuples remain in the reachable managed heap under the 64-call-depth and outer CS486 slice limits. Custom <code>__format__</code>, the complete format mini-language, and descriptor/metaclass customization remain later work.</p></section>
      <section class="manual-section"><h3>Descriptors and method variants</h3><pre><code>class Reading:
    @property
    def value(self):
        return self._value

    @value.setter
    def value(self, replacement):
        self._value = replacement

    @classmethod
    def create(cls):
        return cls()</code></pre><p>Inherited class-owned descriptors follow Python's instance lookup order: data descriptor, instance attribute, non-data descriptor, then ordinary class value. A managed <code>__get__</code> receives the descriptor, the accessed instance or <code>None</code>, and the most-derived accessed class. A managed <code>__set__</code> owns the write and managed <code>__delete__</code> or a property deleter owns deletion before the instance map changes. Ordinary managed functions remain non-data descriptors; bound methods expose read-only <code>__self__</code> and <code>__func__</code>.</p><p>Class construction calls inherited <code>__set_name__</code> once for each authored class value in namespace order. Every notification must finish before the class is published, so a fault preserves an earlier binding. Intrinsic <code>property</code> supplies getter/setter/deleter replacement decorators and explicit missing-accessor <code>AttributeError</code>; <code>staticmethod</code> returns its wrapped value unchanged; <code>classmethod</code> binds the most-derived accessed class.</p><p>Explicit instance reads, writes, and deletions support inherited <code>__getattribute__</code>, AttributeError-only <code>__getattr__</code>, <code>__setattr__</code>, and <code>__delattr__</code>, plus bounded <code>object</code> delegation and <code>getattr</code>/<code>setattr</code>/<code>delattr</code>. <code>del</code> handles names, attributes, built-in list/dictionary items, list slices, and nested target lists from left to right.</p><p>Zero/one/two-argument <code>super</code> uses one hidden <code>__class__</code> cell, continues through the receiver C3 MRO, exposes read-only proxy reflection, and permits cooperative <code>object.__init__</code>. Descriptor/hook/super receivers, owner classes, pending stores/deletions/defaults, set-name snapshots, wrappers, and bound methods remain in reachable managed heap accounting under the 64-entry MRO and 64-call-depth ceilings, 4,096-item namespace ceiling, and outer CS486 slices. Metaclasses, <code>__slots__</code>, module/metaclass hooks, user-defined <code>__delitem__</code>, arbitrary native/asynchronous descriptor or attribute hooks, and object-lifetime <code>__del__</code> remain later work.</p></section>
      <aside class="manual-callout"><b>Iterator materialization</b><p>Materializing consumers resume every user-iterator, sequence-fallback, or generator step through ordinary bounded CS486 calls. They retain their input, accumulated values, and pending publication state until traversal and capacity validation complete.</p></aside>
      <section class="manual-section"><h3>6.3 Native modules</h3><table><thead><tr><th>Module</th><th>Purpose</th><th>Representative calls</th></tr></thead><tbody>
        <tr><td>os</td><td>Identity, time, events, timers, lifecycle</td><td>get_computer_id, clock, sleep, pull_event, queue_event, shutdown, reboot</td></tr>
        <tr><td>term</td><td>Fixed-cell terminal</td><td>write, clear, set_cursor_pos, set_text_color</td></tr>
        <tr><td>fs</td><td>Sandbox filesystem</td><td>read_file, write_file, exists, make_dir, get_size, get_free_space</td></tr>
        <tr><td>redstone</td><td>Six-sided digital / analog I/O</td><td>get_input, get_analog_input, set_output</td></tr>
        <tr><td>serial</td><td>Six full-duplex RS-232C ports</td><td>read, write, status</td></tr>
        <tr><td>spi</td><td>Bounded controller transfers</td><td>transfer</td></tr>
        <tr><td>i2c</td><td>Bounded addressed controller transfers</td><td>scan, transfer</td></tr>
      </tbody></table><p><code>shell</code> is deliberately absent from the public module table. It carries the authenticated terminal adapter and is granted only to the built-in shell program selected by an empty <code>/startup.py</code>; user Python cannot import it.</p></section>
      <section class="manual-section"><h3>6.4 Python modules and regular packages</h3><pre><code># /home/cs/pkg/__init__.py
answer = 40

# /home/cs/pkg/tools.py
from . import answer
result = answer + 2

# /home/cs/main.py
import pkg.tools
from pkg.tools import result
print(pkg.tools.result, result)</code></pre><p>Module lookup checks the importing file's directory, then <code>/lib/python</code> and <code>/usr/lib/computer-system/python</code>. A directory containing <code>__init__.py</code> is a regular package and wins over a same-name <code>.py</code> module. Dotted imports initialize every parent before its child and publish the child on the parent namespace. Without <code>as</code>, <code>import pkg.tools</code> binds <code>pkg</code>; an alias binds the resolved leaf. Absolute and explicit-relative <code>from</code> imports support aliases, parenthesized lists, selected submodules, and module-level wildcard exports through <code>__all__</code> or public names.</p><p>Every source module initializes once and receives stable <code>__name__</code>, <code>__package__</code>, and <code>__file__</code>; packages also receive <code>__path__</code>. Circular imports expose the exact partially initialized namespace. An escaping initialization fault removes the incomplete module and child publication before a later retry. The graph admits 64 modules including the main script, depth 16, and 512,000 aggregate UTF-8 source bytes. Namespace packages, zip imports, and dynamic import hooks are unavailable.</p></section>
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
      <aside class="manual-warning"><b>Frontend and RAM limits are explicit</b><p>One parse admits at most 512,000 decoded source code units, 131,072 tokens, 512 code units per identifier, 65,536 per literal, nesting depth 64, 16,384 statements, 256 parameters or call arguments, 4,096 items per construct, 256 formatted-string expressions, 1,024 scopes, and 4,096 symbols per scope. Class and instance namespaces admit 4,096 entries, and each C3 MRO admits 64 classes including the class itself and <code>object</code>. Exact capacity succeeds; capacity plus one fails explicitly.</p><p>Live globals, frames, collections, classes, instances, bound methods, strings, iterators, and native return values count toward RAM. One <code>GuestProcessMemoryGrant</code> owns the physical process reservation; reachable-graph accounting enforces the managed quota inside it without a second RAM lease. Overflow raises <code>MemoryError</code>; unreachable data is reclaimed under allocation pressure.</p></aside>`,
  },
  {
    id: "shell",
    html: `
      <header class="manual-page-header"><p class="manual-kicker">Chapter 04 · Command environment</p><h2>Computer System Bash</h2><p class="manual-lead">A bounded compatibility shell implemented inside the application layer. It is not host Bash and cannot escape to a native process.</p></header>
      <section class="manual-section"><h3>4.1 Grammar</h3><table><thead><tr><th>Feature</th><th>Syntax</th></tr></thead><tbody><tr><td>Pipeline</td><td><code>a | b</code></td></tr><tr><td>Redirection</td><td><code>&lt;</code>, <code>&gt;</code>, <code>&gt;&gt;</code></td></tr><tr><td>Control</td><td><code>&amp;&amp;</code>, <code>||</code>, <code>;</code></td></tr><tr><td>Expansion</td><td><code>$VAR</code>, <code>$?</code>, positional parameters</td></tr><tr><td>Scripts</td><td>if/else, for, while, functions, break, continue, return, source</td></tr></tbody></table></section>
      <section class="manual-section"><h3>4.2 Command families</h3><div class="manual-command-bank"><p><b>Files</b> pwd cd ls cat mkdir touch rm cp mv find stat df du quota</p><p><b>Text</b> echo printf head tail wc grep sed awk sort uniq tr cut seq nl md5sum base64</p><p><b>Archives</b> tar gzip gunzip zip unzip</p><p><b>Viewers</b> more less</p><p><b>Shell</b> sh bash source env export unset which type history time umask</p><p><b>Identity</b> whoami id groups login logout passwd su sudo getent</p><p><b>Accounts</b> useradd userdel usermod groupadd groupdel</p><p><b>Processes and sessions</b> ps top kill pgrep pkill killall jobs fg bg wait nice nohup watch tty who w last</p><p><b>System</b> hostname uname date uptime vmstat sleep crontab service telinit runlevel man apropos sync shutdown reboot</p></div></section>
      <section class="manual-section manual-grid-2"><div><h3>4.3 Startup</h3><pre><code>/etc/profile
/etc/bash.bashrc
~/.bashrc</code></pre><p>Files are created non-destructively and loaded in that order only after authentication succeeds.</p></div><div><h3>4.4 Example</h3><pre><code>for name in alpha beta alpha; do
  echo "$name"
done | sort | uniq</code></pre></div></section>
      <section class="manual-section"><h3>4.5 Boot and first login</h3><ol class="manual-procedure"><li><b>Reset the display.</b> Each OS boot clears the terminal cells, colors, and cursor before printing one boot banner. This does not format the guest disk.</li><li><b>Restore the system.</b> Files under <code>/etc</code>, <code>/home</code>, and <code>/usr</code>, including the account database, remain persisted; volatile <code>/tmp</code> is rebuilt.</li><li><b>Initialize credentials.</b> On a new CS-Linux installation, the boot banner and <code>New password:</code> prompt each appear once for <code>cs</code>. No simulated first-boot notice or startup transcript is printed. Enter 8–64 UTF-8 characters, then confirm at <code>Retype new password:</code>.</li><li><b>Authenticate later boots.</b> Existing installations show the readable <code>/etc/issue</code>, stop at <code>&lt;computer-id&gt; login:</code>, accept an unlocked username, and then ask for <code>Password:</code>. Three failures add a two-second guest delay.</li></ol><p>The password is not reversibly encrypted. CS-Linux stores a salted, bounded 512-round one-way SHA-256 payload in root-readable <code>/etc/shadow</code>; plaintext is never stored. Secret Web input is masked and excluded from history and Tab completion. User startup files run only after authentication succeeds.</p></section>
      <section class="manual-section"><h3>4.6 Users and superuser</h3><table><thead><tr><th>Identity or command</th><th>Contract</th></tr></thead><tbody><tr><td><code>cs</code></td><td>Initial administrator and protected boot-service identity, UID/GID 1000, home <code>/home/cs</code>, member of <code>sudo</code>.</td></tr><tr><td><code>root</code></td><td>The only UID 0 superuser. Its password starts locked and must be deliberately assigned before password login or <code>su</code> can select it.</td></tr><tr><td><code>passwd</code></td><td>Changes a permitted account's password without echoing or retaining plaintext.</td></tr><tr><td><code>sudo</code></td><td>Available only to <code>sudo</code> members; authenticates the caller and grants scoped effective privilege for the requested work.</td></tr><tr><td><code>su</code></td><td>Authenticates the target account and enters that account context until the nested session exits.</td></tr><tr><td><code>useradd</code>, <code>userdel</code>, <code>usermod</code></td><td>Superuser-only bounded user management backed by the account files; UID 1000 cannot be deleted, and active identities cannot be renamed or have their home moved.</td></tr><tr><td><code>groupadd</code>, <code>groupdel</code></td><td>Superuser-only bounded group management with referential checks.</td></tr></tbody></table><pre><code>sudo useradd alice
sudo passwd alice
sudo usermod -aG sudo alice
getent passwd alice
sudo -i
exit
su - alice
sudo userdel -r alice</code></pre><p><code>useradd</code> creates a mode-0700 home by default; use <code>-M</code> to skip it. <code>userdel -r</code> removes the home after the bounded account transaction. <code>sudo -i</code> enters a nested login context and <code>exit</code> restores the caller. A successful caller-password check is cached for five guest minutes; <code>sudo -k</code> clears it, while <code>sudo -n command</code> succeeds only when no prompt is needed. Scripts and pipelines cannot own login/logout or open a password prompt. MCP accepts only that non-interactive <code>sudo -n</code> form and never consumes a secret prompt. The final terminal disconnect cancels any secret prompt, clears the timestamp and nested identity state, cancels foreground, compiler, and queued MCP work that captured the session credentials, and returns to <code>login:</code>. Runtime finalization applies even when user Python ignores <code>terminal_closed</code>, so reconnecting cannot inherit an unattended root shell or stale elevated process.</p><p><code>/etc/passwd</code>, <code>/etc/group</code>, and <code>/etc/shadow</code> are the authoritative account database. Direct writes, links, moves, metadata changes, and deletion are rejected even for root; use the account commands so all three validated records commit together. A failed mutation leaves an explicit nonzero result and never a knowingly partial account. Leaving an elevated or switched session restores the caller, including after failure or cancellation.</p></section>
      <section class="manual-section"><h3>4.7 Prompt, MOTD, and persistent history</h3><p>An authenticated prompt uses <code>login@computer-id:path$</code>; effective UID 0 uses <code>#</code>. A later login reads the real <code>/etc/motd</code>, then shows the previous tty and stored wall-clock timestamp. Legacy records without wall time omit that one-time line instead of fabricating a date from guest ticks; <code>who</code> and <code>last</code> retain those records with a <code>tick N</code> fallback. The user's mode-0600 <code>.bash_history</code> retains at most 100 entries, 512 UTF-8 bytes per line, and 32 KiB total across logout, disconnect, and reboot. Password conversations never enter history.</p><pre><code>cs@c-xxxxxx:~$ tty
/dev/tty1
cs@c-xxxxxx:~$ who
cs@c-xxxxxx:~$ last</code></pre></section>
      <section class="manual-section"><h3>4.8 Processes, signals, and jobs</h3><p>PID 1 is <code>/sbin/cs-init</code>; <code>cs-login</code> owns a waiting getty, and the authenticated shell and admitted Python/CS486 work become explicit child processes. Every admitted compiler and CS process receives one physical memory reservation before it starts and binds that reservation to its PID. <code>ps -f</code> shows PID, PPID, UID, state, modeled cycles, start tick, and command. <code>top</code> is one bounded snapshot, not a refresh loop; its VIRT and RES columns are the same per-process virtual and resident values reported as <code>VmSize</code> and <code>VmRSS</code> in <code>/proc/&lt;pid&gt;/status</code>. <code>kill</code> supports HUP, INT, TERM, KILL, STOP, and CONT with guest ownership checks and protects PID 1.</p><pre><code>sleep 30 &amp;
jobs
ps -f
kill -STOP 4
bg %1
wait %1</code></pre><p>Only one interactive <code>sleep</code>, <code>python</code>/<code>micropython</code>, or <code>run</code> command may end in <code>&amp;</code>. Redirects, pipelines, scripts, aliases, functions, TUI or secret-prompt work, lifecycle commands, MCP submissions, and unsupported commands fail before side effects. Completed jobs remain zombies only until <code>wait</code> or foreground consumption reaps them.</p></section>
      <section class="manual-section"><h3>4.9 SysV init: inittab, runlevels, and rc.d</h3><p><code>/sbin/cs-init</code> (PID 1) reads <code>/etc/inittab</code> at boot: its <code>initdefault</code> entry selects the target runlevel, and the matching <code>respawn</code> entry owns the tty1 getty behind <code>cs-login</code>. The <code>S</code>-prefixed symlinks in that runlevel's <code>/etc/rcN.d</code> directory (<code>N</code> is <code>0</code>-<code>6</code>; <code>S</code> aliases <code>1</code>) start real rc.d services — today <code>syslog</code> and <code>cron</code> — before the login prompt appears, and each shows a genuine <code>Starting NAME... [ OK ]</code> or <code>[FAIL]</code> boot line. Runlevels 2-5 are identical multi-user aliases; <code>telinit 0</code> and <code>telinit 6</code> reuse the ordinary shutdown/reboot lifecycle, and <code>telinit 1</code> (or <code>S</code>) stops rc.d services for single-user mode.</p><pre><code>runlevel
sudo telinit 1
sudo telinit 3
sudo /etc/init.d/cron restart
service cron status</code></pre><p><code>runlevel</code> prints <code>PREVIOUS CURRENT</code> (<code>N</code> when no change has occurred yet). <code>telinit {0-6|S}</code> (superuser only; <code>init</code> is its alias) switches runlevels and starts/stops the rc.d services listed for the target level. Service mutation itself flows only through <code>/etc/init.d/NAME start|stop|restart</code>, a real interpretable script for each service; deleting a script or removing its execute bit makes that one service's direct invocation fail explicitly (127/126) without disturbing any other service. <code>service --status-all</code> and <code>service NAME status</code> remain read-only. <code>/etc/crontab</code> is the sandboxed system crontab (minute hour day-of-month month day-of-week user command, standard <code>*</code>/range/list/step syntax); the <code>cron</code> service re-reads it only when it starts or restarts.</p></section>
      <section class="manual-section"><h3>4.10 Proc, devices, and journals</h3><p><code>man TOPIC</code> and <code>apropos WORD</code> use the installed versioned guest index, never host man pages or the Internet.</p><p>One boot-scoped memory manager owns resident kernel, services, reclaimable buffers, and every guest process grant. <code>free</code>, <code>/proc/meminfo</code>, process status, and <code>top</code> render the same immutable bounded snapshot. <code>MemAvailable</code> equals free RAM plus buffers that admission can reclaim; a release refills those buffers toward their boot target. Requests above that value fail explicitly and do not leave a partial allocation.</p><pre><code>cat /proc/devices
cat /proc/services
cat /proc/self/status
cat /proc/4/cmdline
dmesg
sudo cat /var/log/messages
sudo cat /var/log/auth.log</code></pre><p><code>/proc/&lt;pid&gt;/cmdline</code>, <code>stat</code>, and <code>status</code>, plus <code>/proc/self/*</code>, <code>loadavg</code>, and mount/device/service views all come from one per-Computer OS state. The journal defaults to 256 records and 32 KiB total. The device registry includes tty/console/null/zero, the fixed disk, and the removable state-backed floppy; none are host device files.</p></section>
      <section class="manual-section"><h3>4.11 Sync, graceful stop, and safe recovery</h3><p><code>sync</code> crosses the real Computer persistence boundary. Shutdown and reboot stop new admission, signal owned work, drain already-admitted block I/O, save data, unmount, stop services/devices, then record <code>final sync requested</code> and that the intent is prepared for final persistence before saving the final cold projection. Only then may the machine power off or reboot. The two neutral terminal records survive cold restore exactly once; no unsaved success line is added after the callback. If marker creation or the callback fails, only that attempt's provisional markers are removed before the fault is published. A later automatic dirty save can retain the fault but cannot turn the failed final boundary into apparent success. Each phase has a 200-tick deadline, and a durability or drain failure faults visibly instead of claiming a clean stop.</p><p>The runtime has a one-shot safe-boot boundary that preserves but bypasses a broken <code>/startup.py</code> and records that choice in the boot journal. It is available only while the Computer is <code>crashed</code>. In Minecraft, open the crashed Computer normally to see the recovery instruction, then sneak while opening it to safe boot. On an attached Web Terminal, the crashed-state power control changes to safe boot. Both controls preserve the exact startup file; neither resets or edits it. Safe boot is unavailable from the guest shell and MCP command path.</p></section>
      <section class="manual-section"><h3>4.12 CS Make 1.0 and static libraries</h3><p>Current CS-Linux rootfs v19 installs <code>/usr/bin/make</code>, guest <code>ar</code>/<code>ranlib</code>, legacy word archives under <code>/usr/lib</code>, and model-matched <code>libc.csa</code>/<code>libcurses.csa</code>/<code>libm.csa</code> under <code>/usr/lib/cs-word32-v1</code> and <code>/usr/lib/cs-byte8-v1</code>. Current <code>CS486AR</code> v2 is a versioned bounded container with explicit data-model identity; v1 remains readable as the legacy word profile. It is not Unix <code>ar</code>, ELF, OMF, or a native library. <code>cc</code> and <code>ld</code> preserve ordered <code>-L</code>/<code>-l</code> operands and extract only demanded same-model members. CS-DOS does not install MAKE or these CS-Linux archive commands; its separate bounded project workflow remains CS PROGRAM LIST and PWB. Run <code>man make</code>, <code>man ar</code>, or <code>man ranlib</code> for exact limits.</p><pre><code>CC = cc
CFLAGS = -std=c11 -O1 -Wall -Werror -Iinclude
OBJECTS = main.o parser.o render.o
DEPS = main.d parser.d render.d

app: main.o libport.csa
\tld main.o -L. -lport -o $@
libport.csa: parser.o render.o
\tar rcs $@ $^
\tranlib $@
-include $(DEPS)
%.o: %.c
\t$(CC) $(CFLAGS) -MMD -MF $*.d -c $&lt; -o $@</code></pre><p>CS Make accepts an explicit Makefile or makefile, a project directory, dry-run, force-rebuild, and silent options, command-line variable overrides, explicit and indexed pattern rules, required or optional includes, <code>ifeq</code>/<code>ifneq</code>/<code>ifdef</code>/<code>ifndef</code> with <code>else</code>/<code>endif</code>, the four assignment forms, <code>.PHONY</code>, doubled dollar signs, and <code>$@</code>/<code>$&lt;</code>/<code>$^</code>/<code>$*</code>. Guest mtimes and bounded <code>CSMAKE2</code> records skip a target only while SHA-256 input, output, recipe, dependency, and toolchain identities match. A generated <code>.d</code> file enters the first successful target commit, so an identical second build is a no-op. Missing, evicted, legacy, or foreign-toolchain records rebuild safely; malformed state fails explicitly.</p><p>Planning is bounded to an aggregate 32,768 source characters, 256 lines, 64 included files at depth 8, 128 rules/patterns, 256 graph nodes, 512 edges, 64 prerequisites per rule, graph depth 32, 256 recipe lines, and 16 MiB of fingerprint input. Pattern lookup is indexed by target suffix and reports examined candidates and traversed edges. Parsing, planning, and fingerprint reads begin after one make PID and one 128 KiB guest RAM lease are admitted. At most one isolated recipe advances per scheduler admission; an inadmissible next build retains its fair queue position. The allowlist includes <code>as</code>, <code>cc</code>, <code>c++</code>, <code>ar</code>, <code>ranlib</code>, <code>ld</code>, inspection tools, and bounded filesystem/output utilities. Pipelines, redirects, chains, background or TUI/session/lifecycle work, recursive make, arbitrary configure scripts, parallel jobs, and every host command fail explicitly. Use a checked-in or pre-generated <code>config.h</code>; Autoconf, CMake, native configure processes, and host compilers are not available.</p></section>
      <section class="manual-section"><h3>4.13 CS System Git 1.0</h3><p>CS-Linux rootfs v12 installs <code>/usr/bin/git</code>; CS-DOS does not. This is an independent bounded Git-like VCS, not native Git. It supports local <code>init</code>, <code>status</code>, <code>add</code>, <code>rm</code>, <code>commit</code>, <code>log</code>, <code>show</code>, <code>diff</code>, <code>branch</code>, <code>switch</code>, <code>checkout</code>, <code>merge</code>, <code>tag</code>, <code>remote</code>, and local <code>config</code>. Repositories use <code>.git</code>, but the required <code>computerSystemVcs</code> extension, object encoding, and index intentionally prevent native-Git interoperability.</p><pre><code>mkdir project &amp;&amp; cd project
git init
printf 'build/\n*.tmp\n' &gt; .gitignore
git add . &amp;&amp; git commit -m base
git switch -c feature
git log --oneline</code></pre><p>SHA-256 blob, tree, and commit objects retain binary contents, executable mode, and symbolic-link targets. They do not retain uid/gid, mtime, hard-link identity, devices, or empty directories. <code>.gitignore</code>, <code>.git/info/exclude</code>, anchored and negated rules, <code>**</code>, character classes, and <code>git add -f</code> are bounded. Hooks, helpers, filters, submodules, LFS, signing, shallow history, alternate stores, config includes, and host execution are unavailable. Ownership, every <code>.git</code> symlink, object hash, checksum, path, and file/directory collision are validated before use; a conflicting merge reports failure without changing the index, refs, or worktree.</p><p>A repository tracks 256 paths, scans 512 entries, stores 2,048 objects, reads 256 history commits, and caps one object at 384 KiB. Each command owns a 1 MiB transient RAM lease; bounded payload, hash, object, and transaction buffers are processed sequentially, and bytes route through credentialed guest block I/O. <code>git remote</code> stores credential-free <code>cs+tcp://</code>, <code>ssh://</code>, or <code>https://</code> metadata. <code>clone</code>, <code>fetch</code>, <code>pull</code>, and <code>push</code> fail explicitly until authenticated guest TCP/IP exists; no host Git or host socket is used. The future port separates guest peer verification, scoped challenge-response credentials, capability negotiation, per-tick and total transfer ceilings, chunked object readers, quarantine verification/promotion, and compare-and-swap ref updates. Every terminal path releases credentials, readers, quarantine, and transport state exactly once; uncertain acknowledgement ends in <code>unknown</code> for ref reconciliation before retry.</p></section>
      <section class="manual-section"><h3>4.14 Bounded text processing and archives</h3><pre><code>sed -n '/error/p' system.log
awk -F : '$3 == 0 { print $1 }' /etc/passwd
tar -cf project.tar project
tar -tf project.tar
gzip -k project.tar
zip project.zip project
unzip -l project.zip</code></pre><p><code>sed</code> supports <code>-n</code>, <code>-e</code>, numeric, last-line, and pattern addresses, plus bounded <code>p</code>, <code>d</code>, and <code>s</code> commands. <code>awk</code> supports <code>-F</code>, <code>BEGIN</code>/<code>END</code>, pattern and comparison rules, <code>print</code>/<code>printf</code>, <code>$0</code>-<code>$64</code>, <code>NR</code>, and <code>NF</code>. Both use the guest's own bounded pattern parser—literals, dot, star, anchors, and character classes—not host JavaScript regular expressions. Programs are limited to 4,096 bytes and 32 rules; input is limited to 256,000 bytes and 4,096 records.</p><p>The filesystem stores and accounts arbitrary bytes, so archive members survive snapshot and copy without UTF-8 conversion. <code>tar</code> creates, lists, and atomically extracts bounded ustar archives. <code>gzip</code>/<code>gunzip</code> use deterministic RFC 1952 stored-DEFLATE streams; other DEFLATE block methods fail explicitly. <code>zip</code>/<code>unzip</code> support standard UTF-8, unencrypted method-0 archives; encryption, ZIP64, and compressed methods fail explicitly. One archive is at most 1 MiB, with 512 entries, 32 operands, path depth 32, and 4 MiB expanded data. Extraction rejects absolute paths, traversal, duplicates, symlink pivots, conflicts, and malformed checksums before committing any entry.</p></section>
      <section class="manual-section"><h3>4.15 Cron, priority, detachment, and bounded watching</h3><pre><code>crontab -l
sudo crontab -e
sudo /etc/init.d/cron restart
nice -n 10 run worker
nohup sleep 300 &amp;
watch -n 2 -c 10 -- service cron status</code></pre><p><code>crontab</code> deliberately has no per-user spool: <code>-l</code> reads the single <code>/etc/crontab</code>, and root <code>-e</code> opens that file in the existing <code>vi</code>. The cron service parses at most 64 seven-field system entries when it starts or restarts, resolves the named account through the authoritative account database, uses the deterministic guest calendar, bounds its pending queue to 64, and admits at most one due command per tick.</p><p><code>nice</code> accepts values -20 through 19; only root may request a negative value. Its NI value appears in <code>ps</code>/<code>top</code> and scales the process's scheduler slice without bypassing the global budget. <code>nohup</code> is admitted only as a wrapper around the shell's supported bounded background jobs ending in <code>&amp;</code>; it reparents them to PID 1 and protects them from terminal SIGHUP, while shutdown signals still finalize them. <code>watch</code> requires a finite <code>-c</code> count (default 300, maximum 3,600), runs at most once per guest interval from 1 to 3,600 seconds, and uses the foreground cancellation/finalization path. It is not an unbounded screen refresh loop.</p></section>
      <section class="manual-section"><h3>4.16 NetHack for CS-Linux</h3><p>Rootfs v14 ships the reduced guest-authored <code>/usr/games/nethack</code>, built from the same nine CS C 2.0 modules, <code>nethack.h</code>, and explicit-rule Makefile stored under <code>/usr/src/nethack</code>. It is not an unmodified upstream NetHack port and does not use a native TypeScript game session, Python script, host compiler, or host filesystem.</p><pre><code>nethack --help
man 6 nethack
mkdir ~/nethack
cp /usr/src/nethack/* ~/nethack/
cd ~/nethack &amp;&amp; make
sudo make install PREFIX=/usr/local
nethack</code></pre><p>The game has ten bounded dungeon depths, the Amulet goal, depth-gated monsters and items, hunger and experience, deterministic random state, and a 78 by 21 terminal map. Move with <code>hjklyubn</code>, use <code>&lt;</code>/<code>&gt;</code> for stairs, press uppercase <code>S</code> to save and exit, and enter <code>#quit</code> (or <code>q</code>) to abandon unsaved progress.</p><p>Only explicit <code>S</code> saves. The path comes from the immutable hosted-process <code>HOME</code> snapshot and is <code>~/.nethack.sav</code>, mode 0600. A sibling temporary file is closed and atomically renamed over the canonical record; missing or invalid HOME, malformed records, disk capacity, DAC, interruption, disconnect, and terminal close never become an implicit save. Each account resolves its own HOME with its launch credentials. User PATH checks <code>/usr/local/games</code> before <code>/usr/games</code>, so an administrator-installed guest build shadows the stock binary. Use <code>sha256sum</code> to compare the clean guest build with the shipped artifact.</p></section>
      <aside class="manual-callout"><b>Account transaction bounds</b><p>The legacy name <code>computer</code> is permanently reserved for both users and groups, keeping full migration unambiguous. A user may have at most 32 supplementary groups; adding a 33rd is rejected without changing any account file. Default <code>useradd</code> recursively provisions missing home ancestors as one all-or-nothing operation, so a failure leaves neither the account nor a partial home tree.</p></aside>
      <aside class="manual-callout"><b>Calendar safety</b><p>CS-Linux and CS-DOS preserve four-digit UTC years. <code>date</code>/<code>DATE</code> do not apply a two-digit-year pivot, correctly represent 2000-02-29, and use timestamps beyond the signed 32-bit 2038 boundary.</p></aside>
      <aside class="manual-callout"><b>Cost ownership</b><p>Commands, script lines, loop iterations, and output create bounded cycle debt. The shell cannot become a free execution path around the CPU model. Interactive command dispatch and <code>.sh</code> scripts currently use the bounded shell interpreter; unlike Python, scripts have not yet moved to CS486 instructions.</p></aside>`,
  },
  {
    id: "basic",
    html: `
      <header class="manual-page-header"><p class="manual-kicker">Chapter 11 · CS QBASIC 1.0</p><h2>CS QBASIC 1.0 DOS editor and bounded source</h2><p class="manual-lead">CS-DOS alone ships the independent, sandboxed <code>QBASIC.EXE</code>. It targets Microsoft QBasic 1.1 command and source behavior where listed here, but it is not Microsoft's binary, help database, artwork, 16-bit x86 runtime, or a native DOS interrupt environment. Current CS-Linux exposes neither <code>basic</code> nor <code>basicc</code>.</p></header>
      <section class="manual-section"><h3>11.1 Starting CS QBASIC 1.0</h3><pre><code>QBASIC                         REM open the Welcome dialog
QBASIC C:\\WORK\\DEMO.BAS       REM open an existing or new buffer
QBASIC /RUN C:\\WORK\\DEMO.BAS  REM compile, run, and return to the IDE
QBASIC /EDITOR C:\\README.TXT  REM the same editor engine used by EDIT</code></pre><p>The accepted switches are <code>/B</code>, <code>/EDITOR</code>, <code>/G</code>, <code>/H</code>, <code>/MBF</code>, <code>/NOHI</code>, and <code>/RUN</code>. Unknown and duplicate switches, more than one filename, <code>/RUN</code> without a file, and <code>/EDITOR</code> combined with <code>/RUN</code> fail visibly. <code>/HELP</code> is not invented.</p></section>
      <section class="manual-section"><h3>11.2 WorkBench, EDIT, keyboard, and mouse</h3><p><code>EDIT file</code> and <code>QBASIC /EDITOR file</code> use the bounded five-menu EDIT session for buffer ownership, Open/Save As browsing, save/error handling, search, undo, dirty transitions, pointer hit testing, drag selection, and <code>Ctrl+C</code>/<code>Ctrl+X</code>/<code>Ctrl+V</code>. Ctrl+O and Ctrl+Shift+S browse strict DOS 8.3 entries on C: or A: without reading host files. Directories, wildcard filters, scrolling, empty/not-ready states, and removable-media changes are explicit. Web Terminal mouse events are accepted only from the current writer; cell coordinates and sequences are checked, moves are coalesced, and pressed buttons are released on takeover, range loss, and disconnect.</p><p>EDIT, CS QBASIC, CS ASM, and CS C/C++ share the VGA font, exact DOS palette, two leading menu-bar cells, a continuous left document border, centered document title, scrollbars, a one-leading-cell cyan footer, reversed active menu item, and gray dialog with a black shadow. The Web bridge preserves F1 through F12, Ctrl/Shift/Alt function-key combinations, Ctrl+Shift shortcuts, selection navigation, and Alt+Left. Bare Alt first invokes F10/File, so a Chrome-reserved Alt+F does not leave the DOS menu unreachable; clicking a heading remains an equivalent path. While a DOS editor is active, the transparent keyboard textarea does not receive pointer events, so it cannot cover the menu or the document cursor row. A click on a QBASIC/WorkBench heading dismisses Welcome and opens that menu in the same action.</p><table><thead><tr><th>Environment</th><th>Run/build result</th></tr></thead><tbody><tr><td>CS QBASIC F5 / Ctrl+F5 / Shift+F5 / <code>/RUN</code></td><td>Run saved BASIC source transiently and return output to the IDE; no OBJ, CSX, or EXE is created</td></tr><tr><td>CS ASM / CS C/C++ F7 / Ctrl+F7</td><td>Build or rebuild the selected source/Program List to a persistent CSX</td></tr><tr><td>F3 / Shift+F3 in F4 Output</td><td>Open the next or previous bounded compiler file/line/column</td></tr><tr><td>F5 / F8 / F9 in ASM or C/C++</td><td>Start/continue, trace one instruction, or toggle the current-EIP breakpoint</td></tr><tr><td>Escape</td><td>Return from the debugger pane to source while retaining the paused debuggee</td></tr></tbody></table><p>CS QBASIC therefore exposes File/Edit/View/Search/Run/Options/Help and does not show Make or Debug. CS ASM and CS C/C++ expose File/Edit/View/Search/Make/Run/Debug/Options/Help. Help is right-aligned in every bar and the active heading is reversed instead of receiving a parenthesized mnemonic suffix.</p></section>
      <section class="manual-section"><h3>11.3 Current source subset</h3><table><thead><tr><th>Area</th><th>Accepted forms</th></tr></thead><tbody><tr><td>Numeric scalars</td><td>Case-insensitive assignment, scalar <code>DIM</code>, LONG-range decimal, <code>&amp;H</code> hexadecimal, and <code>&amp;O</code> octal values</td></tr><tr><td>Output</td><td><code>PRINT</code> / <code>?</code>, numeric expressions, quoted literals with doubled quotes, comma/semicolon separation</td></tr><tr><td>Expressions</td><td>Arithmetic, integer division, <code>MOD</code>, comparisons, <code>NOT</code>, <code>AND</code>, <code>OR</code>, and <code>XOR</code></td></tr><tr><td>Control flow</td><td>Numbered or named <code>GOTO</code>/<code>GOSUB</code>/<code>RETURN</code>, inline <code>IF THEN ELSE</code>, <code>FOR/NEXT</code>, <code>WHILE/WEND</code>, <code>DO/LOOP</code>, and <code>EXIT FOR/DO</code></td></tr><tr><td>Termination</td><td><code>END</code>, <code>STOP</code>, or <code>SYSTEM</code></td></tr></tbody></table><p>Source is capped at 4,096 lines and 8,192 statements, with 1,024 variables, 128 expression tokens, 40-character variable names, and bounded runtime instructions, memory, stack, and output.</p></section>
      <aside class="manual-callout"><b>One WorkBench state and one diagnostic truth</b><p>WorkBench presents exactly one primary Source, Output, or Debugger surface plus at most one permitted overlay. Debugger menus and Program Lists remain composable where supported; selecting an editor dialog returns to Source first so the dialog cannot be hidden. Product-scoped commands keep QBASIC source-run separate from CS ASM/C/C++ build and rebuild shortcuts. Compiler code, authored path, span, and bounded notes remain structured; Output text and F3/Shift+F3 navigation derive from that same record, so DOS display formatting or wording changes cannot redirect navigation.</p></aside>
      <section class="manual-section"><h3>11.4 Complete example</h3><pre><code>10 LET TOTAL = 0
20 FOR I = 1 TO 100
30 LET TOTAL = TOTAL + I
40 NEXT I
50 PRINT TOTAL
60 END</code></pre></section>
      <aside class="manual-warning"><b>Compatibility and sandbox boundary</b><p>String variables and expressions, arrays, <code>INPUT</code>, <code>DATA</code>/<code>READ</code>, floating point, files, <code>SUB</code>/<code>FUNCTION</code>, Immediate-window execution, source-level debugging, program mouse APIs, sound, and graphics are not yet implemented. Unsupported QuickBASIC/GW-BASIC statements fail with a source line. <code>SHELL</code>, <code>INP</code>/<code>OUT</code>, <code>PEEK</code>/<code>POKE</code>, <code>CALL ABSOLUTE</code>, and QBasic access to COM/LPT never reach a host process, path, port, memory address, or interrupt.</p></aside>`,
  },
  {
    id: "c-family",
    html: `
      <header class="manual-page-header"><p class="manual-kicker">Chapter 12 · CS C/C++ 1.0</p><h2>CS C/C++ 1.0 for the active CS486/CS386 target</h2><p class="manual-lead">Dedicated bounded tokenizers and parsers accept deliberately small, auditable C and C++ subsets. They do not invoke GCC or Clang and do not claim ISO language or x86 binary compatibility.</p></header>
      <section class="manual-section manual-grid-2"><div><h3>12.1 C</h3><pre><code>cc --version
cc program.c -o program
cc -mbyte8 binary.c -o binary
CSCC PROGRAM.C</code></pre><p>The default <code>cs-word32-v1</code> profile uses <code>CHAR_BIT=32</code>: signed/unsigned <code>char</code>, <code>short</code>, <code>int</code>, <code>long</code>, and pointers occupy one word; <code>long long</code>, <code>int64_t</code>, and their unsigned forms occupy two low-word-first words. <code>-mbyte8</code> or <code>-mdata-model=cs-byte8-v1</code> selects 8-bit char, 16-bit short, 32-bit int/long/pointers, 64-bit long long, byte-stride pointers, natural little-endian aggregate padding, packed strings, and exact <code>uint8_t</code>/<code>uint16_t</code>. <code>-mword32</code> selects the default explicitly. The bounded subset includes promotions and truncation, unsigned arithmetic, <code>if</code>/<code>switch</code>/loops, checked <code>goto</code> labels, file/local <code>static</code>, <code>extern</code>, qualifiers, pointers and validated function pointers, fixed multidimensional arrays, pointer-passed structs, unions, designated initializers, compound literals, final flexible arrays, deterministic 32-bit bit-fields, enums, typedefs, <code>_Bool</code>, <code>_Static_assert</code>, <code>alignof</code>, <code>sizeof</code>, and casts. Up to 32 physical argument words use <code>cs486-cc2</code>; two-word integer or binary64 results return in EDX:EAX, indirect calls validate exact executable entries, and <code>&lt;stdarg.h&gt;</code> bounds every variadic read. Rootfs v19 installs matching <code>libc</code>, <code>libcurses</code>, and <code>libm</code> archives under <code>/usr/lib/cs-word32-v1</code> and <code>/usr/lib/cs-byte8-v1</code>. <code>&lt;cs/byte.h&gt;</code> explicitly packs octets for word programs but does not change word <code>unsigned char *</code> semantics. This is not native x86 layout or ABI compatibility.</p></div><div><h3>12.2 C++</h3><pre><code>c++ --version
c++ program.cpp -o program
CSCPP PROGRAM.CPP
PWB PROGRAM.CPP</code></pre><p>The C subset plus <code>std::cout &lt;&lt; value &lt;&lt; std::endl</code>. Classes, inheritance, references, overloads, namespaces, templates, <code>constexpr</code>, exceptions, RTTI, virtual dispatch, concepts, and the ISO standard library are not implemented.</p></div><p>Under CS-DOS, C-only <code>CSCC</code>, C++-only <code>CSCPP</code>, and extension-selecting <code>PWB</code> open the full-screen CS C/C++ 1.0 WorkBench. F2 saves, F7 builds the current file or selected Program List, Ctrl+F7 rebuilds all Program List sources, Ctrl+F5 runs the exact last successful non-stale <code>.CSX</code>, Shift+F5 builds and runs, and F4 toggles bounded output. F3 and Shift+F3 navigate output diagnostics. F5 starts or continues the instruction debugger directly in WorkBench; the <code>DEBUG</code> command is optional. F8 traces and F9 toggles a current-EIP breakpoint. Source-line stepping and local-variable reconstruction remain unavailable.</p></section>
      <section class="manual-section"><h3>12.3 Deterministic floating point and libm</h3><pre><code>#include &lt;math.h&gt;
#include &lt;stdio.h&gt;
int main(void) {
  printf("%.3f\n", sqrt(2.0));
  return 0;
}</code></pre><p><code>float</code> is IEEE-754 binary32 and <code>double</code> is binary64; <code>long double</code> is an alias of <code>double</code>. The word model reports sizes 1/2 word units and the byte model reports 4/8 bytes. Parsing, constant folding, arithmetic, casts, comparisons, signed zero, subnormals, infinities, canonical quiet NaNs, and round-to-nearest ties-to-even use the same bounded integer/rational software core. Binary64 arguments occupy two low-word-first physical words and return in EDX:EAX; variadic <code>float</code> promotes to <code>double</code>. Link guest math with <code>-lm</code>. The initial profile includes <code>fabs</code>, <code>copysign</code>, <code>floor</code>, <code>ceil</code>, <code>trunc</code>, <code>round</code>, <code>fmod</code>, <code>sqrt</code>, <code>ldexp</code>, <code>frexp</code>, <code>modf</code>, and classification. <code>%f</code> has at most 18 fractional places. Trigonometric, exponential, logarithmic, <code>pow</code>, complex, mutable rounding modes, x87/SIMD, host libm, and fast-math are not implemented.</p></section>
      <section class="manual-section"><h3>12.4 Summation in C</h3><pre><code>int main() {
  int total = 0;
  for (int i = 1; i &lt;= 100; i++) {
    total = total + i;
  }
  printf("%d\\n", total);
  return 0;
}</code></pre></section>
      <section class="manual-section"><h3>12.5 Preprocessor, frontend, CSIR, and register allocation</h3><p>The practical token preprocessor supports quoted/angle <code>#include</code>, object/function <code>#define</code>, <code>#undef</code>, conditional compilation, <code>defined</code>, physical-line continuations, rescanning, <code>#</code> stringification, <code>##</code> token pasting, and <code>#error</code>. Linux accepts <code>-I/-D/-U</code>; DOS also accepts <code>/I,/D,/U</code> and the <code>INCLUDE</code> environment variable. Include reads use current guest credentials only. Include depth/cycles, macro work, conditional depth, source/tokens, and diagnostics are bounded; <code>#pragma</code> and variadic macros fail explicitly.</p><p>The source-character and token ceilings are checked before arrays grow. Tokens retain include and macro-expansion provenance; the parser builds a typed AST with lexical scopes and rejects undeclared, duplicate, malformed, or unsupported constructs before producing an object. A function declaration or prototype must precede each call, and an in-scope local with the same name shadows the function and is not callable.</p><p>The typed AST lowers to CSIR. Every computed value has one SSA definition, while mutable C locals remain explicit <code>load-local</code>/<code>store-local</code> operations: this is value SSA, not memory SSA. A bounded verifier checks types, definitions, dominance, control-flow targets, and explicit block terminators. Pass-capped deterministic optimization performs constant folding, copy propagation, unreachable-block cleanup, and dead-pure-value elimination.</p><p>The backend uses bounded deterministic linear-scan allocation and checked stack spills. ESP and EBP are reserved, values live across a call are conservatively spilled, and locals occupy EBP-relative stack-frame slots. Graph coloring is not required and is not implemented. Inspect the typed symbols, relocations, and final instruction stream with <code>nm</code> and <code>objdump</code>.</p></section>
      <section class="manual-section"><h3>12.6 Objects, static linking, and Python imports</h3><pre><code>cc -c main.c -o main.o
as -c fast.asm -o fast.o
nm main.o
ld main.o fast.o -o program
 run --stats program</code></pre><p>New writers emit model-declared version 4 of <code>CS486OBJ</code>, version 5 of <code>CS486</code>, and version 2 of <code>CS486AR</code>. Objects carry ordered <code>.text</code>, <code>.rodata</code>, <code>.data</code>, and <code>.bss</code> sections, typed local/global/undefined symbols, bounded signatures such as <code>(i32,i32)-&gt;i32</code> and <code>()-&gt;void</code>, alignment, initialized bytes, and structured instruction/data relocations; readers retain legacy word objects and executables. <code>nm</code>, <code>objdump</code>, and <code>csdb</code> report the identity. Linking or archive selection rejects mixed models before layout or output mutation. <code>extern int fast(int, int);</code> and the limited C++ spelling <code>extern "C" int fast(int, int);</code> create the same unmangled undefined text-function symbol. Linkage blocks and other language linkages are rejected. Known parameter/return-signature conflicts stop the link deterministically. ASM may opt in with <code>signature fast, i32, i32, i32</code> or remain untyped for legacy compatibility. Callers push arguments right-to-left and clean the stack; callees preserve ESI/EDI/EBP and return integers through EAX.</p><p>Word strings remain decoded 32-bit words plus a zero word; byte strings are packed values plus a NUL byte. Constant globals use <code>.data</code>, zero-initialized globals use <code>.bss</code>, and <code>extern</code> objects retain structured relocations across translation units. Format units, conversions, aggregate storage, initialized bytes, <code>%s</code> reads, and worst-case output are capped before installation.</p><p>Linked static bytes are installed in low RAM before execution, and the aligned end of all static data becomes the stack floor. Python static extensions remain explicitly <code>cs-word32-v1</code>; a byte-profile object is rejected rather than converted. A valid word object exposes only the zero-argument EAX-return text-function ABI. Every imported machine instruction is charged to the same CS486 process.</p></section>
      <section class="manual-section"><h3>12.7 Cross-profile executable compatibility</h3><p><code>as</code>, <code>cc</code>, and <code>c++</code> write the same validated <b>Computer System CS486 format family</b> under CS-Linux and CS-DOS, but current artifacts also declare <code>cs-word32-v1</code> or <code>cs-byte8-v1</code>. The two models cannot be linked or imported together. CS QBASIC 1.0 lowers its supported DOS-only source subset to a transient instance of the same process. <code>CS486OBJ</code> is not Linux ELF or OMF, and <code>CS486</code> is not a native DOS <code>.COM</code>/<code>.EXE</code> or host x86 machine code. Neither profile invokes a host assembler, linker, or loader. A complete compatible CS486 executable can run after transfer to a valid destination path; the destination Computer supplies CPU timing, cache or bus behavior, RAM ceiling, and filesystem rules.</p><p>There is currently no guest command for copying a file between two different Computer identities and no shared guest disk. Dynamic linking, native object ingestion, native GDB or DOS DEBUG emulation, source-level debug metadata, PIC/IRQ/IDT execution, BIOS/DOS interrupts, and native COM/EXE loading are not implemented. A legacy version-4 word executable or current version-5 model-declared executable launched by guest PATH or <code>run</code> receives bounded immutable arguments, environment, credentials, declared heap, standard streams, and CS ABI 1.0. <code>&lt;cs/fs.h&gt;</code> transfers word characters for <code>cs-word32-v1</code> and exact bytes for <code>cs-byte8-v1</code>, with no implicit UTF-8 or newline conversion. Standard output is line-buffered, <code>fflush(stdout)</code> is explicit, stderr is unbuffered, and all pending owned state is finalized once on return, exit, signal, terminal close, or shutdown. The same syscalls reject in non-hosted, background, DOS, debugger, and Python-extension contexts. Mouse events, sound, windows, arbitrary graphics modes, host devices, and native operating-system calls remain unavailable.</p></section>
      <section class="manual-section"><h3>12.8 Restricted inline assembly</h3><pre><code>int answer = 0;
asm("mov eax, 6");
asm("mul eax, 7");
asm("store [answer], eax");</code></pre><p>Inline assembly executes at a statement boundary. It may use ordinary arithmetic and checked memory operations. Labels, branches, CALL/RET, PUSH/POP, HALT, and ESP/EBP access are rejected. Dynamic libraries are not yet supported.</p></section>
      <section class="manual-section"><h3>12.9 CS-DOS Program Lists</h3><pre><code>CS PROGRAM LIST 1.0
SOURCE=MAIN.C
SOURCE=FAST.CPP
SOURCE=VIDEO.ASM
OBJECT=VENDOR.OBJ
INCLUDE=INCLUDE
DEFINE=FEATURE=1
ENTRY=main
OUTPUT=DEMO.CSX
LISTING=DEMO.LST
MAP=DEMO.MAP</code></pre><p>Select this <code>.CSP</code> file with Make &gt; Set Program List. F7 fingerprints every source, transitive included header, compile option, compiler identity, and authored object, then reuses unchanged project-owned objects. Ctrl+F7 rebuilds all source units. A successful build installs objects, executable, optional listing/map, and its <code>.CBR</code> ownership record transactionally. Failure preserves the prior executable but makes Run Last stale. Clean removes only recorded generated paths. Duplicate/canonicalized paths, generated OBJ collisions, authored inputs, existing unowned outputs, malformed records, and capacity-plus-one lists fail before partial mutation.</p></section>
      <section class="manual-section"><h3>12.10 Hosted libc and libcs-curses</h3><pre><code>cc -c app.c -o app.o
cc -c /usr/src/libcs-curses/curses.c -o curses.o
cc -c /usr/src/cs-libc/libc.c -o libc.o
ld app.o curses.o libc.o -o app
run app</code></pre><p>Rootfs v17 provides bounded hosted headers for strings, conversion, sorting/searching, exit handlers, getopt, current directories, directory iteration, metadata, temporary files, wall-clock time, synchronous <code>signal</code>/<code>raise</code>, and a fixed-format printf family. Guest wall time is separate from deterministic CPU ticks. Filesystem calls use the credentialed block-I/O lane; a directory handle snapshots at most 256 entries once and returns them in O(1) steps, with at most eight open directory handles per process.</p><p>This is a documented CS C profile rather than a native ISO/POSIX runtime. Aggregate values are not passed or returned by value, so <code>div</code> writes to a supplied <code>div_t *</code> and <code>vsnprintf</code> accepts <code>va_list *</code>. Signal handlers run only for synchronous guest <code>raise</code>; unhandled or host-delivered termination remains owned by the runtime. Normal <code>main</code> return runs bounded <code>atexit</code> handlers. Sorting uses deterministic O(N log N) heapsort and search is O(log N).</p><p><code>libcs-curses</code> exposes one bounded 80×25 character screen, <code>stdscr</code> plus seven allocated windows, 16 color pairs, blocking key input, and one terminal frame per <code>refresh</code>/<code>wrefresh</code>. The library admits at most 1,024 formatted words and returns <code>ERR</code> or <code>ENOMEM</code> at capacity. Rootfs v16 stays frozen and does not gain these v17 headers or sources.</p></section>
      <aside class="manual-callout"><b>Manual optimization</b><p>Reduce repeated DIV/MOD, simplify constant expressions, remove redundant variables, and compare the generated instruction stream. A shorter source file is not necessarily a cheaper executable.</p></aside>`,
  },
  {
    id: "io-files",
    html: `
      <header class="manual-page-header"><p class="manual-kicker">Chapter 05 · Filesystem interface</p><h2>Filesystem and storage</h2><p class="manual-lead">Minecraft behavior is exposed through bounded adapters. The domain/runtime core does not import Minecraft APIs.</p></header>
      <section class="manual-section"><h3>5.1 Linux layout</h3><table><thead><tr><th>Path</th><th>Role</th></tr></thead><tbody><tr><td>/etc</td><td>Root-owned system configuration, account files, MOTD, and Bash startup</td></tr><tr><td>/etc/inittab</td><td>SysV init: sysinit/wait/respawn/initdefault entries selecting the boot runlevel</td></tr><tr><td>/etc/init.d, /etc/rcN.d</td><td>Real per-service start/stop/restart/status scripts and the SNN/KNN symlink farm per runlevel</td></tr><tr><td>/etc/crontab</td><td>Sandboxed system crontab, re-read on cron service start/restart</td></tr><tr><td>/dev</td><td>State-backed guest device identities</td></tr><tr><td>/proc</td><td>Dynamic CPU, memory, process, service, device, version, uptime, load, and mount views</td></tr><tr><td>/run</td><td>Volatile runtime mount</td></tr><tr><td>/tmp</td><td>Volatile mode-1777 sticky working files</td></tr><tr><td>/usr/share/man</td><td>Installed versioned manual index notice</td></tr><tr><td>/var/log</td><td>Bounded messages and authentication journal views</td></tr><tr><td>/startup.py</td><td>Mode-0644 desktop boot source owned and executed by the authoritative UID 1000 account</td></tr><tr><td>/home/cs</td><td>Initial UID/GID 1000 user home and mode-0600 shell history</td></tr><tr><td>/root</td><td>UID/GID 0 superuser home</td></tr></tbody></table><p>CS-Linux persists mode, UID, GID, modification time, symbolic links, hard-link groups, deletion tombstones, and a cold OS-runtime projection. Older snapshots without these optional fields remain readable and receive safe defaults on boot; they never resurrect a stale process, job, mount, or authenticated session.</p></section>
      <section class="manual-section manual-grid-2"><div><h3>5.2 Terminal state</h3><p>The fixed-cell model is the source of truth. Web and Resource Pack UIs render snapshots. A newly opened Web Terminal receives control immediately and demotes the previous writer; a viewer may reclaim control explicitly.</p></div><div><h3>5.3 World state</h3><p>Inputs and outputs are side-addressed. Digital and analog observations enter through bounded events; output state persists with the Computer record.</p></div></section>
      <section class="manual-section"><h3>5.4 Storage model</h3><p>The guest filesystem maps paths to inodes and content-addressed blobs. Immutable OS images are shared by all Computers; each machine persists only its copy-on-write files, metadata changes, hard links, and deletion tombstones. Linux utilities are executable files under <code>/usr/bin</code>, <code>/sbin</code>, or <code>/usr/sbin</code>; DOS external utilities are under <code>C:\\DOS</code>. Deleting one makes that command unavailable until its file is restored. Linux built-ins share <code>/bin/bash</code>, while DOS internal commands share root <code>C:\\COMMAND.COM</code>. Bedrock World Dynamic Properties remain canonical and retain the current and previous complete generations with checksum-backed, content-addressed pages.</p><p>HDD requests model controller setup, CHS seek, 3,600 RPM rotation, PIO transfer, and write settling. The removable <code>computer_system:floppy_disk</code> item adds a 1.44 MiB FAT12 medium with stable identity, media generation, 300 RPM, 500 ms spin-up, 3 ms per-track seek, 62,500 B/s transfer, write settling, write protection, and ejection cancellation. FDD requests are split at 36 sectors. The Web Terminal synthesizes bounded insert, eject, motor, seek, read, and write sounds after a browser gesture and stops them when the session closes or leaves range. While a disk is present, the writer may press the Web Terminal <b>Eject</b> button; the button stays unavailable for viewers and reports completion only after Bedrock returns the medium to the connected player.</p><pre><code>sudo mkfs.fat -F 12 -n SHARED /dev/fd0
sudo mount -t vfat /dev/fd0 /mnt/floppy
cp README.TXT /mnt/floppy/
sudo umount /mnt/floppy
sudo eject /dev/fd0

df -h
du -sh /home/cs
quota
stat /startup.py</code></pre></section>
      <section class="manual-section"><h3>5.5 CS-Linux command surface</h3><table><thead><tr><th>Area</th><th>Commands</th></tr></thead><tbody><tr><td>Identity</td><td>whoami, id, groups, login, logout, passwd, su, sudo, getent</td></tr><tr><td>Accounts</td><td>useradd, userdel, usermod, groupadd, groupdel</td></tr><tr><td>Processes and jobs</td><td>ps, top, kill, pgrep, pkill, killall, jobs, fg, bg, wait</td></tr><tr><td>Sessions and services</td><td>tty, who, w, last, service, telinit, runlevel</td></tr><tr><td>Manual and logs</td><td>man, apropos, dmesg</td></tr><tr><td>Files and metadata</td><td>ls, stat, chmod, chown, chgrp, ln, readlink, realpath, rmdir, umask</td></tr><tr><td>Text and inspection</td><td>tee, cmp, diff, file, sha256sum, md5sum, base64, nl, od, hexdump, xargs</td></tr><tr><td>Pagers</td><td>more, less</td></tr><tr><td>System</td><td>hostname, uname, date, uptime, vmstat, free, df, du, mount, sync, mktemp, shutdown, reboot</td></tr><tr><td>Bash builtins</td><td>alias, unalias, command, read, local, shift, getopts</td></tr></tbody></table><p>Linux-facing commands use LF, Linux-style labels, and observable nonzero status for errors. <code>date --game</code> and <code>date --virtual</code> remain documented CS-Linux extensions. <code>yes</code>, <code>xargs</code>, dumps, hashes, and diffs stop at explicit sandbox limits.</p></section>
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
      <header class="manual-page-header"><p class="manual-kicker">Chapter 03 · Operator console</p><h2>Terminal control and source editing</h2><p class="manual-lead">The terminal is a fixed-cell machine display. The Web Terminal keeps the guest grid at 80x25, scales its glyphs with the browser viewport, and centers the complete CLI or TUI display frame horizontally and vertically while preserving the same cells, cursor, colors, input semantics, and guest-rendered scrollbars. One blank raster row above and below the active cells provides period-appropriate CRT vertical blanking without becoming part of the guest grid. Options applies a tab-only CRT profile and independent glass shape after that canonical frame is rendered.</p></header>
      <section class="manual-section"><h3>3.1 Web access and session states</h3><p>When the published numeric address belongs to the companion host, no custom public origin is configured, and automatic opening is not explicitly disabled, clicking an eligible Computer prepares a viewer session. The companion opens its loopback handoff only after Bedrock acknowledges that exact attachment. The handoff GET redirects without consuming authentication state; the stable page removes its handoff flag from history, exchanges the four-digit activation with one same-origin POST, and then claims the writer lease. This opens the server host's browser, not a remote player's browser; the four-digit entry page remains available to remote players. Operators may set <code>WEB_COMPANION_AUTO_OPEN=0</code> to disable opening or <code>1</code> to enable it explicitly while retaining listener-reachability checks.</p><p>A host administrator may persist a different listener port and advertised origin with <code>npm run web:config -- set --port 80 --url http://server-address</code>. Use <code>npm run web:config -- show</code> to inspect the active file and restart the companion after changing it. Environment variables remain one-start overrides. Plain HTTP is for a trusted LAN only; Internet publication requires an HTTPS reverse proxy.</p><table><thead><tr><th>State</th><th>What the operator can do</th><th>Terminal outcome</th></tr></thead><tbody><tr><td>Writer</td><td>Type, paste, submit, interrupt, and edit after the handoff exchange or an explicit takeover.</td><td>Input is accepted at both transport boundaries.</td></tr><tr><td>Viewer</td><td>Select and copy. Use <b>Take control</b> to reclaim the single writer lease.</td><td>Viewer input is rejected explicitly.</td></tr><tr><td><code>out_of_range</code></td><td>Return to 2.75 blocks or nearer after leaving the three-block radius.</td><td>The live stream pauses without destroying the session; the deadband prevents boundary flapping.</td></tr><tr><td>Disconnected</td><td>Reconnect with the remembered four-digit number.</td><td>The bearer token rotates; retries are bounded, honor rate limits, and stop when a new activation is required.</td></tr><tr><td>Closed</td><td>No further input is accepted.</td><td>Only the final detached session emits <code>terminal_closed</code>.</td></tr></tbody></table></section>
      <aside class="manual-callout"><b>Authoritative interaction contract</b><p>Each frame carries one versioned descriptor for line, bounded key-batch, or disabled input; pointer admission; secret masking; interrupt availability; presentation; and up to five contextual key hints. Desktop and narrow layouts render those hints from guest state, never by scanning terminal text, so a printed <code>-- INSERT --</code> line cannot switch modes. Input is rejected before the first descriptor. A missing or unsupported schema clears stale hints, disables input, shows <b>RELOAD REQUIRED</b>, and offers <b>Reload page</b>. Restart the companion and Computer components together before reloading; there is no heuristic fallback.</p></aside>
      <aside class="manual-callout"><b>Cell cursor and integer grid</b><p>The descriptor also owns block-versus-underline cursor shape and history availability. The browser draws one fixed-cell overlay instead of a native DOM caret: Linux, vi, and the more/less pagers use a block, the DOS prompt uses an underline, and EDIT follows insert/overwrite mode. Blink is CSS-only and disabled by reduced-motion preference. Resize chooses a whole-pixel glyph size and centers any unused pixels as letterboxing without changing the 80x25 guest grid or cached rows.</p></aside>
      <aside class="manual-callout"><b>Shell completion shelf</b><p>At a CS-Linux or CS-DOS shell prompt, Tab completes commands, directories, files, and virtual devices without running the line. One match is inserted immediately. Multiple matches first insert their shared prefix, then open a bounded shelf below the fixed 80x25 display; the shelf never covers guest cells. Tab or Down selects the next candidate, Shift+Tab or Up selects the previous one, Enter accepts, and Escape closes. Candidate kind and position are visible, and a trailing plus marks a result truncated at the 64-candidate limit.</p><p>CS-Linux path matching is case-sensitive and uses slashes. CS-DOS matching is case-insensitive and displays uppercase drive paths with backslashes. Secret input never completes. Typing, moving the caret, losing writer control, or dismissing the shelf invalidates the request, so a late companion response cannot replace newer input.</p></aside>
      <section class="manual-section"><h3>3.2 Keyboard map</h3><table><thead><tr><th>Key</th><th>Shell action</th><th>vi action</th></tr></thead><tbody><tr><td>Enter</td><td>Submit command</td><td>Insert newline</td></tr><tr><td>Tab</td><td>Complete command or path</td><td>Insert indentation</td></tr><tr><td>Ctrl+N / Ctrl+P</td><td>N/A</td><td>Next / previous completion</td></tr><tr><td>Ctrl+E</td><td>Linux end of line; DOS unchanged</td><td>Cancel active completion</td></tr><tr><td>↑ / ↓</td><td>Linux history; DOS after bare DOSKEY</td><td>Move cursor</td></tr><tr><td>F3</td><td>DOS recalls the latest submitted line</td><td>Guest-defined action</td></tr><tr><td>Ctrl+C</td><td>Copy a selection; otherwise interrupt foreground work or abort the idle line</td><td>Use the current guest-defined action</td></tr><tr><td>Ctrl+V</td><td>Paste clipboard text</td><td>Paste in insert mode</td></tr></tbody></table><p>Linux retains Ctrl+A/E/U/K/W/D line editing. The DOS prompt does not inherit those Emacs shortcuts. An idle Ctrl+C prints <code>^C</code>, redraws the prompt, and leaves shell history and Computer lifecycle unchanged.</p></section>
      <section class="manual-section manual-grid-2"><div><h3>3.3 Normal mode</h3><div class="manual-command-bank"><p><b>Move</b> h j k l, arrows, gg/G, PageUp/PageDown</p><p><b>Definition</b> gd; return with Ctrl+O</p><p><b>Edit</b> i/I, a/A, o/O, x, dd, &gt;&gt;/&lt;&lt;</p><p><b>History</b> u</p><p><b>Save + quit</b> Shift+ZZ</p><p><b>Discard + quit</b> Shift+ZQ</p><p><b>Leave insert</b> Esc or Ctrl+[</p></div></div><div><h3>3.4 Command mode</h3><div class="manual-command-bank"><p><b>Save</b> :w</p><p><b>Name and save</b> :w path</p><p><b>Quit</b> :q</p><p><b>Save + quit</b> :wq, :wq!, or :x</p><p><b>Discard</b> :q!</p><p><b>Syntax</b> :syntax on / :syntax off</p><p><b>Display</b> :set number rainbow list wrap</p><p><b>Indent</b> :set autoindent expandtab tabstop=N shiftwidth=N</p><p><b>Language</b> :set ft=auto|python|c|cpp|asm|shell|json|text</p><p><b>Completion</b> :set complete completecase=smart completeprefix=2</p><p><b>Sources</b> :set completesources=current,buffers,symbols,keywords</p><p><b>Definitions</b> :set definitionsources=current,buffers</p><p><b>Symbols</b> :symbols</p><p><b>Inspect</b> :set, :set all, :set option?</p><p><b>Guest command</b> :!command / :!!</p><p><b>Insert output</b> :r !command</p><p><b>Cancel empty :</b> Backspace</p></div><p>The editor begins with content on the first row and a cell-wide block cursor. Normal mode has no persistent mode banner or fixed shortcut help. The reverse-video penultimate row shows the file name, <code>[+]</code> only for unsaved changes, cursor position, and viewport position. The final row is reserved for commands and messages, and shows <code>-- INSERT --</code> while inserting. Bare <code>vi</code> opens <code>[No Name]</code>. It must be named with <code>:w path</code> before an unnamed save can succeed.</p><p>Documents are capped at 999 lines, and enabled line numbers use a fixed three-digit gutter with the active number brighter than inactive numbers. Syntax, numbers, rainbow indentation, autoindent, whitespace markers, and wrapping start off. <code>expandtab</code>, <code>tabstop=2</code>, and <code>shiftwidth=2</code> are the initial tab settings; numeric values are limited to 1 through 16. Prefix a Boolean option with <code>no</code> to disable it.</p><p>Completion starts on with a two-character prefix and smart case. Ctrl+N/Ctrl+P cycle at most 64 candidates; Ctrl+E restores the original text and Tab remains indentation. Priority is current-file words, words from eight recently visited buffers, lightweight function/type/macro/ASM-label symbols, language keywords, then optional direct includes. Add <code>includes</code> to <code>completesources</code> or <code>definitionsources</code> to opt in. Direct include lookup is non-recursive, reads at most eight credentialed guest files and 32 KiB total, and never starts an LSP or reads the host. The current-file index scans at most 256 KiB or 16,384 lines and retains at most 2,048 word occurrences and 512 symbols.</p><p><code>gd</code> uses the same bounded symbol index; <code>Ctrl+O</code> returns through at most 16 jumps. External jumps require a clean current buffer. <code>filetype=auto</code> detects Python, C, C++, CS ASM, shell, JSON, or text; <code>ft</code> is its short name.</p><p>Linux reads a bounded <code>~/.vimrc</code>; DOS reads <code>C:\\_VIMRC</code>. The file accepts only the documented <code>syntax</code> and <code>set</code> commands, at most 4,096 characters and 32 lines. An invalid line rejects the open atomically.</p><p><code>:!</code> uses the sandboxed guest shell, never the host. Background, asynchronous, session-control, foreground-process, and TUI commands fail explicitly. <code>:r !</code> inserts at most 128 lines or 4,096 characters as one undoable edit, and the parent shell state is restored before editing resumes.</p></div></section>
      <section class="manual-section"><h3>3.5 DOS-style EDIT</h3><p>On the DOS profile, <code>EDIT [path]</code> opens the shared CS QBASIC 1.0 editor in <code>/EDITOR</code> mode. Bare <code>EDIT</code> starts an <code>UNTITLED</code> buffer and F2 saves it as <code>C:\\NONAME.TXT</code>. Linux does not expose EDIT and uses <code>vi</code>. The top bar leaves one gray cell before the plain File, Edit, Search, and Options headings and keeps Help right-aligned; no <code>(F)</code>-style suffix is printed. Plain EDIT's File menu contains New, Open, Save, Save As, a separator, Print, a separator, and Exit without inline shortcut labels. Print remains visible for layout compatibility but reports that CS-DOS has no printer. The next row centers the filename, the blue body uses <code>↑</code>/<code>↓</code> on its vertical scrollbar, and the gray horizontal track uses <code>←</code>/<code>→</code>. The cyan footer also keeps one leading cell, uses black text, and shows contextual help or status with only the zero-padded line/column, such as <code>00001:001</code>, at the right. Menus and dialogs use gray chrome, black reversed selection, a two-cell-right/one-row-down black shadow, and explicit keyboard focus. In the Web Terminal this DOS presentation uses IBM VGA 9x16 at weight 400 with unit line spacing and five-color palette: bright white <code>#FFFFFF</code> for the active line number, gray <code>#a8a8a8</code>, blue <code>#0000AA</code>, cyan <code>#00AAAA</code>, and black <code>#000000</code>.</p><p>At 80x25, Ctrl+O starts with selected <code>*.TXT</code>, separate bounded Files and Dirs/Drives panes, a horizontal file track, a vertical directory track, and OK, Cancel, and Help. Ctrl+Shift+S uses the same guest-only C:/A: browser for Save As; narrower terminals retain the compact fallback. The provider lists at most 256 strict DOS 8.3 entries, filters with DOS <code>*</code>/<code>?</code>, supports keyboard and primary-mouse selection, and revalidates directory/media generation before Open or Save. Clicking outside the visible menu box cancels it and never activates an item by row alone. Display exposes only Scroll Bars and the plain-EDIT default <code>Tab Stops: 8</code>; the fixed editor colors are not configurable. Tab and Shift+Tab traverse every field and OK, Cancel, and Help; Cancel and Esc restore the opening values.</p><table><thead><tr><th>Key</th><th>Action</th></tr></thead><tbody><tr><td>F1</td><td>Open or close bounded editor help</td></tr><tr><td>F2 / Ctrl+S</td><td>Save only if the opened snapshot still matches; otherwise choose Overwrite, Reopen, or Cancel</td></tr><tr><td>Ctrl+O / Ctrl+Shift+S</td><td>Browse Open / Save As; an existing destination requires Replace or Cancel</td></tr><tr><td>F10 / Alt / Alt+F</td><td>Open File or another keyboard/mouse menu; arrows and Enter select. Bare Alt provides a Web fallback when Chrome reserves an Alt chord.</td></tr><tr><td>Ctrl+F / F3</td><td>Find text / find next with bounded forward search</td></tr><tr><td>Ctrl+C / Ctrl+X / Ctrl+V</td><td>Copy, cut, or paste the bounded current selection</td></tr><tr><td>Ctrl+Home / Ctrl+End</td><td>Move to the start or end of the document</td></tr><tr><td>Ctrl+Left / Ctrl+Right</td><td>Move by word</td></tr><tr><td>Ctrl+Y / Ctrl+Z</td><td>Delete the current line / undo</td></tr><tr><td>Insert</td><td>Toggle insert and overwrite modes</td></tr><tr><td>Alt+F, X</td><td>Exit; a dirty buffer requires Save, Discard, or Cancel</td></tr></tbody></table><p>Documents are capped at 999 lines with fixed three-digit line numbers. Text loads reject NUL/Ctrl+Z binary data and capacity-plus-one input without partial mutation. Successful writes use DOS CRLF. A failed read, save, or media refresh leaves the current buffer owned by EDIT.</p><p>The browser retains up to 1,024 editor keys until Bedrock returns a correlated admission result. It sends at most 16 keys per relay, retries only explicit busy responses with bounded exponential backoff, and removes a batch only after acceptance. Capacity overflow, a paused input path, and unacknowledged keys discarded by session replacement or close are reported explicitly; input is never silently truncated.</p></section>
      <aside class="manual-callout"><b>DOS editor options and language services</b><p>EDIT, CS QBASIC, PWB/CS C/C++, and CSASM share bounded Display, Editing, Completion, and Language dialogs. Their <code>C:\\EDITOR.INI</code> accepts <code>[common]</code>, <code>[edit]</code>, <code>[qbasic]</code>, <code>[pwb]</code>, and <code>[csasm]</code> sections, at most 4,096 characters and 64 lines. Invalid input rejects startup atomically. Syntax and completion start on; line numbers, rainbow indentation, whitespace markers, and wrap start off. Source IDEs enable autoindent and default to four expanded columns; plain EDIT does not enable autoindent and defaults to eight-column tabs.</p><p>Ctrl+Space opens at most 64 candidates in fixed order: current-file words, eight recent buffer summaries, functions/types/macros/labels, keywords, then opted-in direct includes. Ctrl+Shift+O lists document symbols, F12 jumps to a lightweight definition, and Alt+Left returns. Indexing is lazy and revision-cached; direct include reads are non-recursive, credentialed, and capped at eight guest files and 32 KiB. No LSP, external indexer, host process, or recursive project scan starts.</p><p>Each source IDE exposes DOS Command, Repeat DOS Command, and Insert Command Output under Run. Only the guest shell executes. Async, background, TUI, and session-control work fails explicitly; parent shell and outer editor ownership are restored. Insertion is one undoable edit capped at 128 lines or 4,096 characters.</p></aside>
      <section class="manual-section"><h3>3.6 Editing procedure</h3><ol class="manual-procedure"><li>On DOS, use <code>EDIT C:\\WORK\\PROGRAM.C</code> for direct full-screen editing. On Linux, use <code>vi program.py</code>.</li><li>In EDIT, type directly and navigate with arrows, Home/End, or PageUp/PageDown. Save with F2.</li><li>In vi, press <code>i</code>, enter source, press Escape, type <code>:w</code>, and press Enter.</li><li>Run or compile from the shell. Reopen the file to correct reported lines.</li></ol></section>
      <section class="manual-section"><h3>3.7 Static GitHub Pages reference</h3><p>The project GitHub Pages site publishes this same canonical 16-chapter field manual as a static reference. Chapter and section links use stable URL fragments, search remains bounded to 24 section results, and the complete publication remains readable with JavaScript unavailable.</p><p>The Pages site is documentation only. It cannot connect to BDS, accept a four-digit Computer number, obtain a bearer token, display a live terminal, submit guest input, or prove that a Web Terminal session is available. To operate a Computer, start the local companion with <code>npm run dev:bds:web</code> and use the address activated from Minecraft. Never enter a Computer connection number or terminal credential into the Pages site.</p><aside class="manual-callout"><b>One publication, two presentations</b><p>The in-session Manual dialog and the static Pages manual are generated from <code>web/manual.js</code>. If their chapter order, section IDs, or wording differ, treat the repository source and its publication tests as authoritative and report the deployed site as stale.</p></aside></section>
      <section class="manual-section"><h3>3.8 Pagers: more and less</h3><p><code>more PATH</code> and <code>less PATH</code> are bounded, document-resident full-screen viewers, structurally close to <code>vi</code>'s file view but read-only and much smaller. Both require a real file path; like <code>vi</code>, neither reads stdin or runs in a pipeline or redirect. The reverse-video final row shows a status indicator instead of a command line, and the cursor is a block positioned at its end.</p><table><thead><tr><th>Key</th><th>more</th><th>less</th></tr></thead><tbody><tr><td>Space / PageDown</td><td>Next screen</td><td>Next screen</td></tr><tr><td>Enter</td><td>Next line</td><td>Next line (also j / ArrowDown)</td></tr><tr><td>PageUp / b</td><td>Not supported</td><td>Previous screen</td></tr><tr><td>ArrowUp / k</td><td>Not supported</td><td>Previous line</td></tr><tr><td>g / G</td><td>Not supported</td><td>Jump to top / bottom</td></tr><tr><td>q</td><td>Quit</td><td>Quit</td></tr></tbody></table><p><code>more</code>'s status line reads <code>--More--(NN%)</code>, then <code>--More--(END)</code> at the last screen, matching traditional forward-only <code>more</code>. <code>less</code> shows <code>path (Top|Bot|All|NN%)</code>, matching real <code>less</code>'s indicator. Documents are capped at 999 lines like <code>vi</code>; long lines truncate at the terminal width rather than wrapping, and there is no horizontal scroll or search in this bounded reimplementation.</p></section>
      <aside class="manual-callout"><b>Terminal controls</b><p>Options is followed by Copy and Manual, then the PWR, HDD, and FDD indicators, Eject, and Power. Options selects Off, Subtle, Arcade, or Shadow Mask independently from Flat or Curved Glass. Each newly loaded page starts at Subtle and Flat; Curved Glass enables a bounded 0-30% Curvature slider whose value starts at 2% and drives both visible displacement and TUI pointer correction. These choices remain in the active page only and never change terminal cells. PWR follows lifecycle state; HDD and FDD reflect real block-device activity or absent media. Only the active writer can use Eject or Power, and Eject is unavailable with no loaded Floppy Disk. The footer provides tab-local virtual Caps Lock, Num Lock, and Scroll Lock indicator buttons. Each starts hollow/off and toggles independently to filled/on by pointer, Enter, or Space. They change only their indicators in the current browser tab; they never change operating-system locks, terminal input, guest behavior, or frame rendering, and reloading resets them to off. Drag across terminal text to select it; with no selection Copy copies the visible screen. A viewer can select and copy, but cannot submit input until it takes control.</p></aside>`,
  },
  {
    id: "redstone-peripherals",
    html: `
      <header class="manual-page-header"><p class="manual-kicker">Chapter 08 · World interface</p><h2>Connecting programs to Minecraft</h2><p class="manual-lead">World I/O crosses a narrow adapter boundary. A program observes snapshots and bounded events; it never calls Bedrock APIs directly.</p></header>
      <div class="manual-spec-line"><span>Sides</span><b>6</b><span>Digital</span><b>false / true</b><span>Analog input</span><b>0…15</b></div>
      <section class="manual-section"><h3>8.1 Built-in displays</h3><table><thead><tr><th>Machine</th><th>Web Terminal rule</th></tr></thead><tbody><tr><td>Desktop / Advanced Desktop</td><td>The CRT is built into the placed Computer. Touch the Computer directly to activate its Web Terminal.</td></tr><tr><td>Portable Computer System</td><td>Its LCD is built in. Use it while held, or place and touch the open-laptop block.</td></tr></tbody></table><p>Each Computer has a permanent four-digit connection number. Touching an eligible machine activates it once for two minutes; duplicate rapid interactions for the same player and Computer are admitted once. Bedrock must accept the exact session before a browser opens. After the handoff POST succeeds, the browser stores the number locally and changes the bookmarkable URL to <code>/?computer=NNNN</code>; bearer tokens are never placed in that query or browser history. Invalid guesses are rate-limited and simultaneous number collisions fail explicitly. Placed-machine control pauses beyond three blocks and resumes at 2.75 blocks or nearer. Between those thresholds the prior state remains unchanged, so boundary movement does not spam alternating messages; range status stays in the Web UI rather than Minecraft chat. A reloaded bookmark rotates the bearer token through a bounded reconnect policy and stops when a new activation is required. Portable placement transfers the same persistent Computer identity from item to block. Breaking it returns an identity-carrying Portable Computer System item.</p></section>
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
      <aside class="manual-warning"><b>Capability-dependent interfaces</b><p>Computer, Portable Computer System, Speaker, and other block behavior is exposed only when the relevant adapter exists. Missing capability calls fail explicitly rather than impersonating unavailable hardware.</p></aside>`,
  },
  {
    id: "dos-profile",
    html: `
      <header class="manual-page-header"><p class="manual-kicker">Chapter 14 · Computer System DOS 1.0</p><h2>Operating CS-DOS 1.0 on the LTE 386SX</h2><p class="manual-lead">Computer System DOS 1.0 (CS-DOS 1.0) is the portable profile for the Computer System LTE 386SX, a CS386SX 16 MHz machine with 2 MiB RAM. It supports CS ASM 1.0, CS C/C++ 1.0, CS QBASIC 1.0, and bounded batch files. User MicroPython is unavailable. Storage, identity, execution limits, and the host security boundary remain shared with the CS-Linux desktop.</p></header>
      <figure class="manual-figure manual-figure--portable"><img src="/assets/manual/portable-computer-system.png" width="1029" height="1528" alt="Computer System LTE 386SX with 2 MiB RAM showing a DOS prompt, VGA LCD, keyboard, trackball, 3.5-inch floppy drive, rear ports, and battery pack" loading="lazy" decoding="async"><figcaption><b>Computer System LTE 386SX.</b> The CS386SX profile runs at 16 MHz with 2 MiB RAM, a 24-bit address bus, a 16-bit data bus, 256 KiB VRAM, and 800,000 cycles/tick. Its 800x480 physical VGA LCD centers guest modes up to 640x480; its narrower bus and 80386-derived timing are active execution constraints rather than display-only labels.</figcaption></figure>
      <section class="manual-section"><h3>14.1 Boot sequence</h3><ol class="manual-procedure"><li><b>Mount C:.</b> Restore the persisted, quota-limited guest filesystem and reset <code>C:\\TEMP</code>.</li><li><b>Plan CONFIG.SYS atomically.</b> Parse at most 64 lines, resolve every expected versioned CS-DOS driver capsule, validate dependency order, and trial the complete memory map before committing any directive. Any error discards the whole plan, reports bounded diagnostics, and selects the explicit 64 KiB degraded-low profile; earlier valid lines never survive as partial state.</li><li><b>Run AUTOEXEC.BAT.</b> Execute it through the same bounded batch engine even after a degraded CONFIG boot.</li><li><b>Present the prompt.</b> Start at <code>C:\\&gt;</code>; <code>PROMPT</code>, current drive, environment, and <code>PATH</code> are now active.</li></ol><pre><code>DEVICE=C:\\DOS\\HIMEM.SYS
DEVICE=C:\\DOS\\EMM386.EXE NOEMS
DOS=HIGH,UMB
FILES=32
BUFFERS=16</code></pre><p>The supported CONFIG.SYS surface is deliberately narrow: <code>FILES=1…255</code>, <code>BUFFERS=1…99</code>, <code>DEVICE</code>/<code>DEVICEHIGH</code> for the built-in HIMEM and EMM386 models, and <code>DOS=HIGH|LOW,UMB|NOUMB</code>. These settings configure the guest manager; they never execute host drivers or persist derived <code>CONFIG_*</code> environment variables. <code>DEVICEHIGH</code> tries one contiguous UMB block, then loads low with an explicit diagnostic when no such block fits.</p></section>
      <section class="manual-section"><h3>14.2 The 2 MiB memory map</h3><table><thead><tr><th>Region</th><th>Address range</th><th>Nominal size</th><th>Use</th></tr></thead><tbody><tr><td>Conventional</td><td>0–639 KiB</td><td>640 KiB</td><td>DOS-compatible resident state and guest program working set</td></tr><tr><td>Reserved video aperture</td><td>640–767 KiB</td><td>128 KiB</td><td>Not allocatable</td></tr><tr><td>Upper memory blocks</td><td>768–895 KiB</td><td>128 KiB</td><td>Available with HIMEM, EMM386 NOEMS, and <code>DOS=UMB</code></td></tr><tr><td>Reserved ROM aperture</td><td>896–1023 KiB</td><td>128 KiB</td><td>Not allocatable</td></tr><tr><td>Extended / XMS</td><td>1–2 MiB</td><td>1024 KiB</td><td>Exposed by HIMEM; HMA is its first 64 KiB, never extra capacity</td></tr></tbody></table><pre><code>MEM
MEM /C
MEM /D
MEM /F
REM MEM /P is explicitly unsupported</code></pre><p>Every MEM variant reads one immutable boot-manager snapshot; there is no fallback calculation. <code>/C</code> lists category/module residency and actual placement, <code>/D</code> lists manager flags and boot diagnostics, and <code>/F</code> lists actual free extents and largest contiguous blocks. Snapshot work is bounded O(active allocations + free extents) and never grows with filesystem contents or RAM bytes.</p></section>
      <section class="manual-section"><h3>14.3 Processor and protected mode</h3><p><code>CPU</code> reports the 24-bit address bus, 16-bit data bus, 16 MHz clock, and modeled real/protected/virtual-8086 capability. Guest execution currently runs inside the <b>protected sandbox</b>. EMM386 NOEMS supplies the DOS-visible UMB/v86 compatibility model; EMS page-frame mapping is deferred. Paging, native descriptor tables, ring transitions, BIOS interrupts, DOS interrupts, TSR residency, and arbitrary x86 opcodes are not emulated. The declared <code>cs-flat32-v1</code> memory contract is a Computer System ABI, not DPMI.</p><aside class="manual-warning"><b>Compatibility is not native emulation</b><p>The assembler and compilers emit the checked Computer System executable format. A downloaded DOS <code>.COM</code> or <code>.EXE</code> cannot run, and no guest can escape through an interrupt or host driver. A future native x86 engine is a separate architecture, not an implied extension of this address map.</p></aside></section>
      <section class="manual-section"><h3>14.4 AUTOEXEC and environment</h3><pre><code>@ECHO OFF
PATH C:\\DOS
SET TEMP=C:\\TEMP
SET INCLUDE=C:\\INCLUDE</code></pre><table><thead><tr><th>Command</th><th>Contract</th></tr></thead><tbody><tr><td>SET [NAME[=VALUE]]</td><td>List, query, assign, or remove a case-insensitive environment variable</td></tr><tr><td>PATH [directories]</td><td>Show or replace up to the first 16 semicolon-separated search entries</td></tr><tr><td>PROMPT [template]</td><td>Set at most 64 characters; <code>$P $N $G $L $B $Q $V $_ $$</code> are recognized</td></tr><tr><td>ECHO ON / OFF</td><td>Control batch command echo; a leading <code>@</code> suppresses one line</td></tr><tr><td>REM text</td><td>Comment with no output or side effect</td></tr></tbody></table></section>
      <aside class="manual-callout"><b>Default DOS environment</b><p>Fresh CS-DOS exposes <code>COMSPEC=C:\\COMMAND.COM</code>, <code>PATH=C:\\DOS</code>, <code>PROMPT=$P$G</code>, <code>TEMP=C:\\TEMP</code>, and <code>INCLUDE=C:\\INCLUDE</code>. It does not invent Linux-style <code>USER</code>, <code>LOGNAME</code>, or <code>TERM</code> variables, and external utilities resolve from <code>C:\\DOS</code>.</p></aside>
      <section class="manual-section"><h3>14.5 Batch programs</h3><pre><code>@ECHO OFF
REM C:\\TOOLS\\BUILD.BAT
ECHO SCRIPT=%0
ECHO SOURCE=%1
CC %1 -O %2
ECHO STATUS=%ERRORLEVEL%</code></pre><p>A command without a path is resolved in the current directory and then <code>PATH</code>; the <code>.BAT</code> suffix may be omitted. CRLF and LF are accepted. Batch substitution supports <code>%VAR%</code>, <code>%0</code> through <code>%9</code>, and <code>%ERRORLEVEL%</code>. Labels, <code>GOTO</code>/<code>GOTO :EOF</code>, internal and external <code>CALL</code>, <code>SHIFT</code>, <code>IF [NOT] ERRORLEVEL</code>, <code>IF [NOT] EXIST</code>, and <code>COMMAND /C</code> or <code>/K</code> use the dedicated bounded BAT engine. Unquoted Unix-style <code>&amp;&amp;</code> and <code>||</code> chains are rejected inside BAT control flow. Pipes and redirections remain documented safe-shell extensions, not claims of native COMMAND.COM semantics.</p><table><thead><tr><th>Bound</th><th>Limit</th><th>Failure</th></tr></thead><tbody><tr><td>Batch lines / labels</td><td>256 / 256</td><td>Explicit line or label status</td></tr><tr><td>Call depth / positional arguments</td><td>8 / 9</td><td>Explicit depth or argument status</td></tr><tr><td>Jumps / executed steps</td><td>1,024 / 4,096</td><td>Explicit control-flow status</td></tr><tr><td>Loaded programs</td><td>64</td><td>Explicit program-load status</td></tr><tr><td>Expanded command / output</td><td>4,096 / 256,000 characters</td><td>Explicit bounded-output status</td></tr></tbody></table><p><code>CHOICE</code> and native COMMAND.COM binary behavior are not implemented. Missing or duplicate labels, recursion, and exhausted bounds terminate explicitly without invoking a host or native DOS process.</p></section>
      <section class="manual-section"><h3>14.6 Command correspondence</h3><table><thead><tr><th>Task</th><th>Linux</th><th>DOS</th></tr></thead><tbody><tr><td>List / read</td><td>ls / cat</td><td>DIR / TYPE</td></tr><tr><td>Directory tree / volume</td><td>find / df</td><td>TREE / VOL / LABEL / CHKDSK</td></tr><tr><td>Attributes / metadata</td><td>chmod / stat</td><td>ATTRIB / DIR /A</td></tr><tr><td>Edit full screen</td><td>vi</td><td>EDIT / VI</td></tr><tr><td>Create / remove directory</td><td>mkdir / rm</td><td>MD / RD (CHDIR and RMDIR aliases)</td></tr><tr><td>Copy / move / rename</td><td>cp / mv</td><td>COPY / MOVE / REN or RENAME</td></tr><tr><td>Remove file</td><td>rm</td><td>DEL or ERASE</td></tr><tr><td>Clock / measurement</td><td>date / time</td><td>TIME / TIMER</td></tr><tr><td>History</td><td>history</td><td>DOSKEY /HISTORY</td></tr><tr><td>Clear / version</td><td>clear / uname</td><td>CLS / VER</td></tr><tr><td>Hardware</td><td>cpuinfo / free</td><td>CPU / MEM, MEM /F</td></tr><tr><td>System summary</td><td>uname -a</td><td>SYSTEMINFO</td></tr></tbody></table><p>DOS-facing commands and errors use CRLF and DOS-specific wording. Commands and paths are case-insensitive, but every directory and file name follows strict 8.3 form: a 1–8 character base plus an optional 1–3 character extension. Invalid long names fail explicitly and are never silently truncated. Backslash is preserved as the displayed separator. Normal <code>DIR</code> prints separate eight-character base and three-character extension columns, aligns <code>&lt;DIR&gt;</code> or a locale-independent comma-grouped size, and follows it with <code>MM-DD-YY</code> and a space-padded 12-hour <code>a</code>/<code>p</code> time. Totals and free bytes use the same comma grouping. <code>DIR /B</code> produces a bare listing and <code>DIR /W</code> retains its wide layout; <code>DIR /A[:attributes]</code> filters persisted FAT metadata; <code>TREE [/F] [/A]</code> is an O(N) traversal capped at 512 entries and 32 levels. <code>CHKDSK</code> never changes guest file contents, labels, or attributes and never repairs a volume, but it may materialize missing versioned FAT metadata while reconciling a legacy entry. <code>C:\\TEMP</code> is volatile across boot. <code>NUL</code> and <code>CON</code> are bounded compatibility sink devices; CON is not a raw host console.</p></section>
      <section class="manual-section"><h3>14.7 Drives, wildcards, FAT metadata, and floppy limits</h3><p>The DOS runtime owns exactly A: and C:. C: contains the persistent system volume. A: reflects the removable Floppy Disk item in the physical bay; an empty bay reports <code>Not ready</code>. Each drive keeps its own current directory. <code>FORMAT A:</code> creates FAT12, <code>FORMAT A: /S</code> creates a bootable system disk, <code>SYS A:</code> transfers the system to an existing formatted disk, and <code>EJECT [A:]</code> returns the item. A bootable disk takes CSBIOS priority unless one-shot safe boot was requested. A Linux-installed Computer then runs temporary A:-only DOS with no C: and without changing its Linux filesystem or OS snapshot.</p><pre><code>FORMAT A: /S /V:BOOTDISK
DIR A:\\
COPY C:\\WORK\\README.TXT A:\\README.TXT
EJECT A:

CD C:\\WORK
DIR *.TXT
COPY *.TXT C:\\BACKUP
REN *.BAK *.OLD
ATTRIB +R +H SECRET.TXT
DIR /A:H
LABEL C: PROJECT
CHKDSK C:</code></pre><p>The removable volume has 2,880 512-byte sectors, two FAT copies, a 224-entry root directory, strict 8.3 names, cluster allocation, fragmentation-aware LBA extents, and FAT UTC timestamps clamped to 1980-2107 at two-second precision. The shipped DOS <code>*</code> and <code>?</code> traversal examines at most 512 entries, returns at most 512 matches, and stops recursion at 32 levels. Every file retains R/H/S/A metadata and read-only enforcement. <code>ATTRIB /S</code> is bounded; <code>LABEL</code> is generation-bound; <code>CHKDSK</code> reports state without repair.</p><p>The current CS-DOS and CS-Linux images are both v7 and add the guest C/C++ include roots. Older image definitions remain registered so existing overlays migrate without duplicating the immutable base; v6 retains the prior WorkBench image, DOS v5 retains CS QBASIC 1.0 without the WorkBench launchers, and earlier immutable bases remain readable. Cold DOS persistence preserves C:, labels, attributes, and timestamps but never serializes an inserted A: location into the machine snapshot; media content has its own transactional world record.</p><p>Linux vfat mounts are root/sudo-only and use fixed <code>uid=1000,gid=1000,fmask=0133,dmask=0022</code>. Files appear as 0644 and directories as 0755. FAT has no DAC ownership, hard links, or symbolic links, so <code>chmod</code>, <code>chown</code>, and link creation fail explicitly.</p></section>
      <section class="manual-section"><h3>14.8 Local bus commands</h3><pre><code>ECHO HELLO&gt;COM1
TYPE COM1
SPI 1 0 9F0000
I2C 1 SCAN
I2C 1 72 00 2</code></pre><p><code>COM1</code> through <code>COM6</code> are the six machine-relative RS-232C ports and work with redirection and <code>TYPE</code>. <code>SPI</code> accepts a one-based bus, chip select, and hexadecimal byte pairs. <code>I2C</code> accepts a one-based bus plus <code>SCAN</code>, or an address, write bytes (use <code>-</code> for none), and read length. These commands are valid in bounded batch files. A missing neighbor, unattached peripheral, NACK, address conflict, full queue, or powered-off endpoint returns a nonzero explicit status.</p></section>
      <section class="manual-section"><h3>14.9 Portable toolchains</h3><pre><code>REM Product identity
ASM /VERSION
CC /VERSION
C++ /VERSION

REM Command-line build
ASM ANSWER.ASM /OUT:ANSWER
RUN ANSWER /STATS
ASM /C ANSWER.ASM /OUT:ANSWER.O
LINK ANSWER.O /OUT:ANSWER /ENTRY:START
CC TOTAL.C -O TOTAL
C++ ANSWER.CPP -O ANSCPP

REM Full-screen WorkBench
CSASM ANSWER.ASM
CSCC TOTAL.C
CSCPP ANSWER.CPP
PWB ANSWER.CPP

QBASIC DEMO.BAS
QBASIC /RUN DEMO.BAS</code></pre><p>CS ASM 1.0 keeps <code>AS</code>/<code>LD</code> available, while <code>ASM</code>/<code>LINK</code> provide DOS-friendly aliases. The assembler accepts CRLF source, relative <code>INCLUDE</code>, <code>PUBLIC</code>/<code>EXTRN</code>, <code>.CODE</code>/<code>.CONST</code>, and bounded <code>name MACRO</code> ... <code>ENDM</code> forms. It deliberately rejects <code>ORG</code>, <code>INT</code>, segment models, and other constructs that would imply native OMF, COM, EXE, BIOS, or DOS-interrupt execution.</p><p>CS ASM 1.0 and the supported CS C/C++ 1.0 subsets share a full-screen File/Edit/View/Search/Make/Run/Debug/Options/Help WorkBench. F7 builds one source or the selected Program List, Ctrl+F7 rebuilds it, F3/Shift+F3 navigate F4 diagnostics, Ctrl+F5 runs the exact last non-stale artifact, and F5/F8/F9 debug inside WorkBench. CS QBASIC instead shows File/Edit/View/Search/Run/Options/Help: F5, Ctrl+F5, Shift+F5, and <code>/RUN</code> run source transiently and create no OBJ, CSX, or EXE. DOS C/C++ options include <code>/I,/D,/U</code>; the same guest preprocessor handles headers and macros on Linux and DOS. DOS compile-only and executable defaults are same-basename <code>.OBJ</code> and <code>.CSX</code>, not <code>a.o</code>/<code>a.out</code>.</p><p>This recognizable period-DOS workflow is original Computer System code; it is not Microsoft C/C++ 7.0 or Programmer's WorkBench binaries, artwork, help, OMF output, or native runtime. The linker applies the same typed-symbol, structured-relocation, section-size, object-count, and RAM bounds as CS-Linux. Each run uses CS386SX timings, its 16-bit external bus, and the 2 MiB limit. MicroPython commands and <code>/startup.py</code> are unavailable on Portable; MCP returns status 127 instead of silently using a different VM.</p></section>
      <section class="manual-section"><h3>14.10 Instruction debugger</h3><pre><code>DEBUG ANSWER
BP MAIN
G
R
U MAIN 8
D 0 16
T
G 1000
Q</code></pre><p>The WorkBench Debug menu and the optional <code>DEBUG</code> command expose the same bounded CS486 instruction debugger; <code>csdb</code> is the CS-Linux command spelling. It loads only validated CS486 executables, treats unprefixed DOS addresses as hexadecimal, and uses CRLF output. <code>BP</code>/<code>BC</code> manage breakpoints, <code>T</code> steps one instruction, <code>G</code> continues with an optional bounded instruction count, <code>R</code> reads registers, <code>U</code> disassembles, and <code>D</code> reads memory without modifying it.</p><p>This command is not native DOS DEBUG emulation. It cannot write memory, run COM/EXE files, reconstruct C/C++ source variables, or invoke BIOS/DOS interrupts, PIC, IRQ, or IDT behavior.</p></section>
      <section class="manual-section"><h3>14.11 C++ exercise</h3><pre><code>REM ANSWER.CPP
int main() {
  int answer = 6 * 7;
  std::cout &lt;&lt; answer &lt;&lt; std::endl;
  return 0;
}

C++ ANSWER.CPP -O ANSWER
RUN --STATS ANSWER</code></pre><p>Record output, instructions, and cycles. On the 16-bit external bus, memory traffic and output can dominate. Reduce the algorithmic term first, then repeated loads, taken branches, division, and PRINT traffic.</p></section>
      <section class="manual-section"><h3>14.12 Linux memory comparison</h3><table><thead><tr><th>Portable DOS</th><th>Desktop Linux</th></tr></thead><tbody><tr><td>640 KiB conventional + two reserved apertures + UMB + XMS</td><td>32-bit protected flat sandbox</td></tr><tr><td>Inspect with CPU, MEM, MEM /C, MEM /D, MEM /F</td><td>Inspect with cpuinfo, free, /proc/cpuinfo, /proc/meminfo</td></tr><tr><td>One boot manager owns system, drivers, and exact process grants</td><td>Ledger owns kernel, services, buffers, and guest runtime grants</td></tr><tr><td>HMA is inside XMS; HIMEM, EMM386 NOEMS, and DOS HIGH/UMB are modeled</td><td>Resident OS overhead plus dynamic used/free/available are reported</td></tr><tr><td>No EMS paging, DPMI, or native interrupt execution</td><td>Bounded process table; no paging, swap, or MMU page emulation</td></tr></tbody></table></section>
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
      <section class="manual-section"><h3>13.2 Archived pre-CSIR strength-reduction benchmark</h3><p>These are historical live BDS measurements captured through the Computer System MCP on 2026-07-15, before the dedicated C/C++ tokenizer, typed AST, CSIR optimizer, and register allocator shipped. The C and C++ rows are retained as pre-CSIR provenance and must not be used as current compiler measurements; rerun every hardware profile before publishing a current comparison. The BASIC rows likewise record the former cross-profile <code>basic</code> command and do not imply BASIC availability on current CS-Linux or parity with the current CS QBASIC 1.0 frontend. All sources compute <code>sum(i*i + 3*i + 7)</code> for <code>i = 1..1500</code>. The baseline performs two multiplications per iteration; the optimized source advances the term with first differences. Every supported run started cold and printed the same checksum, <code>1129513000</code>. Compile time, Web transport, browser rendering, Minecraft wall time, and MCP overhead are excluded. Each cell is <b>instructions · modeled CPU cycles · virtual microseconds</b>; the final column is cycle reduction.</p>
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
      <section class="manual-section"><h3>15.1 Start from the observed symptom</h3><table><thead><tr><th>Symptom</th><th>Check</th><th>Recovery owner</th></tr></thead><tbody><tr><td>Web Terminal cannot accept input</td><td>Check writer/viewer, <code>out_of_range</code>, and connection number activation.</td><td>Take control, return to range, or touch the Computer and reconnect once.</td></tr><tr><td>CS-Linux stops before the prompt</td><td>Check first-boot <code>cs</code> password setup, later username/password login, locked-account state, and startup/journal failure.</td><td>Complete authentication. For a broken <code>/startup.py</code>, stop retries. When lifecycle is <code>crashed</code>, sneak while opening the Computer or use the attached Web Terminal's safe-boot power control. Repair from that one boot; the broken file is preserved until you edit it.</td></tr><tr><td>Program is not found or does not start</td><td>Check OS profile, path, filename rules, executable/object format, execute permission, and status 127.</td><td>Use an explicit permitted guest path or the toolchain for the active profile.</td></tr><tr><td>Permission denied</td><td>Check <code>id</code>, <code>groups</code>, owner/group/other mode bits, ancestor traversal, and the active <code>umask</code>.</td><td>Correct ownership or mode through a permitted account; do not bypass the credentialed filesystem.</td></tr><tr><td>Program is slow</td><td>Check hidden polling, repeated output, <code>run --stats</code>, cache/bus counters, and the dominant O(N) term.</td><td>Bound or deduplicate repeated work before changing machine limits.</td></tr></tbody></table></section>
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
      <section class="manual-section"><h3>15.7 Storage migration after an update</h3><p>An older world may pause Computer interactions while BDS converts indexed Dynamic Property pages and inline filesystem files. Progress is reported as <code>CS_STORAGE_MIGRATION</code>. Each Computer is written and verified before a legacy identity registry is switched, so an interruption keeps the older complete generation readable and the next start safely resumes by rescanning and skipping completed Computers. The same scan runs when the identity pages are already current: changed Computer payloads are saved and reload-verified, while a healthy current identity head remains unchanged. If a current-format Computer or identity head is invalid but its previous generation validates, that recovered value repairs the head and must reload without fallback before migration completes. A valid head is also retained when its previous manifest is corrupt. Recovery repairs or removes that invalid fallback metadata and incrementally removes target-only content blobs, legacy indexed pages, and stray manifests that corrupt metadata can no longer name. This whole-prefix search runs only during repair; ordinary saves never enumerate every stored page. Page-count or manifest-length overflow is rejected before a generation changes storage.</p><p>When the recognized legacy CS-Linux default account is present, boot also completes the <code>computer</code>-to-<code>cs</code> account and home migration described in Chapter 5. This is a rename, not an alias: the old passwd/group/shadow name and <code>/home/computer</code> disappear after success, while the exact password payload and filesystem data/metadata/link identities remain intact.</p><p>Optional OS-runtime fields migrate independently and idempotently. Linux restores only cold journal, last-login, service/mount definition, and offline-device state; it never revives a process, job, active mount, or authenticated session. DOS preserves C: drive/label/FAT metadata, activates C:, and always detaches transient A: media and stale generation metadata. Current CS-DOS v7 and CS-Linux v7 images remain compatible with every registered immutable base, including the pre-QBASIC DOS v4 and pre-removal Linux v5 images.</p><ol class="manual-procedure"><li>Stop BDS before copying or restoring a world; never copy a live LevelDB directory.</li><li>Back up the complete world directory before the first start with a storage-format update.</li><li>Start BDS and wait for the migration-complete message before using Computers or running headless probes.</li><li>If migration fails, stop BDS, preserve the logs and failed world, then restore the stopped backup or correct the reported corrupt property.</li></ol><p><b>Verify:</b> Find a terminal <code>CS_STORAGE_MIGRATION</code> record with <code>state</code> equal to <code>complete</code>, then inspect the same Linux and DOS Computers after two starts.</p><p><b>Expect:</b> The Computer ID, OS profile, hardware, terminal state, password payload, guest files, modes, ownership, mtimes, symbolic links, hard-link identities, tombstones, Linux cold history, and DOS C: metadata are unchanged except for the complete user/group/shadow and home-path rename. No live Linux process/session or A: media is resurrected, and a second boot performs no further migration.</p></section>
      <section class="manual-section"><h3>15.8 Future network-state migration</h3><p>The optional network-state boundary remains absent from an empty OS snapshot, so a preserved legacy Computer and a new Computer with no guest NIC have the same canonical shape. If a future adapter registers interfaces and addresses, cold restore retains those definitions but forces every link down, resets counters to zero, and removes all process-owned sockets and listeners. A second cold projection is identical.</p><p>This boundary owns at most eight interfaces, 32 addresses, and 64 sockets. It is not packet transport: no default <code>lo</code> or <code>eth0</code>, route table, DNS resolver, <code>ip</code>, <code>ping</code>, or <code>ss</code> ships in this release. Web Terminal connectivity remains host transport.</p></section>
      <aside class="manual-warning"><b>Server remains authoritative</b><p>A guest fault must never mutate host files or broaden permissions. If BDS or the terminal disconnects, reconnect and inspect the persisted Computer rather than retrying in an unbounded loop.</p></aside>`,
  },
  {
    id: "limits-glossary",
    html: `
      <header class="manual-page-header"><p class="manual-kicker">Chapter 16 · Technical appendix</p><h2>Limits, units, and terminology</h2><p class="manual-lead">A limit is part of the programming model, not an exceptional host failure. Design programs so every ceiling has a useful observable outcome.</p></header>
      <section class="manual-section"><h3>16.1 Future network-state limits</h3><table><thead><tr><th>State</th><th>Default ceiling</th><th>Cold restore</th></tr></thead><tbody><tr><td>Interfaces</td><td>8; name at most 15 UTF-8 bytes</td><td>Definition retained, link down, counters zero</td></tr><tr><td>IPv4/IPv6 addresses</td><td>32</td><td>Definition retained</td></tr><tr><td>TCP/UDP sockets and listeners</td><td>64; backlog at most 128</td><td>All removed</td></tr></tbody></table><p>This empty-by-default state is reserved for a future network adapter. It creates no guest NIC and routes no packets. No network command can inspect it in this release.</p></section>
      <section class="manual-section"><h3>16.2 Canonical compatibility matrix</h3><table><thead><tr><th>Capability</th><th>CS486DX desktop</th><th>CS486DX2 advanced</th><th>CS386SX portable</th></tr></thead><tbody><tr><td>Default OS</td><td>CS-Linux 1.0</td><td>CS-Linux 1.0</td><td>CS-DOS 1.0</td></tr><tr><td>Computer System Python</td><td>Supported</td><td>Supported</td><td>Not available</td></tr><tr><td>CS ASM 1.0 / CS C/C++ 1.0</td><td>Supported</td><td>Supported</td><td>Supported</td></tr><tr><td>CS QBASIC 1.0</td><td>Not available</td><td>Not available</td><td>Supported subset; see Chapter 11</td></tr><tr><td>Web Terminal display</td><td>Built-in CRT; placed</td><td>Built-in CRT; placed</td><td>Built-in LCD; held or placed</td></tr><tr><td>Maximum guest display</td><td>640x480x8</td><td>640x480x8</td><td>640x480x4</td></tr></tbody></table><p>This matrix is the canonical quick compatibility lookup. Profile chapters explain behavior; they do not broaden a capability marked unavailable here.</p></section>
      <section class="manual-section"><h3>16.3 Independent resource ceilings</h3><table><thead><tr><th>Resource</th><th>Measured as</th><th>Inspect with</th></tr></thead><tbody><tr><td>CPU</td><td>Instructions and modeled cycles</td><td>run --stats, time, cpuinfo</td></tr><tr><td>RAM</td><td>Live VM values and CS486 memory</td><td>free -h, /proc/meminfo</td></tr><tr><td>Disk</td><td>Persisted file bytes and entries</td><td>df, du, quota</td></tr><tr><td>Processes / jobs</td><td>64 / 32 per Computer by default</td><td>ps, jobs, /proc/loadavg</td></tr><tr><td>Sessions / last logins</td><td>8 active / 64 retained</td><td>who, w, last</td></tr><tr><td>Services / mounts / devices</td><td>32 / 16 / 64 records</td><td>service, mount, /proc/devices</td></tr><tr><td>Inittab / crontab entries</td><td>64 lines each</td><td>runlevel, telinit, /etc/init.d, /etc/crontab</td></tr><tr><td>Journal</td><td>256 records, 32 KiB total, 1 KiB each</td><td>dmesg, /var/log/messages, auth.log</td></tr><tr><td>DOS FAT metadata</td><td>4,096 records; 255-character normalized path</td><td>ATTRIB, DIR /A, LABEL, CHKDSK</td></tr><tr><td>Terminal</td><td>Rows × columns and bounded output</td><td>term.get_size()</td></tr><tr><td>Events</td><td>Queued records and wait ownership</td><td>Program diagnostics</td></tr><tr><td>Scheduler</td><td>Per-machine and global tick work</td><td>cpuinfo, run --stats</td></tr><tr><td>Stopping</td><td>200 ticks per phase; 16 Computers advanced per host tick</td><td>messages journal and PWR/HDD state</td></tr></tbody></table></section>
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
    title: "CS ASM 1.0",
    summary: "Build, inspect, execute, and reference instructions",
    partId: "understand-compile",
    kind: "tutorial",
    appliesTo: allProfiles,
  },
  basic: {
    title: "CS QBASIC 1.0",
    summary: "DOS IDE, editor, compatibility, and source subset",
    partId: "understand-compile",
    kind: "tutorial",
    appliesTo: ["cs-dos", "cs386sx"],
  },
  "c-family": {
    title: "CS C/C++ 1.0",
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
    title: "CS-DOS 1.0 on CS386SX",
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
    id: "nethack",
    title: "Build and play NetHack",
    summary:
      "Rebuild the guest-authored game, play it, and manage saves safely.",
    chapterIds: [
      "orientation",
      "terminal-editor",
      "io-files",
      "shell",
      "c-family",
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
