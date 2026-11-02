import React from 'react';
import { usePlant } from '../../context/PlantContext';
import { SignalsGrid } from '../console/SignalsGrid';
import { HypothesisTree } from '../console/HypothesisTree';
import { FocusLedger } from '../console/FocusLedger';
import { FieldCompanion } from '../field/FieldCompanion';

export const RecordingStudio: React.FC = () => {
  const {
    activeIncident,
    activeScenario,
    stepIndex,
    triggerScenario,
    advanceStep,
    resetPlant,
    isRunningDemo,
    readings,
  } = usePlant();

  const curFlow = readings['FIT-301']?.value ?? 8.4;
  const isClogged = activeIncident && curFlow < 5;

  const captions = [
    'Step 1: Spark watcher detects drift — output drops without triggering standard PLC trip.',
    'Step 2: Wonder recalls SOP-07 and past incidents. Three hypotheses compete, but digital sensors have no API for ΔP.',
    'Step 3: Wonder dispatches a bounded physical check to the Field Companion phone.',
    'Step 4: Phone photo arrives. SAM 3.1 segments dials; Wonder reads 1.6 bar ΔP (> 1.2 bar SOP limit).',
    'Step 5: Cause confirmed: Cartridge Clogged. Wonder proposes staged valve action under safety policy.',
    'Step 6: Commander approves proposal. Operator executes staged 45° move. SAM 3.1 verifies angle.',
    'Step 7: Backwash initiated without water hammer. Deterministic verifier monitors telemetry recovery curve.',
    'Step 8: RESOLVED — Flow restored to 8.4 m³/h. Incident closed by telemetry verifier.',
  ];

  return (
    <div style={{ padding: '0 18px 24px' }}>
      {/* NARRATOR CAPTION BANNER FOR RECORDING */}
      <div
        style={{
          background: '#181A1C',
          color: '#F9FAFB',
          border: '1.5px solid #22252A',
          padding: '10px 18px',
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontFamily: 'var(--font-mono)',
          borderRadius: 2,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="chip" style={{ background: '#E05326', color: '#fff', border: 0 }}>
            🎬 NARRATOR OVERLAY
          </span>
          <span style={{ fontSize: 13, fontWeight: 600 }}>
            {stepIndex >= 0 && stepIndex < captions.length
              ? captions[stepIndex]
              : 'Press ▶ RUN 3-MINUTE HACKATHON DEMO to watch Wonder & SAM debug unmetered physical equipment.'}
          </span>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="primary"
            disabled={isRunningDemo && stepIndex < 7}
            onClick={() => triggerScenario('filter')}
          >
            ▶ RUN 3-MINUTE DEMO
          </button>
          <button
            type="button"
            disabled={!activeScenario || stepIndex >= 7}
            onClick={advanceStep}
          >
            NEXT STEP →
          </button>
          <button type="button" onClick={resetPlant}>
            ↺ RESET
          </button>
        </div>
      </div>

      {/* SPLIT SCREEN WORKBENCH */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.35fr) minmax(360px, 0.85fr)',
          gap: 18,
          alignItems: 'start',
        }}
      >
        {/* LEFT COLUMN: COMMANDER HMI & REASONING */}
        <div style={{ display: 'grid', gap: 16 }}>
          {/* ANIMATED PLANT FLOW SCHEMATIC */}
          <section className="section-card">
            <div className="card-header">
              <h2 className="card-title">PHYSICAL PROCESS FLOW SCHEMATIC · PACKAGED WATER TREATMENT</h2>
              <span className={`chip ${isClogged ? 'critical' : 'good'}`}>
                {isClogged ? 'FLOW RESTRICTION AT CF-201' : 'ALL FLOW LINES NOMINAL'}
              </span>
            </div>

            <div className="card-body" style={{ padding: 12 }}>
              <svg viewBox="0 0 880 180" style={{ width: '100%', height: 'auto', background: '#FAF8F4', border: '1px solid #D8D4CA' }}>
                {/* PIPES */}
                <line x1={80} y1={90} x2={220} y2={90} stroke="#2563EB" strokeWidth={isClogged ? 3 : 5} />
                <line x1={220} y1={90} x2={360} y2={90} stroke="#2563EB" strokeWidth={isClogged ? 3 : 5} />
                <line x1={360} y1={90} x2={500} y2={90} stroke={isClogged ? '#DC2626' : '#2563EB'} strokeWidth={isClogged ? 3 : 5} strokeDasharray={isClogged ? '6 4' : 'none'} />
                <line x1={500} y1={90} x2={640} y2={90} stroke={isClogged ? '#DC2626' : '#2563EB'} strokeWidth={isClogged ? 2 : 5} />
                <line x1={640} y1={90} x2={780} y2={90} stroke={isClogged ? '#9CA3AF' : '#15803D'} strokeWidth={isClogged ? 2 : 5} />

                {/* NODES */}
                {/* 1: Raw Tank */}
                <rect x={20} y={50} width={60} height={80} rx={4} fill="#FFFFFF" stroke="#22252A" strokeWidth={1.5} />
                <text x={50} y={92} textAnchor="middle" fontSize={10} fontFamily="var(--font-mono)" fontWeight={700}>TK-101</text>
                <text x={50} y={106} textAnchor="middle" fontSize={8} fill="#6B7280" fontFamily="var(--font-mono)">RAW TANK</text>

                {/* 2: Feed Pump */}
                <circle cx={150} cy={90} r={22} fill="#FFFFFF" stroke="#22252A" strokeWidth={1.5} />
                <text x={150} y={94} textAnchor="middle" fontSize={9} fontFamily="var(--font-mono)" fontWeight={700}>PMP-102</text>

                {/* 3: Sand/Carbon Filters */}
                <rect x={240} y={54} width={70} height={72} rx={4} fill="#FFFFFF" stroke="#22252A" strokeWidth={1.5} />
                <text x={275} y={92} textAnchor="middle" fontSize={10} fontFamily="var(--font-mono)" fontWeight={700}>MGF-103</text>
                <text x={275} y={106} textAnchor="middle" fontSize={8} fill="#6B7280" fontFamily="var(--font-mono)">FILTERS</text>

                {/* 4: Cartridge Filter CF-201 (FOCUS CHOKEPOINT) */}
                <rect
                  x={390}
                  y={46}
                  width={90}
                  height={88}
                  rx={4}
                  fill={isClogged ? '#FEF2F2' : '#FFFFFF'}
                  stroke={isClogged ? '#DC2626' : '#E05326'}
                  strokeWidth={isClogged ? 2.5 : 1.5}
                />
                <text x={435} y={82} textAnchor="middle" fontSize={11} fontFamily="var(--font-mono)" fontWeight={800} fill={isClogged ? '#DC2626' : '#181A1C'}>
                  CF-201 A/B
                </text>
                <text x={435} y={98} textAnchor="middle" fontSize={8} fill="#6B7280" fontFamily="var(--font-mono)">
                  5µ CARTRIDGE
                </text>
                <text x={435} y={114} textAnchor="middle" fontSize={8} fontWeight={700} fill="#E05326" fontFamily="var(--font-mono)">
                  PG-1 ○—○ PG-2
                </text>

                {/* 5: HP Pump */}
                <circle cx={560} cy={90} r={22} fill="#FFFFFF" stroke="#22252A" strokeWidth={1.5} />
                <text x={560} y={94} textAnchor="middle" fontSize={9} fontFamily="var(--font-mono)" fontWeight={700}>PMP-301</text>

                {/* 6: RO Membrane Skid */}
                <rect x={640} y={54} width={90} height={72} rx={4} fill="#FFFFFF" stroke="#22252A" strokeWidth={1.5} />
                <text x={685} y={92} textAnchor="middle" fontSize={10} fontFamily="var(--font-mono)" fontWeight={700}>RO-302</text>
                <text x={685} y={106} textAnchor="middle" fontSize={8} fill="#6B7280" fontFamily="var(--font-mono)">MEMBRANES</text>

                {/* 7: Product Output */}
                <rect x={780} y={62} width={70} height={56} rx={4} fill="#FFFFFF" stroke="#22252A" strokeWidth={1.5} />
                <text x={815} y={94} textAnchor="middle" fontSize={10} fontFamily="var(--font-mono)" fontWeight={700}>TK-401</text>
                <text x={815} y={106} textAnchor="middle" fontSize={8} fill="#15803D" fontFamily="var(--font-mono)">PURE 8.4m³</text>
              </svg>
            </div>
          </section>

          {/* TELEMETRY SIGNALS */}
          <SignalsGrid />

          {/* REASONING & HYPOTHESES */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <FocusLedger />
            <HypothesisTree />
          </div>
        </div>

        {/* RIGHT COLUMN: SIMULATED FIELD COMPANION PHONE */}
        <div
          style={{
            background: '#FFFFFF',
            border: '2px solid #22252A',
            padding: 16,
            boxShadow: '4px 4px 0px rgba(0,0,0,0.1)',
            minHeight: 640,
          }}
        >
          <div
            style={{
              paddingBottom: 10,
              borderBottom: '1.5px solid #22252A',
              marginBottom: 14,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontFamily: 'var(--font-mono)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#15803D' }} />
              <strong style={{ fontSize: 12 }}>FIELD COMPANION · MOBILE HUD</strong>
            </div>
            <span className="chip">RAMESH (TECHNICIAN)</span>
          </div>

          <FieldCompanion />
        </div>
      </div>
    </div>
  );
};
