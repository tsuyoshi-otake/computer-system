# Bedrock feasibility matrix

Target environment: Minecraft Bedrock 1.26.30+, `@minecraft/server` 2.8.0, and
`@minecraft/server-ui` 2.1.0, without Beta APIs.

| Capability                            | Status                    | Evidence                                                                                                                                                   | Production decision                                                                                                       |
| ------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Stable pack and script loading        | supported                 | GDK client recognized both packs and loaded the stable Script API bundle without Beta API experiments                                                      | Keep stable module pins and validate on every Bedrock update                                                              |
| Instruction-budgeted runtime          | supported                 | Tester completed the in-game 20-computer runtime probe; host tests also prove equal 40-tick scheduling                                                     | Start with 200 instructions per slice and 1,000 globally                                                                  |
| 51x19 terminal UI                     | supported_with_constraint | GDK client displayed all 19 fixed-width rows and live updates; input controls required vertical scrolling                                                  | Use DDUI for the first vertical slice; prototype a denser production terminal view                                        |
| Terminal input and finalization       | supported_with_constraint | Live input mirrored `hello computer`; Submit cleared it; Terminate and Close ended as ServerClosed and ClientClosed                                        | Map every close reason to an explicit VM result; retain bounded redraw and focus handling                                 |
| Connected monitor rendering and touch | pending                   | Monitor probe                                                                                                                                              | pending                                                                                                                   |
| Six-sided redstone input              | supported_with_constraint | BDS sampled power 15 independently from all six adjacent positions; `onRedstoneUpdate` emitted zero reliable events                                        | Poll six neighbors at a bounded rate and synthesize change events                                                         |
| Independent digital redstone output   | supported_with_constraint | BDS verified all 64 face masks twice using redstone lamps                                                                                                  | Generate 64 hidden fixed-output block types; swap type by mask                                                            |
| Independent analog output fallback    | supported_with_constraint | BDS verified all 16 levels and simultaneous power 4/12 from two separate Redstone Interface blocks in both sessions                                        | Use one oriented interface endpoint per independent analog channel; generate fixed power types                            |
| Persistent item and block identity    | supported_with_constraint | The non-stackable Pocket Computer retained its Dynamic Property through chest storage, item-entity drop, and full BDS restart                              | Computer and pocket items must be non-stackable; store block identity by dimension/location                               |
| World Dynamic Property persistence    | supported                 | BDS 1.26.33.2 advanced the sequence from 1 to 2 across a full server restart; both reads and writes passed                                                 | Use world Dynamic Properties beneath the paged store                                                                      |
| Transactional paged storage           | supported                 | Automated tests prove page splitting, interrupted-write safety, integrity checks, and previous-generation recovery                                         | Use generation pages, a manifest, and an atomic head switch                                                               |
| Pocket computer lifecycle             | supported_with_constraint | Host tests cover use, inventory/container movement, drop, disconnect, duplicates, and bounded O(active) reconciliation; BDS proves custom-item persistence | Use event-driven ownership updates; keep only open sessions in the reconciliation set; verify player interaction manually |
| Transactional turtle operations       | supported_with_constraint | BDS verified move, occupied/unloaded/conflict rejection, forced rollback, drop recovery, and container transfer twice                                      | Use explicit resource leases; add real multiplayer and entity-removal conflict tests                                      |
| Pitched notes and registered sounds   | supported_with_constraint | BDS accepted two registered-sound calls at pitches 0.5 and 2.0                                                                                             | Keep registered sounds; human audibility and timing remain manual                                                         |
| Arbitrary PCM or DFPWM audio          | not_supported             | Stable sound APIs select registered sound identifiers and expose only pitch/volume                                                                         | Do not promise arbitrary streaming; ship a bounded registered sound palette                                               |

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

Independent analog strength remains unavailable on six faces of one computer
block because a producer has one shared power value. The tested fallback uses a
separate Redstone Interface endpoint per channel. The Phase 0 build generates 16
stable, non-experimental internal types and BDS observed exact levels 0 through
15 on redstone wire, including simultaneous levels 4 and 12.

Turtle world mutations use exclusive resource leases over source and destination
positions. A conflicting operation terminates as `conflict`; an unloaded
destination terminates as `unloaded`; commit and rollback both release all
leases. Host tests reject contradictory terminal transitions.

Pocket Computer item definitions use the current direct custom-component key
form. Bedrock 1.26 rejects the legacy `minecraft:custom_components` array during
item parsing. Each instance is non-stackable and carries a Dynamic Property ID.
Lifecycle reconciliation iterates only open sessions and has an explicit per-run
budget, so its cost is O(A) for A active pocket sessions rather than O(N) for
all items in all inventories.
