import React from 'react';
import { usePlant } from '../../context/PlantContext';

export const ActionProposalsCard: React.FC = () => {
  const { activeIncident, approveActionProposal } = usePlant();
  const proposals = activeIncident?.action_proposals || [];
  const fieldTasks = activeIncident?.field_tasks || [];

  return (
    <>
      <div className="reasoning-card">
        <div className="reasoning-card-header">
          <span>CURRENT FIELD TASK</span>
          <span className="chip busy">OPERATOR DISPATCH</span>
        </div>

        {fieldTasks.length === 0 ? (
          <p className="muted" style={{ fontSize: 12, margin: '6px 0' }}>
            No physical task dispatched. Wonder requests field eyes only when digital channels run out of answers.
          </p>
        ) : (
          fieldTasks.map((t) => (
            <div key={t.id} className="task" style={{ borderLeft: '4px solid #2563EB' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <strong style={{ fontSize: 13 }}>{t.instruction}</strong>
                <span className={`chip ${t.status === 'completed' ? 'good' : 'warning'}`}>
                  {t.status.toUpperCase()}
                </span>
              </div>
              <div className="tags">
                {(t.asset_ids || []).map((code) => (
                  <code key={code}>{code}</code>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="reasoning-card">
        <div className="reasoning-card-header">
          <span>ACTION PROPOSALS · SAFETY INTERLOCK</span>
          <span className="chip warning">POLICY CHECK</span>
        </div>

        {proposals.length === 0 ? (
          <p className="muted" style={{ fontSize: 12, margin: '6px 0' }}>
            No pending action proposals. Model cannot actuate equipment directly; commander approval required.
          </p>
        ) : (
          proposals.map((p) => (
            <div key={p.id} className="task" style={{ borderLeft: '4px solid #E05326' }}>
              <p style={{ margin: '4px 0 6px', fontWeight: 600 }}>
                {p.action} on <code>{p.asset_id}</code>
              </p>
              <p className="muted" style={{ fontSize: 12, margin: '0 0 10px' }}>
                Rationale: {p.rationale}
              </p>

              {p.status === 'pending' && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="primary" onClick={approveActionProposal}>
                    ✓ APPROVE VALVE TASK
                  </button>
                  <button type="button">REJECT</button>
                </div>
              )}
              {p.status === 'approved' && (
                <span className="chip good">✓ APPROVED BY COMMANDER</span>
              )}
            </div>
          ))
        )}
      </div>
    </>
  );
};
