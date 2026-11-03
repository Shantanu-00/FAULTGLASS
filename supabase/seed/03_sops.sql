-- SYNTHETIC SOPs for the waterplant demo. The site has none; these were written for the demo.
-- Bodies mirror docs/sops/<sop_id>.md. Tags used are from plants/waterplant (assets, instruments.yaml, process/).
-- Text uses dollar quoting so no quote escaping is needed.

insert into sops (sop_id, title, version, applies_to, triggers, requires_human, steps, body_md, data_origin) values

('SOP-RO-001', 'HP pump low-suction trip (RO FAULT 11)', '1.0',
 ARRAY['P-301','P-101','TK-101','RO-301','PF-101','MGF-101','ACF-102','SOF-103','CB-1F','CB-1B','CB-2F','CB-2B','CB-3F','CB-3B','CB-4F','CB-4B'],
 ARRAY['HP PUMP LOW SUCTION TRIP','RO FAULT 11','low suction','LOW_PRESSURE_TRIP','PSL-301','FC-RO','cavitation'],
 true,
 $steps$[
  {"n":1,"action":"Receive trip: PSL-301 LOW_PRESSURE_TRIP, FC-RO 11, ST-RO FAULT","actor":"system","asset":"PSL-301","expect":"PSL-301 = 0, FC-RO = 11, ST-RO = 2","caution":"Fault codes are simulated; the real HMI error log decides."},
  {"n":2,"action":"Confirm HP pump P-301 is stopped from telemetry (read only, no command)","actor":"model","asset":"YS-301","expect":"YS-301 = 0 (STOPPED)","caution":"Read only."},
  {"n":3,"action":"Read raw tank level","actor":"model","asset":"LSL-101","expect":"LEVEL_OK","caution":"If LOW_LEVEL, stop: raw tank fault (FC-RO 13), not this SOP."},
  {"n":4,"action":"Read feed pump P-101 run state","actor":"model","asset":"YS-101","expect":"YS-101 = 1 (RUNNING)","caution":"If STOPPED, the feed is the cause; go back to step 3."},
  {"n":5,"action":"Visual check of the pre-filter for visible loading","actor":"operator","asset":"PF-101","expect":"No visible loading","caution":"No dial in the pack; visual only."},
  {"n":6,"action":"Photograph the inlet gauge PI-201 and the outlet gauge PI-202 and read the red psi scale; apply SOP-CB-002","actor":"operator","asset":"PI-201","expect":"Two psi readings recorded by tag","caution":"Red psi scale only. Never the black kg/cm2 scale."},
  {"n":7,"action":"Compute dP = PI-201 minus PI-202 and flag a restricted bank at dP of 12 psi or more (provisional rule)","actor":"code","asset":"PI-202","expect":"Bank flagged restricted, or not","caution":"Thresholds are PROVISIONAL."},
  {"n":8,"action":"Check media manifold lever positions against SOP-GEN-006","actor":"operator","asset":"MGF-101","expect":"Positions match the service route","caution":"No media vessel dials are modelled."},
  {"n":9,"action":"If PI-201 and PI-202 both read low together with dP near normal, or dP is 12 psi or more, propose sand filter backwash under SOP-MF-003","actor":"model","asset":"MGF-101","expect":"Proposal with cited evidence","caution":"Proposal only. The operator confirms and code policy clamps."},
  {"n":10,"action":"Keep P-301 stopped until the cause is fixed and SOP-RO-005 is followed","actor":"operator","asset":"P-301","expect":"YS-301 = 0","caution":"PSL-301 chatter near 14.5 psi means cavitation risk."}
 ]$steps$::jsonb,
 $body$SYNTHETIC - written for the demo, not an approved site procedure

# SOP-RO-001: HP pump low-suction trip (RO FAULT 11)

Trigger: PSL-301 reads LOW_PRESSURE_TRIP (setpoint 14.5 psi, falling), FC-RO reads 11 (LOW_SUCTION_PRESSURE), ST-RO reads FAULT. Fault codes are simulated; the real HMI error log decides.

Diagnose in this order. Telemetry checks come first because they cost nothing; valve work comes last. Media and softener sit upstream of the cartridge bank, so a media fault can cause the same low suction.

1. Feed. Read LSL-101 (raw tank level) and YS-101 (feed pump P-101 run state). If LSL-101 is LOW_LEVEL, stop: this is a raw tank fault (FC-RO 13), not this SOP.
2. Pre-filter. Look at PF-101 for visible loading. There is no dial on PF-101 in the pack, so this is a visual check only.
3. Cartridge bank. Photograph the inlet gauge PI-201 and the outlet gauge PI-202 (red psi scale), let code compute dP = PI-201 minus PI-202, and apply SOP-CB-002. dP at or above 12 psi points to the cartridge bank; dP near 8 psi means the restriction is elsewhere.
4. Media. Check the lever positions of the MGF-101, ACF-102 and SOF-103 manifolds against SOP-GEN-006. No media vessel dials are modelled. If PI-201 and PI-202 both read low together with dP near normal, the restriction is upstream of the bank. Propose a sand filter backwash under SOP-MF-003. The model proposes; the operator confirms.

Keep P-301 stopped until the cause is fixed and SOP-RO-005 is followed. PSL-301 chatter near 14.5 psi means cavitation risk.

Record every reading with its tag, unit (psi) and time.
$body$,
 'synthetic'),

