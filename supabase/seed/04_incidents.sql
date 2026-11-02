-- SYNTHETIC past incidents for the filmed mineral water plant (plant_id = 'waterplant').
-- These are staged scenarios written for the demo. They are not records of real events.
-- Telemetry values come from the simulated PLC points in plants/waterplant/instruments.yaml.
-- Field readings (dials, valve levers) are invented to match the photos and the pack ranges.
-- Pressure is in psi (red scale). No micron rating is stated anywhere in this file.
-- Each trace lives in 05_incident_trace.sql and must be loaded after this file.

insert into incidents (incident_id, plant_id, title, status, severity, opened_at, closed_at,
                       symptoms, root_cause, resolution, sops_used, closed_by, lessons,
                       data_origin, models_used) values

('INC-2026-0118', 'waterplant',
 'Line 1 back housing gauge reads low; interstage valve left half closed',
 'closed', 'medium',
 '2026-03-09 07:12:00+05:30', '2026-03-09 09:40:00+05:30',
 '[{"tag":"PI-205","reading_psi":9,"nominal_psi":16,"low_alarm_psi":15,"source":"field_photo"},
   {"tag":"PI-201","reading_psi":24,"nominal_psi":24,"source":"field_photo","note":"line 1 front, same line"},
   {"tag":"PI-206","reading_psi":16,"nominal_psi":16,"source":"field_photo","note":"line 2 back, same row"}]'::jsonb,
 'A hand-operated valve between the line 1 front and back housings was left at about 45 degrees after a housing change. It restricted flow to the back housing. The gauge was fine and the elements were not loaded. The valve has no tag in the pack yet.',
 'The operator opened the interstage valve to 0 degrees (lever in line with the pipe). PI-205 read 15 psi about 13 minutes later and 16 psi at the hourly re-read. The verifier closed the incident on two stable readings.',
 array['SOP-CB-002', 'SOP-CB-004'],
 'verifier',
 'After any housing change, photograph every lever on that line and re-read the back housing within 30 minutes. The interstage valve needs a tag in the pack.',
 'synthetic',
 array['muse-wonder-1.0']),

('INC-2026-0163', 'waterplant',
 'RO tripped on raw tank low after borewell interruption; pre-filter PF-101 loaded',
 'closed', 'high',
 '2026-05-20 06:20:00+05:30', '2026-05-20 08:40:00+05:30',
 '[{"tag":"ST-RO","value":"FAULT (2)","since":"06:19"},
   {"tag":"FC-RO","value":13,"meaning":"RAW_TANK_LOW","since":"06:19"},
   {"tag":"LSL-101","value":"raw tank low-level switch asserted","since":"05:02"},
   {"tag":"YS-101","value":"feed pump stopped","since":"05:41"}]'::jsonb,
 'The borewell pump tripped on its own breaker at about 04:20 and the raw tank drew down. The RO tripped on raw tank low. After refill, the coarse pre-filter PF-101 was about 70 percent covered with sediment from the draw-down. That would have restricted flow to the cartridge bank and HP pump suction on restart.',
 'The breaker was reset at 06:45 and supply was back at 06:50. LSL-101 cleared at 07:08 as the tank refilled. The operator cleaned the PF-101 element, refitted the bowl and restarted the RO at 08:02. ST-RO stayed RUNNING with no fault code.',
 array['SOP-RO-001', 'SOP-GEN-006'],
 'verifier',
 'A raw tank low trip after a supply failure may not be the whole story. Check the coarse pre-filter before the RO is restarted. The pack has no supply status point for BW-001, so the borewell breaker was only found by a person on site.',
 'synthetic',
 array['muse-wonder-1.0']),

('INC-2026-0207', 'waterplant',
 'Permeate TDS drifting up over nine days; softener SOF-103 exhausted',
 'closed', 'low',
 '2026-07-14 08:00:00+05:30', '2026-07-17 10:30:00+05:30',
 '[{"tag":"AIT-301","value_ppm":19,"nominal_ppm":15,"high_alarm_ppm":25,"trend":"14 ppm on 2026-07-05, rising slowly to 19 ppm"}]'::jsonb,
 'The softener SOF-103 had run past its resin capacity with no regeneration logged since 2026-06-22. Hardness and sodium leaked past it into the RO feed, and permeate TDS crept up over nine days. Raw water did not step, and the RO inlet pressure on PI-301 was normal.',
 'SOF-103 was regenerated per SOP-MF-003 on 2026-07-14 and returned to service at 14:05. The softener outlet hardness strip read zero about 43 hours later. AIT-301 was back at 15 ppm by 2026-07-17 and was no longer rising.',
 array['SOP-MF-003', 'SOP-RO-005'],
 'verifier',
 'A slow rise in permeate TDS is a softener question first. Check the softener logbook before any membrane work. Log every regeneration, because the logbook gap is what hid this.',
 'synthetic',
 array['muse-wonder-1.0']),

('INC-2026-0258', 'waterplant',
 'Front housings on lines 2 and 4 rising after ACF-102 backwash; rinse step skipped',
 'closed', 'medium',
 '2026-09-22 08:05:00+05:30', '2026-09-23 12:10:00+05:30',
 '[{"tag":"PI-202","reading_psi":31,"nominal_psi":24,"high_alarm_psi":34,"trend":"27 psi on 2026-09-20, 29 psi on 2026-09-21"},
   {"tag":"PI-204","reading_psi":30,"nominal_psi":24,"high_alarm_psi":34,"source":"field_photo"}]'::jsonb,
 'The carbon filter ACF-102 was backwashed on 2026-09-20 in one fast move, and the rinse step was skipped. Service was restarted the same afternoon. The bed was not settled, so carbon fines left the bottom outlet and loaded the front housings on lines 2 and 4. The coarse pre-filter PF-101 was clean and was not the source.',
 'ACF-102 was rinsed to drain for 20 minutes on RT-M2-RINSE. The line 2 and line 4 front elements were replaced per SOP-CB-004. PI-202 and PI-204 both read 24 psi after the change, and the verifier closed the incident.',
 array['SOP-CB-004'],
 'verifier',
 'A backwash is not finished until the rinse step is done. A front-row rise on two lines in two days points to fines, not normal loading.',
 'synthetic',
 array['muse-wonder-1.0']);
