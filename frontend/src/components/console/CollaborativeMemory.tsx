import React from 'react';
import { usePlant } from '../../context/PlantContext';

export const CollaborativeMemory: React.FC = () => {
  const { activeScenario } = usePlant();

  return (
    <div className="reasoning-card collab">
      <div className="reasoning-card-header">
        <span>WHAT THIS PLANT HAS TAUGHT THE AGENT</span>
        <span className="chip good">1 FACT APPLIED</span>
      </div>

      <div style={{ fontSize: 12, lineHeight: 1.5, color: '#2D3748', marginBottom: 12 }}>
        <p style={{ margin: '0 0 6px' }}>
          <strong>P-17 / CF-201 Rule:</strong> F-17 cartridge filter bank is accessed from the west aisle. Analogue gauge reading must be photographed straight-on before initiating chemical flush.
        </p>
        <p style={{ margin: 0 }}>
          <strong>V-113 Safety Assertion:</strong> Opening handwheel bypass suddenly past 50% causes severe water hammer across fragile polyamide thin-film RO elements. Always stage at 45° with 2s dwell.
        </p>
      </div>

      <h2 style={{ fontSize: 10, margin: '12px 0 6px' }}>ACTIVE MEMORY RECALLED (POSTGRES + SOP)</h2>
      <ul className="recalls">
        {activeScenario?.memories?.length ? (
          activeScenario.memories.map((m, idx) => (
            <li key={idx}>
              <code>RECALL_{idx + 1}</code> — {m}
            </li>
          ))
        ) : (
          <li className="muted">No incident active. Plant SOPs and prior records stand ready.</li>
        )}
      </ul>
    </div>
  );
};