('SOP-CB-002', 'Cartridge bank differential check (red psi scale)', '1.0',
 ARRAY['HDR-CB-IN','HDR-CB-OUT','CB-1F','CB-1B','CB-2F','CB-2B','CB-3F','CB-3B','CB-4F','CB-4B'],
 ARRAY['cartridge bank','cartridge differential','differential pressure','restricted bank','PI-201','PI-202','inlet outlet'],
 true,
 $steps$[
  {"n":1,"action":"Photograph the inlet gauge PI-201 on CB-1F square-on with the needle visible","actor":"operator","asset":"PI-201","expect":"One sharp photo of the inlet gauge","caution":"Re-shoot if glare hides the needle."},
  {"n":2,"action":"Photograph the outlet gauge PI-202 on CB-1B square-on with the needle visible; add an optional voice note","actor":"operator","asset":"PI-202","expect":"One sharp photo of the outlet gauge","caution":"One photo per gauge."},
  {"n":3,"action":"Read the red psi scale on each photo and record the value by tag","actor":"model","asset":"PI-201","expect":"Two psi values, each with its tag","caution":"Never read the black kg/cm2 scale. 1 kg/cm2 = 14.22 psi."},
  {"n":4,"action":"Compute dP as PI-201 minus PI-202","actor":"code","asset":"PI-202","expect":"One dP value in psi; normal about 8 psi (inlet about 24, outlet about 16)","caution":"Code computes dP; never typed in by hand."},
  {"n":5,"action":"dP of 12 psi or more (1.5 x normal) means the cartridge bank is restricted; the inlet rises and the outlet falls","actor":"code","asset":"CB-1F","expect":"Bank flagged restricted with both tags and dP","caution":"PROVISIONAL. Example: inlet 32 psi, outlet 15 psi, dP 17 psi."},
  {"n":6,"action":"dP near normal means the restriction is not in the bank; look upstream at the media filters or downstream at the RO","actor":"code","asset":"CB-1B","expect":"Not-in-bank result; go to SOP-RO-001 media step","caution":"PROVISIONAL rule."},
  {"n":7,"action":"If PI-201 and PI-202 both read low together, mark the cause as upstream of the bank","actor":"code","asset":"PI-201","expect":"Upstream flag; go to SOP-RO-001 media step","caution":"PROVISIONAL rule. PI-202 should agree with PIT-301 (about 16 psi)."},
  {"n":8,"action":"Record result with tags, psi values, dP and time","actor":"operator","asset":"CB-1B","expect":"Record complete","caution":null}
 ]$steps$::jsonb,
 $body$SYNTHETIC - written for the demo, not an approved site procedure

# SOP-CB-002: Cartridge bank differential check

Two dial gauges sit on the cartridge bank headers: PI-201 on the inlet side (front housing CB-1F) and PI-202 on the outlet side (back housing CB-1B). The four lines and 8 housings have no gauges of their own.

Each dial has two scales. Read the red psi scale only (range 0 to 100). The black kg/cm2 scale is not stored (1 kg/cm2 = 14.22 psi).

Reading:
1. Photograph the inlet gauge PI-201 square-on with the needle visible. Re-shoot if glare hides the needle.
2. Photograph the outlet gauge PI-202 the same way. One photo per gauge. A voice note is optional.
3. Record the psi value per tag.
4. dP = PI-201 minus PI-202 (psi). Code computes dP; do not type it in.

Reading the pattern (PROVISIONAL thresholds, to be checked on site):
- Normal: PI-201 about 24 psi, PI-202 about 16 psi, dP about 8 psi. PI-202 feeds the HP pump suction and should agree with the streamed PIT-301 (about 16 psi).
- dP at or above 12 psi (1.5 x normal): the cartridge bank is restricted. A restricted bank raises PI-201 and lowers PI-202 (for example inlet 32 psi, outlet 15 psi, dP 17 psi). The backwash of MGF-101 under SOP-MF-003 may be proposed, but backwash alone does not clear a loaded cartridge: flow recovers to about 92 percent and replacing the cartridge elements is still recommended (SOP-CB-004).
- dP only near normal (about 8 psi) while flow or suction is poor: the restriction is not in the cartridge bank. Look upstream at the media filters or downstream at the RO.
- PI-201 and PI-202 both low together: the cause is upstream of the bank. See SOP-RO-001, media step.
- If PI-202 disagrees with PIT-301 by a wide margin, suspect the gauge or the reading and re-shoot before acting.

The pack's instrument limits set a low alarm of 15 psi at the HP pump suction. The 12 psi dP threshold and the 24, 16 and 8 psi normals above are provisional and must be reconciled with that before use.
$body$,
 'synthetic'),

