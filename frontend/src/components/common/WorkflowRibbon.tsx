import React from 'react';
import { usePlant } from '../../context/PlantContext';

export const WorkflowRibbon: React.FC = () => {
  const { activeIncident, stepIndex } = usePlant();

  // Determine stage status
  const getStepClass = (stepNum: number) => {
    if (!activeIncident) {
      return stepNum === 1 ? 'flow-step active' : 'flow-step';
    }
    const inv = activeIncident.investigation;
    if (inv.status === 'resolved') {
      return 'flow-step done';
    }
    if (stepIndex === 0 && stepNum === 1) return 'flow-step active';
    if (stepIndex === 1 && stepNum === 2) return 'flow-step active';
    if ((stepIndex === 2 || inv.status === 'waiting_field') && stepNum === 3) return 'flow-step active';
    if ((stepIndex === 3 || stepIndex === 4 || stepIndex === 5 || stepIndex === 6 || inv.status === 'verifying') && stepNum === 4) return 'flow-step active';
    if (stepIndex >= 7 && stepNum === 5) return 'flow-step active';

    // Prior steps marked as done
    if (stepNum < 3 && (stepIndex >= 2 || inv.status === 'waiting_field')) return 'flow-step done';
    if (stepNum < 4 && (stepIndex >= 3)) return 'flow-step done';
    if (stepNum < 5 && (stepIndex >= 7)) return 'flow-step done';

    return 'flow-step';
  };

  const getFlowTag = () => {
    if (!activeIncident) return 'NOMINAL_MONITORING';
    const status = activeIncident.investigation.status;
    if (status === 'resolved') return 'RESOLVED_VERIFIED';
    if (status === 'waiting_field') return 'ACTION_DISPATCHED';
    if (status === 'verifying') return 'VERIFY_EVALUATE';
    return 'REASONING_ACTIVE';
  };

  return (
    <div className="flow-ribbon">
      <span className="flow-title">ADK FIELD LOOP — NODES MAY REPEAT OR BE SKIPPED</span>
      <div className="flow-steps">
        <span className={getStepClass(1)}>01 OBSERVE</span>
        <span className="flow-arrow">→</span>
        <span className={getStepClass(2)}>02 SELECT NODE</span>
        <span className="flow-arrow">→</span>
        <span className={getStepClass(3)}>03 FIELD TASK</span>
        <span className="flow-arrow">→</span>
        <span className={getStepClass(4)}>04 EVALUATE / VERIFY</span>
        <span className="flow-arrow">→</span>
        <span className={getStepClass(5)}>05 CLOSE / ESCALATE</span>
      </div>
      <span className="flow-status-tag">{getFlowTag()}</span>
    </div>
  );
};
