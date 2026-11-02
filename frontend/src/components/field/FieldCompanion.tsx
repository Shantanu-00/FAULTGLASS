import React, { useState } from 'react';
import { usePlant } from '../../context/PlantContext';
import { GaugeDialSvg } from './GaugeDialSvg';
import { ValveHandleSvg } from './ValveHandleSvg';

export const FieldCompanion: React.FC = () => {
  const {
    activeIncident,
    activeScenario,
    submitFieldEvidence,
    completeValveAction,
    stepIndex,
  } = usePlant();

  const [note, setNote] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [hasVoiceNote, setHasVoiceNote] = useState(false);

  const pendingTask = activeIncident?.field_tasks.find((t) => t.status === 'pending');
  const completedTasks = activeIncident?.field_tasks.filter((t) => t.status === 'completed') || [];

  const handleVoiceToggle = () => {
    if (!isRecording) {
      setIsRecording(true);
      setTimeout(() => {
        setIsRecording(false);
        setHasVoiceNote(true);
      }, 2000);
    }
  };

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', display: 'grid', gap: 16 }}>
      {/* TECHNICIAN ON-SHIFT BANNER */}
      <div
        style={{
          background: '#FAF8F4',
          border: '1.5px solid #22252A',
          padding: '12px 16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontFamily: 'var(--font-mono)',
        }}
      >
        <div>
          <strong style={{ fontSize: 13, color: '#181A1C' }}>Field Technician · Ramesh</strong>
          <div style={{ fontSize: 11, color: '#5F666D' }}>Water Treatment Room · West Maintenance Aisle</div>
        </div>
        <span className="chip good">ON SHIFT · DISPATCH READY</span>
      </div>

      {/* ACTIVE JOB CARD */}
      <section className="section-card">
        <div className="card-header">
          <h2 className="card-title">CURRENT JOB</h2>
          <span className="card-badge">
            {pendingTask ? 'ACTION REQUIRED' : 'STANDBY'}
          </span>
        </div>

        <div className="card-body">
          {!pendingTask ? (
            <div style={{ textAlign: 'center', padding: '24px 12px' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
              <h3 style={{ margin: '0 0 6px', fontSize: 16, fontFamily: 'var(--font-mono)' }}>
                No Active Field Tasks
              </h3>
              <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
                Central telemetry is nominal. When Muse Wonder needs physical eyes on an unmetered gauge or valve, your task will dispatch here.
              </p>
            </div>
          ) : pendingTask.kind === 'gauge_photo' ? (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span className="chip critical">ANALOGUE GAUGE INSPECTION</span>
                <span className="chip">SOP-07 LIMIT CHECK</span>
              </div>

              <h3 style={{ margin: '0 0 8px', fontSize: 16, fontFamily: 'var(--font-mono)' }}>
                {pendingTask.instruction}
              </h3>

              <div className="asset-tags">
                {(pendingTask.asset_ids || []).concat(pendingTask.tags || []).map((code) => (
                  <span key={code} className="asset-tag">
                    {code}
                  </span>
                ))}
              </div>

              {/* DIAL GAUGES VISUALIZER (WHEN EVIDENCE IS SUBMITTED OR SIMULATED) */}
              <div
                style={{
                  background: '#F4F0E8',
                  border: '1.5px solid #22252A',
                  padding: 12,
                  margin: '12px 0',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 800, color: '#5F666D', marginBottom: 6 }}>
                  OPTICAL SENSOR ACQUISITION · SAM 3.1 &amp; WONDER DIAL VISION
                </div>
                {activeScenario?.gauges.map((g) => (
                  <GaugeDialSvg
                    key={g.label}
                    value={g.val}
                    max={g.max}
                    unit={g.unit}
                    label={g.label}
                    showSamOverlay={stepIndex >= 3}
                  />
                ))}
                {stepIndex >= 3 && (
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      fontWeight: 700,
                      color: '#15803D',
                      marginTop: 6,
                    }}
                  >
                    ✓ SAM 3.1 segmented dials · Spark read {activeScenario?.readingSummary}
                  </div>
                )}
              </div>

              {/* INPUT CONTROLS */}
              <div style={{ display: 'grid', gap: 8, margin: '12px 0' }}>
                <label>
                  Operator Observation Note
                  <textarea
                    placeholder="Enter visual observation (e.g. gauge needle flutter, signs of leakage)"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </label>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="secondary"
                    onClick={handleVoiceToggle}
                    disabled={isRecording}
                  >
                    {isRecording ? '🎙️ RECORDING VOICE...' : hasVoiceNote ? '✓ VOICE NOTE ATTACHED' : '🎙️ RECORD VOICE NOTE'}
                  </button>

                  <button
                    type="button"
                    className="primary"
                    style={{ flex: 1, minHeight: 46 }}
                    onClick={submitFieldEvidence}
                  >
                    📸 TRANSMIT GAUGE EVIDENCE TO COMMANDER
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span className="chip warning">SAFETY INTERLOCK ACTION</span>
                <span className="chip good">COMMANDER APPROVED</span>
              </div>

              <h3 style={{ margin: '0 0 8px', fontSize: 16, fontFamily: 'var(--font-mono)' }}>
                {pendingTask.instruction}
              </h3>

              {/* VALVE 3-STAGE GUIDE */}
              <div className="stage-guide">
                <div className="stage-step">
                  <strong>0°</strong>
                  <span>OPEN · pipe-parallel</span>
                </div>
                <div className="stage-step" style={{ borderColor: '#E05326', background: '#FEF3C7' }}>
                  <strong style={{ color: '#E05326' }}>45°</strong>
                  <span>HOLD · min 2 sec</span>
                </div>
                <div className="stage-step">
                  <strong>90°</strong>
                  <span>CLOSED · perpendicular</span>
                </div>
              </div>

              {/* VALVE HANDLE VISUALIZER */}
              <div
                style={{
                  background: '#F4F0E8',
                  border: '1.5px solid #22252A',
                  padding: 12,
                  margin: '12px 0',
                  textAlign: 'center',
                }}
              >
                <ValveHandleSvg percentOpen={50} />
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    fontWeight: 700,
                    color: '#15803D',
                    marginTop: 6,
                  }}
                >
                  SAM 3.1 verified staged motion: 45° held for 2.4s. No water hammer surge.
                </div>
              </div>

              <button
                type="button"
                className="primary"
                style={{ width: '100%', minHeight: 48, marginTop: 8 }}
                onClick={completeValveAction}
              >
                🔧 TRANSMIT VERIFIED VALVE ACTION TO CONTROLLER
              </button>
            </div>
          )}
        </div>
      </section>

      {/* COMPLETED EVIDENCE LEDGER */}
      <section className="section-card">
        <div className="card-header">
          <h2 className="card-title">COMPLETED AUDIT EVIDENCE</h2>
          <span className="card-badge">{completedTasks.length} VERIFIED</span>
        </div>

        <div className="card-body">
          {completedTasks.length === 0 ? (
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>
              No completed field evidence in this shift session yet.
            </p>
          ) : (
            completedTasks.map((t) => (
              <div key={t.id} className="completed-item">
                <div className="completed-head">
                  <span>{t.instruction}</span>
                  <span className="chip good">VERIFIED</span>
                </div>
                <div className="completed-meta">
                  {t.result?.voice?.transcript && (
                    <div>Voice transcript: &ldquo;{t.result.voice.transcript}&rdquo; (Checked: {t.result.voice.comparison?.status})</div>
                  )}
                  {t.result?.policy?.status && (
                    <div>Valve Safety Policy: {t.result.policy.status} ({t.result.policy.stages_seen.join(' → ')})</div>
                  )}
                  Stored in encrypted incident audit trail and verified by SAM 3.1 &amp; Wonder.
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
};
