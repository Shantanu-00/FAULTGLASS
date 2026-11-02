import React from 'react';

interface ValveHandleSvgProps {
  percentOpen: number; // 0 to 100
}

export const ValveHandleSvg: React.FC<ValveHandleSvgProps> = ({ percentOpen }) => {
  const rotAngle = (percentOpen / 100) * 90;

  return (
    <div style={{ position: 'relative', display: 'inline-block', margin: '6px' }}>
      <span
        style={{
          position: 'absolute',
          top: 6,
          left: 6,
          fontFamily: 'var(--font-mono)',
          fontSize: 9,
          fontWeight: 800,
          background: '#DC2626',
          color: '#fff',
          padding: '2px 5px',
          borderRadius: 2,
          zIndex: 2,
        }}
      >
        SAM 3.1 · LEVER · 97%
      </span>
      <span
        style={{
          position: 'absolute',
          top: 26,
          left: 6,
          fontFamily: 'var(--font-mono)',
          fontSize: 9,
          fontWeight: 800,
          background: '#059669',
          color: '#fff',
          padding: '2px 5px',
          borderRadius: 2,
          zIndex: 2,
        }}
      >
        ANGLE ≈ {percentOpen}% ✓ PERPENDICULAR ✓
      </span>

      <svg viewBox="0 0 200 150" width={180} height={135} style={{ background: '#FAF8F4', border: '1.5px solid #22252A' }}>
        {/* Pipe background */}
        <rect x="20" y="65" width="160" height="20" rx="3" fill="#D8D4CA" stroke="#22252A" strokeWidth="1.5" />

        {/* Valve Body */}
        <circle cx="100" cy="75" r="38" fill="#FFFFFF" stroke="#E05326" strokeWidth="2.5" />

        {/* Rotated Handle */}
        <g transform={`rotate(${rotAngle} 100 75)`}>
          <rect x="94" y="24" width="12" height="65" rx="4" fill="#F59E0B" stroke="#22252A" strokeWidth="1.2" />
          <circle cx="100" cy="28" r="8" fill="#DC2626" />
        </g>

        {/* Center Nut */}
        <circle cx="100" cy="75" r="9" fill="#181A1C" />

        <text
          x="100"
          y="130"
          textAnchor="middle"
          fontSize="10"
          fontFamily="var(--font-mono)"
          fontWeight="800"
          fill="#181A1C"
        >
          VALVE V-113 · {percentOpen}% POSITION
        </text>
      </svg>
    </div>
  );
};
