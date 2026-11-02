import React from 'react';
import { usePlant } from '../../context/PlantContext';

export const TargetBar: React.FC = () => {
  const {
    activeIncident,
    activeScenario,
    triggerScenario,
    resetPlant,
    isBackendConnected,
    isRunningDemo,
    stepIndex,
  } = usePlant();

  const getStatusChip = () => {
    if (!activeIncident) {
      return <span className="chip good">● NOMINAL · BASELINE LEARNED</span>;
    }
    const status = activeIncident.investigation.status;
    if (status === 'resolved') {
      return <span className="chip good">✓ RESOLVED · SUSTAINED RECOVERY</span>;
    }
    if (status === 'waiting_field') {
      return <span className="chip critical">▲ FIELD ACTION DISPATCHED</span>;
    }
    if (status === 'verifying') {
      return <span className="chip busy">◎ VERIFIER WATCHING TELEMETRY</span>;
    }
    return <span className="chip critical">▲ ANOMALY · INVESTIGATING</span>;
  };

  return (
    <div className="target-bar">
      <div className="target-info">
        <span className="target-label">TARGET SYSTEM:</span>
        <span className="target-name">WATER TREATMENT PLANT / COOLING &amp; RO LOOP</span>
        <span className="chip sim">
          {isBackendConnected ? 'LIVE FEED (API)' : 'HMI DEMO ENGINE'}
        </span>
      </div>

      <div className="chips">
        {getStatusChip()}
        {activeScenario && (
          <span className="chip warning">
            SCENARIO: {activeScenario.id.toUpperCase()} (STEP {Math.max(1, stepIndex + 1)}/8)
          </span>
        )}
      </div>

      <div className="target-controls">
        <button
          type="button"
          className="primary"
          disabled={isRunningDemo && stepIndex < 7}
          onClick={() => triggerScenario('filter')}
          title="Inject filter clog scenario (SOP-07 ΔP trigger)"
        >
          ▶ INJECT FILTER CLOG
        </button>
        <button
          type="button"
          disabled={isRunningDemo && stepIndex < 7}
          onClick={() => triggerScenario('scaling')}
        >
          SCENARIO 2 · RO SCALING
        </button>
        <button
          type="button"
          disabled={isRunningDemo && stepIndex < 7}
          onClick={() => triggerScenario('feed')}
        >
          SCENARIO 3 · LOW FEED
        </button>
        <button type="button" onClick={resetPlant}>
          ↺ RESET PLANT
        </button>
      </div>
    </div>
  );
};