('SOP-MF-003', 'Sand filter MGF-101 backwash via V-113', '1.0',
 ARRAY['MGF-101','V-111','V-112','V-113','V-114','V-115','TF-101','TB-101','DRN-101'],
 ARRAY['backwash','sand filter','MGF-101','sand filter breakthrough','media carryover','V-113'],
 true,
 $steps$[
  {"n":1,"action":"Model proposes MGF-101 backwash with cited evidence","actor":"model","asset":"MGF-101","expect":"Proposal recorded with tags cited","caution":"Proposal only, not an action."},
  {"n":2,"action":"Policy check: staged travel 0 to 45 (hold timer) to 90; block any one-move jump from 0 to 90","actor":"code","asset":"V-113","expect":"Policy state: stage 45 pending","caution":"Model proposals are blocked by code."},
  {"n":3,"action":"Confirm feed pump P-101 is stopped (YS-101 STOPPED) and manifold work is safe","actor":"operator","asset":"YS-101","expect":"YS-101 = 0","caution":"Do not close manifold valves against a running pump."},
  {"n":4,"action":"Close service inlet V-111 to 90 deg","actor":"operator","asset":"V-111","expect":"Lever at 90 deg by photo","caution":"Route RT-M1-BACKWASH requires V-111 closed."},
  {"n":5,"action":"Close service outlet V-112 to 90 deg","actor":"operator","asset":"V-112","expect":"Lever at 90 deg by photo","caution":"Stops flow to the ACF-102 stage."},
  {"n":6,"action":"Open backwash outlet V-114 to 0 deg (drain side first)","actor":"operator","asset":"V-114","expect":"Lever at 0 deg by photo","caution":null},
  {"n":7,"action":"Backwash inlet V-113 open at 0 deg for backwash flow","actor":"operator","asset":"V-113","expect":"Lever at 0 deg by photo","caution":null},
  {"n":8,"action":"Backwash until the drain runs visibly clear","actor":"operator","asset":"DRN-101","expect":"Drain runs clear","caution":"Visual judgement; no turbidity threshold in the pack."},
  {"n":9,"action":"Staged close, stage 1: move V-113 to 45 deg (50% of travel)","actor":"operator","asset":"V-113","expect":"Lever at 45 deg by photo","caution":"Staged to avoid a sudden flow change."},
  {"n":10,"action":"Hold at 45 deg for the policy timer","actor":"code","asset":"V-113","expect":"Timer elapsed","caution":"A few seconds in the demo; simulation clock may be sped up and must be labelled."},
  {"n":11,"action":"Staged close, stage 2: move V-113 on to 90 deg (100% of travel, closed) only after the hold ends","actor":"operator","asset":"V-113","expect":"Lever at about 90 deg by photo, after a hold near 45 deg","caution":"A one-move jump from 0 to 90 is blocked by code."},
  {"n":12,"action":"Close backwash outlet V-114 to 90 deg","actor":"operator","asset":"V-114","expect":"Lever at 90 deg by photo","caution":null},
  {"n":13,"action":"Rinse: open V-111 and V-115 to 0 deg","actor":"operator","asset":"V-115","expect":"Levers at 0 deg by photo","caution":"Route RT-M1-RINSE."},
  {"n":14,"action":"Close V-115 to 90 deg when rinse is done","actor":"operator","asset":"V-115","expect":"Lever at 90 deg by photo","caution":null},
  {"n":15,"action":"Return to service: open V-112 to 0 deg; V-111 stays open; restart P-101","actor":"operator","asset":"V-112","expect":"V-111 and V-112 at 0 deg; YS-101 = 1","caution":null},
  {"n":16,"action":"Photograph each lever in route RT-M1-SERVICE (SOP-GEN-006)","actor":"operator","asset":"V-111","expect":"One photo per valve","caution":null},
  {"n":17,"action":"Verifier checks route RT-M1-SERVICE states and closes the check","actor":"code","asset":"MGF-101","expect":"All five valves match table; verifier pass","caution":"Only the verifier closes this check. The model does not."}
 ]$steps$::jsonb,
 $body$SYNTHETIC - written for the demo, not an approved site procedure

# SOP-MF-003: Sand filter MGF-101 backwash via V-113

Scope: backwash of the MGF-101 sand / dual-media vessel. Backwash inlet is V-113 (bottom). Backwash outlet is V-114 (to DRN-101). Service valves V-111 (top inlet) and V-112 (bottom outlet) must be closed.

Lever angle (yellow quarter-turn lever): 0 deg = open (parallel to pipe), 45 deg = half (50% of travel), 90 deg = closed (perpendicular to pipe, 100% of travel).

Rule: lever travel is staged. From 0 (open) the operator moves to about 45 deg (50% of travel), holds a few seconds, then continues to 90 deg (100% of travel, closed). A one-move jump from 0 to 90 is blocked by code. Staged to avoid a sudden flow change.

Who closes the check: the verifier (code) on telemetry. The model proposes and cites evidence; it does not close the check or mark a valve correct.

Steps (full detail in the steps field):
1. Model proposes backwash with evidence. Code applies the staged-travel policy: 0, then 45 with a hold timer, then 90.
2. Operator confirms YS-101 reads STOPPED.
3. Close V-111 to 90 deg, then V-112 to 90 deg.
4. Open V-114 to 0 deg (drain side first). Backwash inlet V-113 is open at 0 deg for backwash flow.
5. Backwash until the drain runs visibly clear.
6. Staged close of V-113: move to 45 deg (50% of travel). Hold for the policy timer (a few seconds in the demo).
7. Continue V-113 to 90 deg (100% of travel, closed) only after the hold ends. A one-move jump from 0 to 90 is blocked by code.
8. Close V-114 to 90 deg.
9. Rinse: open V-111 and V-115 to 0 deg. Close V-115 to 90 deg when done.
10. Return to service: open V-112 to 0 deg. V-111 stays open. Restart P-101.
11. Photograph each lever (SOP-GEN-006). The verifier checks route RT-M1-SERVICE and closes the check.

Caution: do not close manifold valves against a running pump.
$body$,
 'synthetic'),

