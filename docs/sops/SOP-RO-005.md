SYNTHETIC - written for the demo, not an approved site procedure

# SOP-RO-005: RO restart after fault code clear

Precondition: the cause from SOP-RO-001 is fixed and recorded. Do not clear FC-RO on the HMI before that; the fault returns.

Steps:
1. Clear the fault on the HMI only after the precondition holds.
2. Confirm FC-RO reads 0 (NONE) and ST-RO reads STOPPED (0), not FAULT (2).
3. Confirm PSL-301 reads OK (1), YS-101 reads RUNNING, LSL-101 reads LEVEL_OK.
4. Confirm cartridge dials PI-201 to PI-208 pass SOP-CB-002.
5. Photograph the NV-301 reject needle valve position and record it. Do not change it unless the start-up sheet says so.
6. Start P-301 at the controller. Confirm YS-301 reads RUNNING (1).
7. Watch ST-RO. A pass through FLUSH (3) is expected and is not a fault. FAULT (2), or FC-RO not 0, means stop P-301 and return to SOP-RO-001.
8. Confirm PSH-301 reads OK (1). High discharge trip is 261 psi, rising.
9. Read permeate TDS (AIT-301 via telemetry; nominal 15 ppm, high alarm 25 ppm). Read FI-301 (permeate, nominal 2000 L/h, low alarm 1500) and FI-302 (concentrate, nominal 700 L/h) by eye on the console.
10. The verifier must hold a stable window on telemetry before the restart is accepted.

Caution: a restart does not close the incident. Close-out follows SOP-GEN-007.
