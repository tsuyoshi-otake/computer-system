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
        <p class="manual-lead">A Computer is a persistent, sandboxed machine. Its terminal, files, redstone state, CPU budget, and RAM belong to its identity and survive normal world reloads.</p>
      </header>
      <div class="manual-spec-line"><span>CPU ID</span><b>CS486DX</b><span>Nominal clock</span><b>33 MHz</b><span>Byte order</span><b>Little-endian</b></div>
      <section class="manual-section">
        <h3>1.1 Operating cycle</h3>
        <ol class="manual-procedure">
          <li><b>Inspect.</b> Run <code>cpuinfo</code>, <code>free -h</code>, and <code>quota</code>.</li>
          <li><b>Edit.</b> Use <code>vi</code> for source files. MicroPython starts at <code>/startup.py</code>.</li>
          <li><b>Build.</b> Use <code>as</code>, <code>basicc</code>, <code>cc</code>, or <code>c++</code>; add <code>-c</code> for an object and combine objects with <code>ld</code>.</li>
          <li><b>Measure.</b> Run compiled programs with <code>run --stats</code>.</li>
          <li><b>Optimize.</b> Compare instructions, cycles, output, and memory use—not host wall time.</li>
        </ol>
      </section>
      <section class="manual-section manual-grid-2">
        <div><h3>Persistent</h3><p><code>/etc</code>, <code>/usr</code>, home files, executables, terminal snapshot, identity, and configured hardware.</p></div>
        <div><h3>Volatile or bounded</h3><p><code>/tmp</code>, active VM frames, event queues, compiler work, terminal output, retries, and each direct CS486 run.</p></div>
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
      <header class="manual-page-header"><p class="manual-kicker">Chapter 02 · Hardware model</p><h2>The CS486DX execution core</h2><p class="manual-lead">The visible 33 MHz identity is nominal. A separate persisted scheduler scale bounds actual BDS work and arbitrates multiple Computers fairly.</p></header>
      <figure class="manual-figure manual-figure--desktop"><img src="/assets/manual/desktop-computer-system.png" alt="Desktop Computer System with a 486DX 33 MHz system unit, monochrome CRT, keyboard, mouse, and floppy drives" loading="lazy" decoding="async"><figcaption><b>Desktop Computer System.</b> The workstation illustration establishes the nominal CS486DX hardware identity. The Minecraft implementation models the machine rather than emulating the pictured host hardware literally.</figcaption></figure>
      <section class="manual-section"><h3>2.1 Register file</h3>
        <table><thead><tr><th>Register</th><th>Conventional use</th><th>Width</th></tr></thead><tbody>
          <tr><td>EAX</td><td>Accumulator and expression result</td><td>32 bit</td></tr><tr><td>EBX</td><td>Secondary operand</td><td>32 bit</td></tr>
          <tr><td>ECX</td><td>Loop counter</td><td>32 bit</td></tr><tr><td>EDX</td><td>General data</td><td>32 bit</td></tr>
          <tr><td>ESI / EDI</td><td>Source / destination index</td><td>32 bit</td></tr><tr><td>ESP / EBP</td><td>Stack top / initial stack base</td><td>32 bit</td></tr>
        </tbody></table>
      </section>
      <section class="manual-section manual-grid-2"><div><h3>2.2 Memory model</h3><p>RAM is a checked, little-endian linear byte array. <code>LOAD</code> and <code>STORE</code> transfer signed 32-bit words. The stack begins at the top of RAM and grows downward.</p></div><div class="manual-memory-map"><span>LOW ADDRESS</span><b>compiler variables</b><b>free / heap convention</b><b>↓ stack growth</b><span>HIGH ADDRESS</span></div></section>
      <section class="manual-section"><h3>2.3 Cycle classes</h3><table><thead><tr><th>Class</th><th>Examples</th><th>Cost</th></tr></thead><tbody><tr><td>Simple</td><td>MOV, ADD, SUB, CMP, branch</td><td>1</td></tr><tr><td>Memory / stack</td><td>LOAD, STORE, PUSH, POP</td><td>2</td></tr><tr><td>Call control</td><td>CALL, RET</td><td>3</td></tr><tr><td>Multiply</td><td>MUL</td><td>9</td></tr><tr><td>Divide</td><td>DIV, MOD</td><td>40</td></tr><tr><td>Output</td><td>PRINT</td><td>8 + payload</td></tr></tbody></table></section>
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
    title: "MicroPython on CS486",
    summary: "Boot, imports, and native modules",
    html: `
      <header class="manual-page-header"><p class="manual-kicker">Chapter 06 · CS486 language runtime</p><h2>Computer System MicroPython</h2><p class="manual-lead">The MicroPython-compatible language compiles to the same resumable CS486 process as C, C++, ASM, and BASIC. Source in <code>/startup.py</code> starts when the Computer powers on; there is no separate Python VM.</p></header>
      <section class="manual-section manual-grid-2"><div><h3>6.1 Edit and boot</h3><pre><code>vi /startup.py
        reboot</code></pre><p>Normal completion powers the program down. Infinite work remains preemptible by the common CS486 scheduler.</p></div><div><h3>6.2 Core language</h3><p>Variables, numbers, strings, booleans, lists, tuples, dictionaries, functions, imports, conditionals, loops, exceptions, formatting, and bounded built-ins compile to CS486 call/jump control flow and allowlisted managed-runtime syscalls.</p></div></section>
      <section class="manual-section"><h3>6.3 Native modules</h3><table><thead><tr><th>Module</th><th>Purpose</th><th>Representative calls</th></tr></thead><tbody>
        <tr><td>os</td><td>Identity, time, events, timers, lifecycle</td><td>get_computer_id, clock, sleep, pull_event, queue_event, shutdown, reboot</td></tr>
        <tr><td>term</td><td>Fixed-cell terminal</td><td>write, clear, set_cursor_pos, set_text_color</td></tr>
        <tr><td>fs</td><td>Sandbox filesystem</td><td>read_file, write_file, exists, make_dir, get_size, get_free_space</td></tr>
        <tr><td>redstone</td><td>Six-sided digital / analog I/O</td><td>get_input, get_analog_input, set_output</td></tr>
        <tr><td>shell</td><td>Terminal shell adapter</td><td>banner, prompt, submit, keys</td></tr>
      </tbody></table></section>
      <section class="manual-section"><h3>6.4 Python modules</h3><pre><code># /home/computer/main.py
import helper
print(helper.answer())</code></pre><p>Module lookup checks the importing file's directory, then <code>/lib/python</code> and <code>/usr/lib/computer-system/python</code>. DOS also uses <code>C:\\LIB\\PYTHON</code>. A <code>.py</code> module initializes once. Missing, circular, oversized, and failed imports stop with <code>ImportError</code>.</p></section>
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
      <section class="manual-section"><h3>5.1 Linux layout</h3><table><thead><tr><th>Path</th><th>Role</th></tr></thead><tbody><tr><td>/etc</td><td>System configuration and bash startup</td></tr><tr><td>/dev</td><td>Virtual devices</td></tr><tr><td>/proc</td><td>Dynamic CPU and memory information</td></tr><tr><td>/tmp</td><td>Volatile working files</td></tr><tr><td>/usr</td><td>Userland hierarchy</td></tr><tr><td>/home/computer</td><td>Default user home</td></tr></tbody></table></section>
      <section class="manual-section manual-grid-2"><div><h3>5.2 Terminal state</h3><p>The fixed-cell model is the source of truth. Web and Resource Pack UIs render snapshots. Writer leases prevent simultaneous input; viewers must take control explicitly.</p></div><div><h3>5.3 World state</h3><p>Inputs and outputs are side-addressed. Digital and analog observations enter through bounded events; output state persists with the Computer record.</p></div></section>
      <section class="manual-section"><h3>5.4 Storage model</h3><p>Bedrock World Dynamic Properties stored in world LevelDB are canonical. Snapshots use checksum-backed transactional pages and preserve the current and previous complete generations. SQLite is not used by the Bedrock runtime.</p><pre><code>df
du -s /home/computer
quota
stat /startup.py</code></pre></section>
      <aside class="manual-warning"><b>Independent ceilings</b><p>RAM, disk quota, per-file size, entry count, pipeline buffer, output size, and CPU cycles are separate limits. Free disk does not imply free VM RAM.</p></aside>`,
  },
  {
    id: "terminal-editor",
    number: "03",
    title: "Terminal and vi",
    summary: "Keyboard, viewport, editing workflow",
    html: `
      <header class="manual-page-header"><p class="manual-kicker">Chapter 03 · Operator console</p><h2>Terminal control and source editing</h2><p class="manual-lead">The terminal is a fixed-cell machine display. The Web Terminal enlarges the visible grid with the browser viewport while preserving the same cells, cursor, colors, and input semantics.</p></header>
      <section class="manual-section"><h3>3.1 Keyboard map</h3><table><thead><tr><th>Key</th><th>Shell action</th><th>vi action</th></tr></thead><tbody><tr><td>Enter</td><td>Submit command</td><td>Insert newline</td></tr><tr><td>Tab</td><td>Complete command or path</td><td>Insert indentation</td></tr><tr><td>↑ / ↓</td><td>Command history</td><td>Move cursor</td></tr><tr><td>Ctrl+C</td><td>Bounded interrupt</td><td>Interrupt current input</td></tr><tr><td>Ctrl+V</td><td>Paste clipboard text</td><td>Paste in insert mode</td></tr></tbody></table></section>
      <section class="manual-section manual-grid-2"><div><h3>3.2 Normal mode</h3><div class="manual-command-bank"><p><b>Move</b> h j k l, arrows</p><p><b>Edit</b> i a o x dd</p><p><b>History</b> u</p><p><b>Save + quit</b> Shift+ZZ</p><p><b>Leave insert</b> Esc or Ctrl+[</p></div></div><div><h3>3.3 Command mode</h3><div class="manual-command-bank"><p><b>Save</b> :w</p><p><b>Quit</b> :q</p><p><b>Save + quit</b> :wq or :wq!</p><p><b>Discard</b> :q!</p></div></div></section>
      <section class="manual-section"><h3>3.4 Editing procedure</h3><ol class="manual-procedure"><li>Open a file with <code>vi program.py</code>.</li><li>Press <code>i</code>; enter source. Syntax colors and rainbow indentation are enabled initially.</li><li>Press Escape, type <code>:w</code>, and press Enter.</li><li>Run or compile from the shell. Reopen the file to correct reported lines.</li></ol></section>
      <aside class="manual-callout"><b>Selection and clipboard</b><p>Drag across rendered terminal text to select it. Copy with Ctrl+C after selection; paste into the active writer session with Ctrl+V. A viewer can select and copy, but cannot submit input until it takes control.</p></aside>`,
  },
  {
    id: "redstone-peripherals",
    number: "08",
    title: "Redstone and peripherals",
    summary: "Sides, signals, events, adapters",
    html: `
      <header class="manual-page-header"><p class="manual-kicker">Chapter 08 · World interface</p><h2>Connecting programs to Minecraft</h2><p class="manual-lead">World I/O crosses a narrow adapter boundary. A program observes snapshots and bounded events; it never calls Bedrock APIs directly.</p></header>
      <div class="manual-spec-line"><span>Sides</span><b>6</b><span>Digital</span><b>false / true</b><span>Analog input</span><b>0…15</b></div>
      <section class="manual-section"><h3>8.1 Side names</h3><table><thead><tr><th>Name</th><th>Meaning</th><th>Use</th></tr></thead><tbody><tr><td>top / bottom</td><td>Vertical faces</td><td>Stacks and floor wiring</td></tr><tr><td>front / back</td><td>Relative to block orientation</td><td>Operator-facing machines</td></tr><tr><td>left / right</td><td>Relative lateral faces</td><td>Relay and control pairs</td></tr></tbody></table></section>
      <section class="manual-section"><h3>8.2 Polling and events</h3><pre><code>import os
import redstone

while True:
    os.pull_event("redstone")
    level = redstone.get_analog_input("left")
    redstone.set_output("right", level &gt;= 8)</code></pre><p>Use <code>pull_event</code> instead of a tight polling loop. It yields the VM until relevant work exists and avoids consuming the machine's cycle budget while idle.</p></section>
      <section class="manual-section"><h3>8.3 Output checklist</h3><ol class="manual-procedure"><li>Confirm orientation before assigning side names.</li><li>Read the existing input and decide a safe default output.</li><li>Handle startup before waiting for the first change event.</li><li>On failure, leave an explicit terminal state; do not spin-retry.</li></ol></section>
      <aside class="manual-warning"><b>Capability-dependent interfaces</b><p>Computer, Pocket, Monitor, Speaker, and other block behavior is exposed only when the relevant adapter exists. Missing capability calls fail explicitly rather than impersonating unavailable hardware.</p></aside>`,
  },
  {
    id: "dos-profile",
    number: "14",
    title: "DOS profile",
    summary: "386SX portable command and path conventions",
    html: `
      <header class="manual-page-header"><p class="manual-kicker">Chapter 14 · Compatibility profile</p><h2>Operating in the DOS environment</h2><p class="manual-lead">The portable profile presents a 386SX 16 MHz machine with 2 MB RAM and a DOS command environment. The current sandbox keeps execution, storage, identity, and security policy on the shared verified core while adapting the operator-facing machine profile.</p></header>
      <figure class="manual-figure manual-figure--portable"><img src="/assets/manual/portable-computer-system.png" alt="Portable 386SX 16 MHz Computer System with 2 MB RAM showing a DOS prompt, monochrome LCD, keyboard, trackball, floppy drive, rear ports, and battery pack" loading="lazy" decoding="async"><figcaption><b>Portable Computer System.</b> A DOS laptop concept built around a 386SX at 16 MHz with 2 MB RAM. Its tighter clock and memory targets distinguish it from the desktop workstation; a CPU-specific instruction timing table remains separate from the current shared execution core.</figcaption></figure>
      <section class="manual-section"><h3>14.1 Correspondence table</h3><table><thead><tr><th>Task</th><th>Linux profile</th><th>DOS profile</th></tr></thead><tbody><tr><td>List</td><td>ls</td><td>DIR</td></tr><tr><td>Read</td><td>cat FILE</td><td>TYPE FILE</td></tr><tr><td>Change directory</td><td>cd /tmp</td><td>CD C:\\TMP</td></tr><tr><td>Copy / move</td><td>cp / mv</td><td>COPY / MOVE</td></tr><tr><td>Remove</td><td>rm</td><td>DEL</td></tr><tr><td>Machine info</td><td>cpuinfo / free</td><td>CPU / MEM</td></tr><tr><td>Version</td><td>uname</td><td>VER</td></tr></tbody></table></section>
      <section class="manual-section manual-grid-2"><div><h3>14.2 Layout</h3><pre><code>C:\\
├─ DOS
├─ TEMP
        └─ USERS\\COMPUTER</code></pre></div><div><h3>14.3 Conventions</h3><p>Commands and drive paths are case-insensitive. Backslash is the displayed separator, CRLF is the text convention, and <code>NUL</code> is the null device. DOS paths resolve through the same checked guest filesystem.</p></div></section>
      <section class="manual-section"><h3>14.4 Toolchain continuity</h3><pre><code>CC PROGRAM.C -O PROGRAM
RUN --STATS PROGRAM
OBJDUMP PROGRAM</code></pre><p>The assembler and language compilers target the same CS486 executable format. Switching profiles does not turn guest programs into host DOS or x86 binaries.</p></section>
      <aside class="manual-callout"><b>One core, two shells</b><p>New profiles should adapt naming and syntax at the shell boundary. They must not fork persistence, execution accounting, identity, or security policy.</p></aside>`,
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
      <section class="manual-section"><h3>13.2 Cost priorities</h3><table><thead><tr><th>Priority</th><th>Question</th><th>Typical action</th></tr></thead><tbody><tr><td>O(N)</td><td>Does work scale with input or nested iteration?</td><td>Change the algorithm first</td></tr><tr><td>Serial fraction</td><td>What remains under global scheduling?</td><td>Remove repeated setup and output</td></tr><tr><td>Opcode cost</td><td>Are DIV/MOD or PRINT dominant?</td><td>Strength-reduce or batch</td></tr><tr><td>Memory pressure</td><td>Are live objects forcing O(N) scans?</td><td>Release references and reuse buffers</td></tr></tbody></table></section>
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