('SOP-CB-004', 'Cartridge replacement', '1.0',
 ARRAY['CB-1F','CB-1B','CB-2F','CB-2B','CB-3F','CB-3B','CB-4F','CB-4B','HDR-CB-IN','HDR-CB-OUT'],
 ARRAY['cartridge replacement','cartridge change','swap cartridge','housing','restricted bank'],
 true,
 $steps$[
  {"n":1,"action":"Confirm the restricted bank with SOP-CB-002 (dP of 12 psi or more)","actor":"operator","asset":"PI-201","expect":"dP recorded from PI-201 and PI-202","caution":null},
  {"n":2,"action":"Stop P-301 and P-101; confirm both read STOPPED","actor":"operator","asset":"YS-301","expect":"YS-301 = 0 and YS-101 = 0","caution":"Stopping the feed also stops supply to the HP pump."},
  {"n":3,"action":"Close the isolating valve for the housing; record its tag","actor":"operator","asset":"HDR-CB-IN","expect":"Isolating valve closed; tag recorded","caution":"The pack has no isolation tag on the cartridge headers. Use only the tag recorded on site."},
  {"n":4,"action":"Open the vent; confirm PI-201 and PI-202 both read 0 psi before opening the housing","actor":"operator","asset":"PI-201","expect":"0 psi on both gauges (red scale)","caution":"Do not open a housing while PI-201 or PI-202 reads above zero."},
  {"n":5,"action":"Open the housing, remove the spent cartridge, photograph it in place","actor":"operator","asset":"CB-1F","expect":"Photo on record","caution":null},
  {"n":6,"action":"Fit the new cartridge, close the housing, check the seal","actor":"operator","asset":"CB-1F","expect":"Seal seated","caution":null},
  {"n":7,"action":"Open the isolating valve slowly; vent air until water runs; close the vent","actor":"operator","asset":"HDR-CB-IN","expect":"Water with no air","caution":null},
  {"n":8,"action":"Restart P-101; check the housing for leaks; let the bank settle","actor":"operator","asset":"YS-101","expect":"YS-101 = 1 and no leaks","caution":null},
  {"n":9,"action":"Photograph PI-201 and PI-202 again, read the red psi scale and compare with SOP-CB-002","actor":"model","asset":"PI-202","expect":"dP back near 8 psi, below 12 psi; PI-202 agrees with PIT-301","caution":"Thresholds are PROVISIONAL."},
  {"n":10,"action":"Verifier checks the recheck and records a pass before P-301 may start","actor":"code","asset":"YS-301","expect":"Pass recorded","caution":"Recheck must pass before P-301 restart."},
  {"n":11,"action":"Restart P-301 and watch PSL-301","actor":"operator","asset":"PSL-301","expect":"PSL-301 = 1 (OK)","caution":"Stop again if PSL-301 trips."}
 ]$steps$::jsonb,
 $body$SYNTHETIC - written for the demo, not an approved site procedure

# SOP-CB-004: Cartridge replacement

Scope: replacing the cartridge elements of the bank after SOP-CB-002 shows dP at or above 12 psi. Gauges: PI-201 (inlet) and PI-202 (outlet), red psi scale. The housings have no gauges of their own.

Gap: the pack has no isolation valve, vent or drain tag on the cartridge headers (HDR-CB-IN, HDR-CB-OUT). The operator identifies the isolating, vent and drain points on site and records their tags before work starts. Do not use a tag that is not recorded.

Steps:
1. Confirm the restricted bank with SOP-CB-002 (dP = PI-201 minus PI-202 at or above 12 psi).
2. Stop P-301 and P-101. Confirm YS-301 and YS-101 read STOPPED.
3. Close the isolating valve for the housing. Record its tag.
4. Open the vent. Confirm PI-201 and PI-202 both read 0 psi (red scale) before opening the housing.
5. Open the housing. Remove the spent cartridge. Photograph it in place.
6. Fit the new cartridge. Close the housing and check the seal.
7. Open the isolating valve slowly. Vent air until water runs, then close the vent.
8. Restart P-101. Check the housing for leaks and let the bank settle.
9. Photograph PI-201 and PI-202 again and read the red psi scale. Compare with SOP-CB-002. dP must be back near 8 psi (below 12 psi) and PI-202 must agree with PIT-301.
10. Only when step 9 passes, restart P-301. Watch PSL-301; stop again if it trips.

Caution: do not open a housing while PI-201 or PI-202 reads above zero. Do not restart P-301 before the recheck passes.
$body$,
 'synthetic'),

