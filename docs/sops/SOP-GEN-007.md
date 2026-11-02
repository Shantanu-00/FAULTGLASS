SYNTHETIC - written for the demo, not an approved site procedure

# SOP-GEN-007: Incident close-out

An incident closes only when all of these are true:
1. Telemetry nominal for the plant state in use: FC-RO 0; PSL-301 and PSH-301 OK; LSL-101 LEVEL_OK; AIT-301 below its 25 ppm high alarm; ST-RO and YS-301 match the intended run state.
2. Cartridge dials PI-201 to PI-208 re-read on the red psi scale after the fix. No line flagged under SOP-CB-002.
3. Valve positions for the route in use match SOP-GEN-006, with fresh photos.
4. Any operator observation logged for the incident has been re-checked against a fresh photo reading and agrees.
5. Root cause, resolution and SOPs used are written in the incident record, with evidence cited.
6. The verifier's window has passed on the telemetry.

Who signs:
- The verifier (code) sets closed_by = verifier when all six hold. The model never closes an incident.
- The operator signs the on-site record of the physical checks (dial and lever photos).
- An operator-only close (closed_by = operator) needs a written reason and is marked as a manual override.
