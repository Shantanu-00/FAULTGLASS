import React from 'react';
import { usePlant } from '../../context/PlantContext';
import { SignalsGrid } from './SignalsGrid';
import { FocusLedger } from './FocusLedger';
import { HypothesisTree } from './HypothesisTree';
import { ActionProposalsCard } from './ActionProposalsCard';
import { CollaborativeMemory } from './CollaborativeMemory';
import { AuditTrail } from './AuditTrail';

export const CommanderConsole: React.FC = () => {
  const { activeIncident, flags, readings } = usePlant();

  const curFlow = readings['FIT-301']?.value ?? 8.4;
  const isAbnormal = curFlow < 5;

  return (
    <div>
      {/* SECTION BAR */}
      <div className="section-bar">
        <span className="section-bar-title">SIMULATED PROCESS / LIVE TELEMETRY</span>
        <div className="section-bar-badges">
          <span className={`chip ${isAbnormal ? 'bad' : 'good'}`}>
            HEALTH: {isAbnormal ? '22 (ANOMALY)' : '100'}
          </span>
          <span className={`chip ${isAbnormal ? 'critical' : 'sim'}`}>
            LINE FAULT: {isAbnormal ? 'CF-201 CHOKE' : 'NOMINAL'}
          </span>
        </div>
      </div>

      <main className="layout">
        {/* SIGNALS GRID */}
        <SignalsGrid />

        {/* SIDEBAR: FLAGS & RUN */}
        <aside className="side">
          <section>
            <h2>SIGNAL FLAGS ({flags.length})</h2>
            <ul className="flags">
              {flags.length === 0 ? (
                <li className="muted">No signal flags raised. Spark watcher is monitoring.</li>
              ) : (
                flags.map((f) => (
                  <li key={f.id} className={`flag ${f.severity}`}>
                    <div className="flag-head">
                      <span className={`chip ${f.severity}`}>{f.severity}</span>
                      <span>{f.status.toUpperCase()}</span>
                    </div>
                    <p>{f.summary}</p>
                    <div className="tags">
                      {f.tags.map((t) => (
                        <code key={t}>{t}</code>
                      ))}
                    </div>
                    {f.model && <div className="flag-meta">via {f.model}</div>}
                  </li>
                ))
              )}
            </ul>
          </section>

          <section>
            <h2>RUN DIAGNOSTICS</h2>
            <dl className="run">
              <dt>Status</dt>
              <dd>{activeIncident ? 'INCIDENT_ACTIVE' : 'RUNNING_NOMINAL'}</dd>

              <dt>Telemetry Ingest</dt>
              <dd>STREAMING (10s EPOCH)</dd>

              <dt>Lead Agent</dt>
              <dd>MUSE WONDER 1.0</dd>

              <dt>Physical API</dt>
              <dd>FIELD COMPANION HUD</dd>
            </dl>
          </section>
        </aside>
      </main>

      {/* THREE-COLUMN REASONING WORKBENCH */}
      <section className="reasoning">
        <div className="reasoning-head">
          <h2>INVESTIGATION WORKBENCH — MUSE WONDER</h2>
          <span className="chip">
            {activeIncident ? activeIncident.incident.incident_id : 'STANDBY'}
          </span>
        </div>

        <div className="reasoning-grid">
          {/* COLUMN 1 */}
          <div className="reasoning-col">
            <FocusLedger />
            <HypothesisTree />
          </div>

          {/* COLUMN 2 */}
          <div className="reasoning-col">
            <ActionProposalsCard />
          </div>

          {/* COLUMN 3 */}
          <div className="reasoning-col">
            <CollaborativeMemory />
            <AuditTrail />
          </div>
        </div>
      </section>
    </div>
  );
};