('SOP-RO-005', 'RO restart after fault code clear', '1.0',
 ARRAY['RO-301','P-301','NV-301'],
 ARRAY['RO restart','restart RO','fault cleared','FC-RO cleared','ST-RO'],
 true,
 $steps$[
  {"n":1,"action":"Clear the fault on the HMI only after the SOP-RO-001 cause is fixed and recorded","actor":"operator","asset":"FC-RO","expect":"Precondition recorded","caution":"Clearing before the cause is fixed means the fault returns."},
  {"n":2,"action":"Confirm FC-RO reads 0 (NONE) and ST-RO reads STOPPED (0), not FAULT (2)","actor":"system","asset":"FC-RO","expect":"FC-RO = 0 and ST-RO = 0","caution":null},
  {"n":3,"action":"Confirm PSL-301 reads OK (1)","actor":"model","asset":"PSL-301","expect":"PSL-301 = 1","caution":null},
  {"n":4,"action":"Confirm feed pump P-101 is RUNNING and raw tank level is LEVEL_OK","actor":"model","asset":"YS-101","expect":"YS-101 = 1 and LSL-101 LEVEL_OK","caution":null},
  {"n":5,"action":"Confirm cartridge bank gauges PI-201 and PI-202 pass SOP-CB-002","actor":"operator","asset":"PI-201","expect":"dP below 12 psi","caution":"Thresholds are PROVISIONAL."},
  {"n":6,"action":"Photograph the NV-301 reject needle valve position and record it; do not change it","actor":"operator","asset":"NV-301","expect":"Photo recorded; position unchanged","caution":"Change only if the start-up sheet says so."},
  {"n":7,"action":"Start P-301 at the controller; confirm RUNNING","actor":"operator","asset":"YS-301","expect":"YS-301 = 1","caution":"Watch PSL-301 during start."},
  {"n":8,"action":"Watch ST-RO through FLUSH; FAULT or FC-RO not 0 means stop P-301 and return to SOP-RO-001","actor":"system","asset":"ST-RO","expect":"Pass through FLUSH (3) then RUNNING (1)","caution":"FLUSH is expected and is not a fault."},
  {"n":9,"action":"Confirm PSH-301 reads OK (1)","actor":"model","asset":"PSH-301","expect":"PSH-301 = 1","caution":"High discharge trip is 261 psi, rising."},
  {"n":10,"action":"Read permeate rotameter FI-301 and concentrate rotameter FI-302 by eye on the console","actor":"operator","asset":"FI-301","expect":"FI-301 near 2000 L/h, not below 1500; FI-302 near 700 L/h","caution":"Rotameters are read by a person; no API."},
  {"n":11,"action":"Read permeate TDS AIT-301 against its limits","actor":"model","asset":"AIT-301","expect":"Nominal 15 ppm; below high alarm 25 ppm","caution":"Telemetry is SIMULATED."},
  {"n":12,"action":"Verifier holds a stable window on telemetry and accepts the restart","actor":"code","asset":"RO-301","expect":"Window passed","caution":"A restart does not close the incident. See SOP-GEN-007."}
 ]$steps$::jsonb,
 $body$SYNTHETIC - written for the demo, not an approved site procedure

# SOP-RO-005: RO restart after fault code clear

Precondition: the cause from SOP-RO-001 is fixed and recorded. Do not clear FC-RO on the HMI before that; the fault returns.

Steps:
1. Clear the fault on the HMI only after the precondition holds.
2. Confirm FC-RO reads 0 (NONE) and ST-RO reads STOPPED (0), not FAULT (2).
3. Confirm PSL-301 reads OK (1), YS-101 reads RUNNING, LSL-101 reads LEVEL_OK.
4. Confirm cartridge bank gauges PI-201 and PI-202 pass SOP-CB-002 (dP below 12 psi).
5. Photograph the NV-301 reject needle valve position and record it. Do not change it unless the start-up sheet says so.
6. Start P-301 at the controller. Confirm YS-301 reads RUNNING (1).
7. Watch ST-RO. A pass through FLUSH (3) is expected and is not a fault. FAULT (2), or FC-RO not 0, means stop P-301 and return to SOP-RO-001.
8. Confirm PSH-301 reads OK (1). High discharge trip is 261 psi, rising.
9. Read permeate TDS (AIT-301 via telemetry; nominal 15 ppm, high alarm 25 ppm). Read FI-301 (permeate, nominal 2000 L/h, low alarm 1500) and FI-302 (concentrate, nominal 700 L/h) by eye on the console.
10. The verifier must hold a stable window on telemetry before the restart is accepted.

Caution: a restart does not close the incident. Close-out follows SOP-GEN-007.
$body$,
 'synthetic'),

