# FAULTGLASS — project and workflow map

Status: planning draft extracted from the user-provided discussion and the current
chat on 1 November 2026. This records intended behavior, user constraints, and open
choices. It does not claim that the application has been implemented or that the
earlier advisor's model, industrial, or hackathon claims have been verified.

The subsequent [architecture baseline](ARCHITECTURE.md) makes concrete implementation
recommendations and checks current model documentation. Use it for the proposed
build; this map preserves what was extracted from the earlier discussion.

Current architecture direction: React + TypeScript + Vite with a Three.js factory
view through React Three Fiber; Python + FastAPI for the backend and authoritative
process simulation; AWS Lightsail Containers for hosting; Supabase for persistent
data and files; Meta and Baseten for inference. The scene, process graph and floor
plan share versioned equipment IDs. Hosting uses eligible AWS credits; account
eligibility and capacity still need checking before deployment.

## 1. Product direction

FAULTGLASS is the project name for the PlantDebugger concept: an assistant that
investigates industrial equipment problems using available telemetry, a configured
plant map, and observations supplied by a field worker.

The starting problem is “the last meter has no API”: some useful measurements,
equipment positions, and site practices are accessible only through a person on
site. The assistant chooses the next useful check; the worker supplies physical
observations and task results.

### Explicit user direction

| Area | Direction established by the user |
| --- | --- |
| Initial domain | Water-pipe-related industry in India. |
| Available setting | A friend's mineral-water bottling plant in Otur, Maharashtra. Access has been mentioned; exact equipment and filming permissions remain to be established. |
| Reusability | Keep most of the architecture common; represent each site's equipment, connections, instruments, and rules explicitly. |
| Visual presentation | Show the factory in Three.js, linked to the same plant records used by the AI and simulator. |
| Hackathon focus | Adapt the Google-specific concept to the Meta stack, with substantive model roles. |
| Factory operation | The factory continues operating normally; demonstrate problem conditions through simulation. |
| Confidentiality | Keep the manufacturing process private and use only permitted, limited equipment footage. |
| Language | Account for Marathi-speaking workers. Transcription capability still needs validation. |
| Usability | Explain the process in plain language; use equipment names rather than relying on unexplained labels. |
| Diagnostic breadth | Demonstrate reasoning beyond a single fixed filter-switch sequence. Exact fault count remains open. |
| Grounding | The assistant must know which pipes connect, where gauges are, and whether an alternative path actually exists. |

## 2. Physical system represented

The earlier discussion used this illustrative process:

```text
Water source → raw-water tank → pretreatment filters → cartridge filter
             → high-pressure pump → RO treatment → treated-water tank → bottling
```

This is a conceptual example, not a verified map of the friend's plant. The exact
equipment order, branches, reject-water path, instruments, and standby equipment
must come from site information. The initial diagnostic scenario focuses on a
small water-treatment section; the full bottling process does not need to be
reproduced or filmed.

The plant map needs:

- Equipment identities, plain-language names, types, and locations.
- Pipe connections, upstream/downstream relationships, and branch paths.
- Gauge and sensor locations, measured quantities, units, and reading methods.
- Which information is digitally available and which requires a field visit.
- Which controls are manual, their known state, and permitted capabilities.
- Approved site limits, access constraints, and any confirmed alternative routes.

A standby filtered route is available to planning only when configured and
validated. The system must handle a site with no standby path. The earlier word
“bypass” must not be interpreted as permission to skip required water treatment.

## 3. End-to-end incident workflow

| Step | Intended behavior |
| --- | --- |
| 1. Load site context | Read the plant map, available measurements, approved capabilities, and relevant explicit site knowledge. |
| 2. Produce a symptom | Simulator injects a hidden fault and emits observable telemetry, such as reduced flow. The planner does not receive the hidden fault label. |
| 3. Open an incident | Record the alert and initial measurements; show the affected plant section in the operations view. |
| 4. Plan an investigation | Review topology, telemetry, hypotheses, completed checks, relevant history, and site knowledge. Choose the next useful observation. |
| 5. Dispatch a field task | Send a worker a specific equipment target and bounded instruction, such as photographing the inlet and outlet gauges. |
| 6. Persist and wait | Save incident and task state while waiting for evidence. Waiting must survive refreshes and backend restarts. |
| 7. Interpret returned evidence | Associate the photo, voice note, or task result with the correct asset and incident. Produce readings or classifications with uncertainty. |
| 8. Reassess | Update the supported explanations. Request another check, propose an allowed action, or escalate if evidence is insufficient. |
| 9. Validate a proposed action | Application code checks asset existence, available path, allowed action, state, limits, and task/action budgets before dispatch. |
| 10. Record action results | In the demo, apply the accepted action to the simulator. Capture the reported result and any required visual end-state evidence. |
| 11. Check the response | Compare subsequent telemetry with the expected recovery. Partial recovery or contradictory evidence leads back to investigation. |
| 12. Verify and close | Deterministic application code requires sustained recovery before setting RESOLVED. Otherwise the incident remains open or is escalated. |
| 13. Preserve the record | Keep tasks, evidence references, decision summaries, action history, and verification results. Store explicit human site knowledge separately for later incidents. |

