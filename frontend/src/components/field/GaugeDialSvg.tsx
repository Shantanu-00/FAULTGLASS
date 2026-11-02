import React from 'react';

interface GaugeDialSvgProps {
  value: number;
  max: number;
  unit: string;
  label: string;
  showSamOverlay?: boolean;
}

export const GaugeDialSvg: React.FC<GaugeDialSvgProps> = ({
  value,
  max,
  unit,
  label,
  showSamOverlay = true,
}) => {
  const angle = -120 + (Math.min(value, max) / max) * 240;
  const rad = (angle * Math.PI) / 180;
  const needleX = 100 + 44 * Math.sin(rad);
  const needleY = 82 - 44 * Math.cos(rad);

  const ticks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div style={{ position: 'relative', display: 'inline-block', margin: '6px' }}>
      {showSamOverlay && (
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
          SAM 3.1 · 98%
        </span>
      )}

      <svg viewBox="0 0 200 150" width={175} height={135} style={{ background: '#FAF8F4', border: '1.5px solid #22252A' }}>
        {/* Outer Dial Rim */}
        <circle cx="100" cy="80" r="56" fill="#FFFFFF" stroke="#22252A" strokeWidth="2.5" />
        <circle cx="100" cy="80" r="46" fill="none" stroke="#D8D4CA" strokeWidth="1" />

        {/* Ticks and scale */}
        {ticks.map((f) => {
          const t = (-120 + f * 240) * (Math.PI / 180);
          const x1 = 100 + 38 * Math.sin(t);
          const y1 = 80 - 38 * Math.cos(t);
          const x2 = 100 + 46 * Math.sin(t);
          const y2 = 80 - 46 * Math.cos(t);
          const tx = 100 + 29 * Math.sin(t);
          const ty = 84 - 29 * Math.cos(t);

          return (
            <g key={f}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#22252A" strokeWidth="1.8" />
              <text x={tx} y={ty} textAnchor="middle" fontSize="8.5" fontFamily="var(--font-mono)" fill="#4B5563">
                {(max * f).toFixed(1)}
              </text>
            </g>
          );
        })}

        {/* Needle */}
        <line x1="100" y1="80" x2={needleX} y2={needleY} stroke="#DC2626" strokeWidth="2.8" strokeLinecap="round" />
        <circle cx="100" cy="80" r="5.5" fill="#181A1C" />

        {/* Caption */}
        <text
          x="100"
          y="130"
          textAnchor="middle"
          fontSize="10"
          fontFamily="var(--font-mono)"
          fontWeight="800"
          fill="#181A1C"
        >
          {label} · {value.toFixed(1)} {unit}
        </text>
      </svg>
    </div>
  );
};