('SOP-GEN-006', 'Manual valve position verification by photo', '1.0',
 ARRAY['V-111','V-112','V-113','V-114','V-115','V-221','V-222','V-223','V-224','V-225','V-331','V-332','V-333','V-334','V-335'],
 ARRAY['valve position','lever angle','photo verification','valve check','manual valve'],
 true,
 $steps$[
  {"n":1,"action":"Set the route under test: service, backwash or rinse","actor":"operator","asset":"MGF-101","expect":"Route named","caution":"Applies to MGF-101, ACF-102 and SOF-103 manifolds."},
  {"n":2,"action":"Photograph each valve in the route with its pipe in the frame, from a fixed spot","actor":"operator","asset":"V-111..V-115","expect":"One photo per valve","caution":"Lever and pipe must both be visible."},
  {"n":3,"action":"Segment the lever and pipe masks (locate only)","actor":"model","asset":"V-111..V-115","expect":"Lever and pipe masks per valve","caution":"The model does not estimate the angle."},
  {"n":4,"action":"Measure each angle from the masks and compare with the lever angle table","actor":"code","asset":"V-111..V-115","expect":"Each measured angle matches its table value","caution":"0 deg = open, 45 deg = half (50% of travel, a stage only), 90 deg = closed (100% of travel)."},
  {"n":5,"action":"Report any mismatch with tag, measured angle and expected angle","actor":"code","asset":"V-111..V-115","expect":"Mismatch report, or none","caution":null},
  {"n":6,"action":"Correct each mismatched lever and re-photograph","actor":"operator","asset":"V-111..V-115","expect":"Re-photo matches table","caution":null},
  {"n":7,"action":"Verifier records the pass for the route","actor":"code","asset":"V-111..V-115","expect":"Pass recorded for the route","caution":"Only the verifier's pass counts. The model never marks a valve correct."}
 ]$steps$::jsonb,
 $body$SYNTHETIC - written for the demo, not an approved site procedure

# SOP-GEN-006: Manual valve position verification by photo

Rule: lever angle is taken from a photo, never by eye. Shoot the lever and the pipe it sits on in one frame, from a fixed spot. Segmentation (SAM 3.1) locates the lever and pipe; code measures the angle. A person's estimate does not count as verification.

Lever angle table (yellow quarter-turn levers): 0 deg = parallel to pipe = open; 45 deg = half, 50% of travel (a stage of the staged close, not a route state); 90 deg = perpendicular to pipe = closed, 100% of travel:

| Valve | Service | Backwash | Rinse |
| --- | --- | --- | --- |
| V-111 | 0 | 90 | 0 |
| V-112 | 0 | 90 | 90 |
| V-113 | 90 | 0 | 90 |
| V-114 | 90 | 0 | 90 |
| V-115 | 90 | 90 | 0 |

ACF-102 (V-221 to V-225) and SOF-103 (V-331 to V-335) use the same pattern with their own tags.

Steps:
1. Set the route under test: service, backwash or rinse.
2. Photograph each valve in the route with its pipe in frame.
3. Code measures each angle from the lever and pipe masks and compares with the table.
4. A mismatch is reported with tag, measured angle and expected angle. The operator corrects it and re-photographs.
5. Only the verifier's pass counts. The model never marks a valve correct.

Note: NV-301 is a needle valve, not a quarter-turn lever, and is not in this table. Numbers printed on some levers (e.g. #14, #17) are not mapped to V-tags; use the V-tags only.
$body$,
 'synthetic'),

('SOP-GEN-007', 'Incident close-out', '1.0',
 ARRAY['RO-301','P-301','MGF-101','ACF-102','SOF-103','TK-101'],
 ARRAY['incident close','close out','all stages nominal','verifier','closed'],
 true,
 $steps$[
  {"n":1,"action":"Check telemetry against nominal for the plant state in use","actor":"code","asset":"FC-RO","expect":"FC-RO 0; PSL-301 and PSH-301 OK; LSL-101 LEVEL_OK; AIT-301 below 25 ppm; ST-RO and YS-301 match intended run state","caution":null},
  {"n":2,"action":"Re-read cartridge bank gauges PI-201 and PI-202 on the red psi scale and photograph them","actor":"operator","asset":"PI-201","expect":"Photos on record","caution":"Red psi scale only."},
  {"n":3,"action":"Recheck dP = PI-201 minus PI-202 against SOP-CB-002","actor":"code","asset":"PI-202","expect":"dP below 12 psi","caution":"Thresholds are PROVISIONAL."},
  {"n":4,"action":"Confirm route valve positions with SOP-GEN-006 photos","actor":"operator","asset":"V-111..V-115","expect":"Verifier pass for the route","caution":null},
  {"n":5,"action":"Re-check any logged operator observation against a fresh photo reading","actor":"model","asset":null,"expect":"Observation agrees with photo, or is recorded as disagreeing","caution":"Cite both readings."},
  {"n":6,"action":"Draft root_cause, resolution and sops_used with cited evidence","actor":"model","asset":null,"expect":"Draft written; incident not closed","caution":"The model drafts only."},
  {"n":7,"action":"Sign the on-site record of the physical checks","actor":"operator","asset":null,"expect":"Signed record","caution":null},
  {"n":8,"action":"When all six conditions hold, set closed_by = verifier and status closed","actor":"code","asset":null,"expect":"Incident closed with closed_by = verifier","caution":"The model never closes an incident. Operator-only close needs a written reason."}
 ]$steps$::jsonb,
 $body$SYNTHETIC - written for the demo, not an approved site procedure

# SOP-GEN-007: Incident close-out

An incident closes only when all of these are true:
1. Telemetry nominal for the plant state in use: FC-RO 0; PSL-301 and PSH-301 OK; LSL-101 LEVEL_OK; AIT-301 below its 25 ppm high alarm; ST-RO and YS-301 match the intended run state.
2. Cartridge bank gauges PI-201 (inlet) and PI-202 (outlet) re-read on the red psi scale after the fix. dP below 12 psi under SOP-CB-002.
3. Valve positions for the route in use match SOP-GEN-006, with fresh photos.
4. Any operator observation logged for the incident has been re-checked against a fresh photo reading and agrees.
5. Root cause, resolution and SOPs used are written in the incident record, with evidence cited.
6. The verifier's window has passed on the telemetry.

Who signs:
- The verifier (code) sets closed_by = verifier when all six hold. The model never closes an incident.
- The operator signs the on-site record of the physical checks (gauge and lever photos).
- An operator-only close (closed_by = operator) needs a written reason and is marked as a manual override.
$body$,
 'synthetic')

on conflict (sop_id) do update set
  title = excluded.title,
  version = excluded.version,
  applies_to = excluded.applies_to,
  triggers = excluded.triggers,
  requires_human = excluded.requires_human,
  steps = excluded.steps,
  body_md = excluded.body_md,
  data_origin = excluded.data_origin;
