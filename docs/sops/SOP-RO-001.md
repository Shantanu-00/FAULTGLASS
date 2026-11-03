SYNTHETIC - written for the demo, not an approved site procedure

# SOP-RO-001: HP pump low-suction trip (RO FAULT 11)

Trigger: PSL-301 reads LOW_PRESSURE_TRIP (setpoint 14.5 psi, falling), FC-RO reads 11 (LOW_SUCTION_PRESSURE), ST-RO reads FAULT. Fault codes are simulated; the real HMI error log decides.

Diagnose in this order. Telemetry checks come first because they cost nothing; valve work comes last. Media and softener sit upstream of the cartridge bank, so a media fault can cause the same low suction.

1. Feed. Read LSL-101 (raw tank level) and YS-101 (feed pump P-101 run state). If LSL-101 is LOW_LEVEL, stop: this is a raw tank fault (FC-RO 13), not this SOP.
2. Pre-filter. Look at PF-101 for visible loading. There is no dial on PF-101 in the pack, so this is a visual check only.
3. Cartridge bank. Photograph the inlet gauge PI-201 and the outlet gauge PI-202 (red psi scale), let code compute dP = PI-201 minus PI-202, and apply SOP-CB-002. dP at or above 12 psi points to the cartridge bank; dP near 8 psi means the restriction is elsewhere.
4. Media. Check the lever positions of the MGF-101, ACF-102 and SOF-103 manifolds against SOP-GEN-006. No media vessel dials are modelled. If PI-201 and PI-202 both read low together with dP near normal, the restriction is upstream of the bank. Propose a sand filter backwash under SOP-MF-003. The model proposes; the operator confirms.

Keep P-301 stopped until the cause is fixed and SOP-RO-005 is followed. PSL-301 chatter near 14.5 psi means cavitation risk.

Record every reading with its tag, unit (psi) and time.
