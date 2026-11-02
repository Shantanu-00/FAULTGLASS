import React from 'react';
import { usePlant } from '../../context/PlantContext';

export const AuditTrail: React.FC = () => {
  const { activeIncident } = usePlant();
  const trace = activeIncident?.trace || [];

  const getActorBadge = (actor: string) => {
    switch (actor) {
      case 'PLANT':
        return <span className="chip sim">PLANT</span>;
      case 'WONDER':
        return <span className="chip busy">WONDER</span>;
      case 'OPERATOR':
        return <span className="chip warning">OPERATOR</span>;
      case 'ADK':
      case 'VERIFIER':
        return <span className="chip good">{actor}</span>;
      default:
        return <span className="chip">{actor}</span>;
    }
  };

  return (
    <div className="reasoning-card">
      <div className="reasoning-card-header">
        <span>AUDIT TRAIL · ADK ↔ OPERATOR ↔ PLANT</span>
        <span className="chip">{trace.length} EVENTS</span>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        <span className="chip good">CURRENT RUN · LIVE</span>
        <span className="chip">
          {activeIncident ? `${activeIncident.investigation.steps_used} AGENT STEPS` : '0 STEPS'}
        </span>
        <span className="chip">
          {activeIncident?.field_tasks?.length || 0} FIELD EXECUTIONS
        </span>
      </div>

      <ol className="trace" style={{ maxHeight: 260, overflowY: 'auto' }}>
        {trace.length === 0 ? (
          <li className="muted">Plant is nominal. Events will stream here upon investigation start.</li>
        ) : (
          trace.map((item) => (
            <li
              key={item.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '70px 80px 1fr',
                gap: 8,
                alignItems: 'baseline',
                padding: '4px 0',
                borderBottom: '1px solid #EFE9DD',
              }}
            >
              <code style={{ fontSize: 10 }}>{item.time}</code>
              <span>{getActorBadge(item.actor)}</span>
              <span style={{ fontSize: 12, lineHeight: 1.4 }}>{item.content}</span>
            </li>
          ))
        )}
      </ol>
    </div>
  );
};
