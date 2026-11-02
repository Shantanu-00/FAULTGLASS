# LastMeter demo: the 3-minute video (source of truth)

Demo brand: **LastMeter** (repo codename FAULTGLASS). Everything the product must do is the
list below; anything not on screen in this video is out of scope until it is done.

Honesty rules for the video: plant telemetry is labelled **SIMULATED**; the gauge and valve
photos are real photos of a real plant; the incident is a staged scenario, not a claim that
the plant was faulty. Never say a model did something the code did (see "Who does what").

## Who does what

| Step | Model or code | Notes |
| --- | --- | --- |
| Watch live telemetry, flag drift | **Muse Spark Open** (Baseten) | Reads a summary card every ~10 s. Code computes the baseline, spread and distance per signal. Spark answers NORMAL, WATCH or FLAG as plain text that Python parses and checks against the card. It does not diagnose. |
| Find the gauge dials in the photo | **SAM 3.1** (`"pressure gauge"`, then optionally `"gauge needle"`) | Returns box + mask per instance. Locates only. One concept per request. |
| Read each dial (red psi scale) | **Muse Wonder** vision on each SAM crop | Cross-checked against needle angle computed from the SAM needle mask in Python. |
| Tell front row from back row | Python: position and size of the masks in the image, then the pack's layout | Wonder is given the result and the pack's front/back rule. |
| Marathi transcript | **Muse Voice Transcribe** (Marathi is a supported language) | ASR only. |
| Structure the transcript, compare with the photo reading | **Muse Wonder** | Agree or disagree is stated with both readings cited. |
| Plan, rule out hypotheses, re-plan, Active Memory and Focus | **Muse Wonder** (Responses API, tools, encrypted reasoning replay) | The focus ledger and recall graph display only what the model wrote and what tools returned. |
| Valve lever angle | **SAM 3.1** masks of lever and pipe + Python geometry | SAM is the locating sensor, code measures the angle. |
| Limits (staged travel 0, 45, 90), order, timers | Python policy | Model proposals are clamped. |
| Close the incident | Python verifier on telemetry | Never the model. |
| Mass-balance report (optional) | **Muse Code** headless run | Stretch. Supplementary report only. Cut the line from the script if it does not run for real. |

Muse Image is not used: it generates images and does not read them.

## Shot list

| Time | On screen | Voiceover gist |
| --- | --- | --- |
| 0:00-0:15 | Real footage: cartridge bank gauges, a lever, pipework. Console raises a signal flag from Spark: permeate flow 25% below baseline while suction pressure, motor current and TDS drift together. The PLC shows no alarm. | Industrial plants run on analog gauges and manual valves with no API. When flow drops without an alarm, SCADA cannot say why. LastMeter closes the last meter with Meta's multimodal models. |
| 0:15-0:50 | Phone camera on the cartridge bank. SAM masks light up the dials. Wonder reads them: front row high, back row low, one line much lower. A pressure-drop figure appears. | SAM 3.1 isolates the dials in messy light, Muse Wonder reads the glass and knows front is inlet side, back is outlet side. |
| 0:50-1:25 | Operator speaks Marathi. Live transcript, then a structured observation, then "AGREES / DISAGREES with photo". | Muse Voice Transcribe takes the operator's native Marathi; Wonder turns it into a checked observation. |
| 1:25-2:05 | **Reasoning view:** focus ledger (goal, hypotheses crossed out one by one using telemetry tool calls, blocker, next step) beside the memory graph (plant layout node, SOP section, past incident, site knowledge, each cited). Agent concludes line 3 is restricted, names sand filter fines as the likely source (stated as likely, not proven), and asks to backwash. | Active Memory recalls the layout, the procedure and a past case. Active Focus works the hypotheses until the evidence is enough. |
| 2:05-2:35 | Operator turns the backwash lever: HUD arc 0 degrees (open) to 45 degrees (50%), hold a few seconds, then 90 degrees (100%, closed). Guardrail beat: a one-move jump from 0 to 90 is blocked by code. The flow graph is shown only after the verifier checks the final readings. | SAM 3.1 masks the lever and our code measures the angle, so the staged 45-then-90 rule is checked, not trusted. |
| 2:35-3:00 | Console: verifier window passed, flow back to about 92% of baseline with no alarms, and a recommendation to replace the line 3 cartridge. Repo and live URL. | No sensor retrofit. The operator is the physical API for Meta's models. |

## Scenario numbers (simulated, set to match the real photo)

- Front-row gauges above 20 psi, back-row gauges below 20 psi. Fault: line 3 back gauge is
  far lower than its neighbours. The pressure drop shown on screen is computed from the
  psi values actually read, never typed in.
- Backwash valve `V-113` (sand filter backwash inlet): open lever 0 degrees (parallel to
  the pipe), 50% = 45 degrees, 100% = 90 degrees (perpendicular, closed). Hold at 45 degrees
  for a short timer (simulation clock may be sped up
  and must be labelled).
- Production decline (streamed, no PLC alarm): permeate flow `FIT-301` 2000 to 1500 L/h over
  60 simulated seconds, suction `PIT-301` 16.0 to 15.1 psi, discharge `PIT-302` 180 to 174 psi,
  motor current `JI-301` 9.0 to 7.2 A, TDS `AIT-301` 15 to 17 ppm. Pump states, level and
  pressure switches stay normal and `FC-RO` stays 0.
- After the verified backwash, flow recovers over 30 simulated seconds to about 1850 L/h, not
  2000. Backwashing the sand filter does not clear a loaded cartridge.
- Hypotheses to rule out with telemetry: raw tank low (`LSL-101`), feed pump (`YS-101`),
  membrane or TDS problem (`AIT-301`), HP pump fault (`YS-301` running, `PSL-301` and
  `PSH-301` normal, motor current down, so the pump is under-fed, not failing).

## Script corrections (do not say these)

- "80% of operating industrial assets have no digital sensors": no source yet. Cite one or cut it.
- "Muse Image reads differential pressure": wrong. Wonder (vision) reads it; Muse Image only generates images.
- "SAM 3.1 calculates angles": SAM returns masks; the angle is computed from the masks in code.
- "14-node twin": the modelled plant has 52 assets and 26 instruments; say "full plant twin".
- "2.4 bar": the dials are psi; show the figure the system actually computed.
- "ALL STAGES NOMINAL": not true after the backwash alone. Say flow recovered and the line 3 cartridge needs replacing.
- The valve clips do not identify which valve is turned. The lever is identified as `V-113` by the system overlay; never claim the footage itself shows the sand filter valve.

## Build order for this video

1. Done: simulator and PLC emulator, edge streamer, ingest API, operations console (telemetry).
2. Spark watcher writing signal flags: **done** (Baseten, see [SPARK_WATCHER.md](SPARK_WATCHER.md)); telemetry tools for Wonder: **done** (see [INVESTIGATOR.md](INVESTIGATOR.md)).
3. SOPs and past incidents (written): **done**; memory tools and focus ledger: **done** (INVESTIGATOR.md). Field-task evidence is manual entry until step 4 replaces it.
4. Gauge pipeline: SAM crops, Wonder read, needle-angle cross-check, front/back rule.
5. Voice pipeline and observation check.
6. Valve pipeline: lever and pipe masks, angle, policy.
7. Field Companion, then Operations Console (reasoning view first).
8. Deploy: Vercel, Lightsail, Supabase. Record.