The application owns persistence and reassembles the planner's context after each
pause. Model memory alone is not the storage mechanism.

The sequence is evidence driven. A fixed “photo → lever to 45° → lever to 90° (closed)” script is
not the intended general workflow. Missing equipment, unreadable evidence, failed
actions, and incomplete recovery need to lead to a different next step.

## 4. Two user experiences

| Operations / Commander view | Mobile field-worker view |
| --- | --- |
| Plant schematic and active incident | Assigned equipment and location |
| Current measurements and trends | Plain-language bounded task |
| Supported hypotheses and evidence summaries | Photo and voice-note submission |
| Next requested check and task progress | Actual task/action result |
| Verification state and incident history | Required end-state evidence |
| Audit events and site knowledge | Explicit site-knowledge contribution |

The visible diagnostic record should connect evidence, a concise decision summary,
and the next task. A separate native mobile application was not established as a
requirement; a mobile web interface was proposed.

## 5. Build components and storage

| Component | Responsibility | Data it needs or produces |
| --- | --- | --- |
| Frontend | Operations and field-worker experiences | Plant map, telemetry, tasks, incident status, uploads |
| Backend / workflow host | APIs, incident lifecycle, persisted waiting/resumption, model/tool calls | Incident state, task results, events |
| Plant configuration | Describe the particular site | Assets, pipe edges, instruments, capabilities, approved limits |
| Simulator | Normal behavior, fault injection, and response to demo actions | Telemetry time series; private fault state |
| Diagnostic planner | Select the next useful check or allowed action | Structured plant context, measurements, evidence, history, site knowledge |
| Image processing | Read gauges and assess visible equipment state | Original image, asset reference, optional masks/crops, derived result, uncertainty |
| Speech processing | Interpret worker voice input | Original audio, transcript, language, structured candidate observation or assertion |
| Deterministic guards and verifier | Enforce boundaries and decide recovery | Allowed actions, limits, budgets, state, telemetry window |
| Incident store | Preserve active and historical work | Hypotheses, checkpoints, tasks, actions, verifier results, audit events |
| Evidence store | Preserve original and derived evidence | Photos/audio, hashes, timestamps, incident/asset links, derived readings |
| Site-knowledge store | Reuse explicit operator assertions | Source, author, asset scope, original statement, translation, status |

Earlier implementation proposals were React/Next.js, Python/FastAPI, JSON plant
configuration, SQLite incident storage, local uploads or object storage, and SSE
or WebSockets for live updates. These are historical proposals; the current
architecture baseline above supersedes them for the implementation plan.

The intended access pattern is: the backend retrieves relevant plant configuration,
incident history, evidence results, and site knowledge, and provides that structured
context through model inputs or tools. The model does not have automatic access
to files or a database.

For a common architecture, keep workflow, evidence, persistence, guards, and model
interfaces separate from site configuration. A different site still needs its own
equipment map, operating rules, and simulator behavior; reusability does not imply
that one water-flow model represents every industry.

## 6. Model roles discussed

These are role proposals extracted from the earlier advice. Names, versions, API
access, features, language support, and hosting compatibility remain unverified.

The user specifically wants a substantive Wonder showcase: long-horizon diagnosis,
active memory/focus, and meaningful recovery or replanning across physical pauses.
These are desired demonstrations, not verified model/API capabilities.

| Desired role | Names used in the pasted discussion | Intended contribution |
| --- | --- | --- |
| Diagnostic planner | Muse Wonder | Select checks/tools, reassess evidence, and continue a multi-step incident. |
| Image interpretation | Muse Image | Interpret readable gauge and visible equipment evidence. |
| Segmentation | SAM / SAM 3.1 | Isolate a relevant gauge, handle, or pipe when that improves the inspection. |
| Speech / language | Muse Voice Transcribe, Muse Spark Open | Transcribe Marathi input and structure observations or explicit site assertions. |
| Optional coding / analysis | Muse Code | Perform additional calculations in a bounded sandbox if justified. |

