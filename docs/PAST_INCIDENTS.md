# Past incidents (SYNTHETIC) for the waterplant demo

These four incidents are staged scenarios written for the demo. They are not records of real events. Every row has `data_origin = 'synthetic'`. Telemetry tags are the simulated PLC points (`plants/waterplant/instruments.yaml`). Dial and valve readings are invented to fit the footage and the pack ranges. No micron rating is stated anywhere.

Seed files:
- `supabase/seed/04_incidents.sql`: one row per incident in `incidents`.
- `supabase/seed/05_incident_trace.sql`: ordered steps in `incident_trace` (22 to 24 per incident).

The live demo recalls these through `recall_incident`. Each trace shows what the model did: hypotheses created, rejected or confirmed, tool calls and results, field tasks for things with no API, and the verifier's closure.

| Incident | Opened | Asset(s) | Cause | Hypotheses rejected | Closed by |
| --- | --- | --- | --- | --- | --- |
| INC-2026-0118 | 2026-03-09 | PI-205, E-CB-MID1 (untagged interstage valve), line 1 | Interstage valve left at about 45 degrees after a housing change | H1 gauge fault, H3 system-wide low pressure | verifier |
| INC-2026-0163 | 2026-05-20 | RO-301 (ST-RO, FC-RO 13), LSL-101, BW-001, PF-101 | Borewell breaker tripped, raw tank drew down; PF-101 about 70 percent loaded | H1 level switch false, H3 feed pump failure | verifier |
| INC-2026-0207 | 2026-07-14 | AIT-301, SOF-103 | Softener exhausted, no regeneration logged since 2026-06-22 | H1 source TDS step, H2 membrane scaling | verifier |
| INC-2026-0258 | 2026-09-22 | PI-202, PI-204, ACF-102, V-223, V-225 | ACF-102 backwashed in one move, rinse skipped; fines loaded line 2 and line 4 front housings | H1 normal loading, H2 PF-101 loaded | verifier |

## What each incident teaches the model

- **0118**: a gauge that reads low is checked for a fault first, then for a restriction between the front and back housings. The header is checked so the search stays local.
- **0163**: a raw tank low trip is checked against the level switch, the feed pump and the supply before the RO is restarted. A pre-filter check comes before restart.
- **0207**: a slow ramp in permeate TDS is checked for a step in the source before membrane work. The softener logbook gap is what explains it.
- **0258**: a rise on two front housings in two days is treated as fines, not normal loading. The backwash and rinse valves are checked by hand, since they have no streamed position.

## Notes for the demo

- Lines 1, 2 and 4 are used. Line 3 and V-113 are not used.
- The RO fault code used is 13 (RAW_TANK_LOW), not the demo's low suction story.
- SOP ids match `supabase/seed/03_sops.sql`.
- The untagged interstage valve in 0118 is not in the pack yet. Mapping it to a tag is an open item.
