# Bedrock feasibility matrix

Target environment: Minecraft Bedrock 1.26.30+, `@minecraft/server` 2.8.0, and
`@minecraft/server-ui` 2.1.0, without Beta APIs.

| Capability                            | Status                    | Evidence                                                                                                                                                                                     | Production decision                                                                                      |
| ------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Stable pack and script loading        | supported                 | GDK client recognized both packs and loaded the stable Script API bundle without Beta API experiments                                                                                        | Keep stable module pins and validate on every Bedrock update                                             |
| Instruction-budgeted runtime          | supported                 | Tester completed the in-game 20-computer runtime probe; host tests also prove equal 40-tick scheduling                                                                                       | Start with 200 instructions per slice and 1,000 globally                                                 |
| Runtime performance baseline          | supported_with_constraint | 48,776-byte bundle; two BDS sessions kept every measured scheduler tick below the 1 ms clock resolution and within a 50 ms budget; zero memory warning signals                               | Retain the Phase 0 budgets; repeat on low-end hardware and in multiplayer soak tests                     |
| 51x19 terminal UI                     | supported_with_constraint | GDK client displayed all 19 fixed-width rows and live updates; input controls required vertical scrolling                                                                                    | Use DDUI for the first vertical slice; prototype a denser production terminal view                       |
| Terminal input and finalization       | supported_with_constraint | Live input produces `terminal_line`; GDK proved Terminate and Close; host tests map terminate, cancel, disconnect, competing-form, server-close, and failure to terminal results             | Preserve the explicit result model in the production view; retain bounded redraw and focus handling      |
| Connected monitor rendering and touch | superseded                | Historical host/BDS/GDK probes proved a 3x2/51x18 surface and coordinate mapping before the production hardware redesign                                                                     | Production Desktop/Advanced machines use one all-in-one block with a built-in CRT and direct interaction |
| Six-sided redstone input              | supported_with_constraint | BDS sampled power 15 independently from all six adjacent positions; `onRedstoneUpdate` emitted zero reliable events                                                                          | Poll six neighbors at a bounded rate and synthesize change events                                        |
| Independent digital redstone output   | supported_with_constraint | BDS verified all 64 face masks twice using redstone lamps                                                                                                                                    | Generate 64 hidden fixed-output block types; swap type by mask                                           |
| Independent analog output fallback    | supported_with_constraint | BDS verified all 16 levels and simultaneous power 4/12 from two separate Redstone Interface blocks in both sessions                                                                          | Use one oriented interface endpoint per independent analog channel; generate fixed power types           |
| Persistent item and block identity    | supported_with_constraint | The non-stackable Portable Computer System retained its ID through container, item-entity, placed-block mapping, block-to-item round trip, and full BDS restart                              | Computer and portable items must be non-stackable; store block identity by dimension/location            |
| World Dynamic Property persistence    | supported                 | BDS 1.26.33.2 advanced the sequence from 1 to 2 across a full server restart; both reads and writes passed                                                                                   | Use world Dynamic Properties beneath the paged store                                                     |
| Transactional paged storage           | supported                 | Automated tests prove page splitting, interrupted-write safety, integrity checks, and previous-generation recovery                                                                           | Use generation pages, a manifest, and an atomic head switch                                              |
| Portable computer lifecycle           | supported                 | Host tests cover use, inventory/container movement, drop, disconnect, duplicates, and bounded O(active) reconciliation; BDS proves custom-item persistence; GDK item use opened the terminal | Use event-driven ownership updates and keep only open sessions in the reconciliation set                 |
| Transactional turtle operations       | supported_with_constraint | BDS verified move, inspect, break, place, occupied/unloaded/conflict rejection, forced rollback, drop recovery, and container transfer twice                                                 | Use explicit resource leases; add real multiplayer and entity-removal conflict tests                     |
| Pitched notes and registered sounds   | supported_with_constraint | BDS accepted two registered-sound calls at pitches 0.5 and 2.0                                                                                                                               | Keep registered sounds; human audibility and timing remain manual                                        |
| Arbitrary PCM or DFPWM audio          | not_supported             | Stable sound APIs select registered sound identifiers and expose only pitch/volume                                                                                                           | Do not promise arbitrary streaming; ship a bounded registered sound palette                              |

Statuses are `supported`, `supported_with_constraint`, `not_supported`, or
`pending`. Every non-green capability must have a documented fallback before a
production phase depends on it.

The redstone output implementation deliberately avoids custom block states.
Those states still require the Holiday Creator Features experiment in the stable
Bedrock documentation. Computer System instead generates 64 internal block
identifiers (one per digital face mask), preserving the no-experiments baseline.
The visible resource and logical computer identity remain shared.

The GDK DDUI probe was verified at 1280x1024. Observable updates advanced while
the form remained open, but rapid label replacement occasionally produced a
partial frame during redraw. The production terminal must coalesce updates and
must not refresh its full label every scheduler slice.

The form API reports `ClientClosed`, `ServerClosed`, or `UserBusy`; an invalid
player after a rejected show is classified as disconnected. The host-tested
terminal session owns exactly one final result and ignores later callbacks.
Stable APIs do not expose arbitrary raw key-down/up events, global shortcuts,
pixel-perfect pointer motion, or a ComputerCraft-equivalent framebuffer.

Independent analog strength remains unavailable on six faces of one computer
block because a producer has one shared power value. The tested fallback uses a
separate Redstone Interface endpoint per channel. The Phase 0 build generates 16
stable, non-experimental internal types and BDS observed exact levels 0 through
15 on redstone wire, including simultaneous levels 4 and 12.

Turtle world mutations use exclusive resource leases over source and destination
positions. A conflicting operation terminates as `conflict`; an unloaded
destination terminates as `unloaded`; commit and rollback both release all
leases. Host tests reject contradictory terminal transitions.

Portable Computer System item definitions use the current direct
custom-component key form. Bedrock 1.26 rejects the legacy
`minecraft:custom_components` array during item parsing. Each instance is
non-stackable and carries a Dynamic Property ID. Lifecycle reconciliation
iterates only open sessions and has an explicit per-run budget, so its cost is
O(A) for A active portable sessions rather than O(N) for all items in all
inventories.

Stable Script APIs expose block-face interaction coordinates but no supported
world-facing text or arbitrary texture drawing surface. The retired Phase 0
standalone-display probe discovered a rectangular 3x2 frame and mapped its
north-face interactions to a 51x18 cell grid. That evidence remains useful, but
production Desktop and Advanced machines now use a built-in CRT and resolve the
touched Computer directly. Distance-dependent visual cost does not apply to
DDUI; a custom world renderer remains out of scope for the stable Add-On
baseline.