Runtime code generation and specialized sub-agents were suggested as extensions.
They are not prerequisites established by the user. Generated analysis must not
replace the approved deterministic recovery criteria.

## 7. Candidate scenarios and demo format

| Scenario discussed | Role in the demo | Status |
| --- | --- | --- |
| Cartridge/pre-filter restriction | Main low-flow investigation using local gauge evidence and, if present, an approved alternative filtered path. | Leading walkthrough candidate; site details unverified. |
| Pump air/suction-related problem | Alternative explanation for low flow, requiring different checks. | Candidate additional simulation; exact fault and observations open. |
| RO membrane fouling/scaling | Alternative performance-loss explanation using additional evidence/history. | Candidate additional simulation; exact model and observations open. |

The earlier advice also called an air/water-hammer precaution during filter
switching a second “problem,” and a filter-versus-membrane comparison a third.
Those are not the same as three independent fault scenarios. This inconsistency
explains the unresolved one-demo-versus-three-demo question.

One detailed walkthrough plus two shorter simulator runs was proposed. It was not
explicitly approved as the final format. Ambiguous photos, wrong asset/state,
partial recovery, and interrupted tasks were also discussed as possible behavior
checks, not additional mandatory product modules.

## 8. Real, simulated, and recorded evidence

| Source | Intended use |
| --- | --- |
| Real plant photos / footage | Demonstrate permitted equipment context and actual image interpretation. |
| Real worker voice recording | Demonstrate local-language input and explicit site-knowledge capture. |
| Simulated telemetry | Provide repeatable normal and fault conditions without connecting to factory controls. |
| Simulated actions | Change simulator state and observe the response. |
| Labeled fault fixtures / replay | A clarification identified during this mapping: scenario-consistent evidence is needed when an actual fault is not present. The approach remains open. |

The following evidence clarifications were identified while mapping the concept;
they are not previously agreed implementation choices.

A healthy-plant photo must not be described as confirming a simulated high pressure
drop that is not visible in it. Real images may demonstrate normal-state inspection;
fault-state fixtures, recordings, or a separate test setup need clear provenance.
Previously recorded evidence should be identifiable as replay rather than presented
as a new field observation.

The discussed filming inventory includes readable gauge close-ups, filter/pipe
context, a valve and its visible state, an operator using the phone, and a short
Marathi voice note. Exact shots depend on permission and equipment present. No
live valve movement or plant interruption is required to create the simulation;
this is a proposed demonstration boundary, not an agreed filming procedure.

## 9. Boundaries inherited from the original concept

- The planner chooses the next step; application code validates the step.
- The model receives observable evidence, not the simulator's hidden answer.
- Unknown assets and unavailable actions must be rejected by the application.
- Unreadable or ambiguous evidence may return UNCERTAIN and require another check.
- Action limits, step budgets, durable state, idempotency, and evidence hashes belong
  to ordinary application code.
- Critical physical end states require the evidence defined for that task.
- Sustained recovery is checked by deterministic code; a model statement cannot
  independently resolve an incident.
- Explicit operator assertions can become site knowledge. Model diagnoses and
  temporary incident evidence are not silently promoted into permanent plant facts.
- Actual operating limits and procedures must be site supplied; the pasted examples
  are not operating instructions.

## 10. Still to establish before implementation

1. A permitted, simplified site map: actual equipment, connections, gauges, digital
   measurements, and whether a standby filtered path exists.
2. A final fault set and the evidence needed to distinguish each scenario.
3. Scenario-consistent fault evidence and the real-versus-simulated demo presentation.
4. Official model/API access, verified capabilities, and a Marathi input test.
5. Deployment sizing, AWS credit eligibility, and integration checks for the
   selected stack described in the architecture baseline.
6. Site-approved limits and recovery criteria for the demonstration model.
7. Permission for the selected photos/audio and the friend's role, if any. Team and
   prize arrangements were questions in the discussion, not settled decisions.

The attachment's prize odds, market statistics, rule interpretations, deadlines,
guaranteed confidentiality, exact gauge thresholds, valve-opening percentages,
angle-to-flow claims, and sample hydraulic code are not accepted project facts.
The current repository remains a scaffold with this planning record.
