import React from 'react';

interface SparklineSvgProps {
  data: number[];
  nominal?: number;
  width?: number;
  height?: number;
  color?: string;
}

export const SparklineSvg: React.FC<SparklineSvgProps> = ({
  data,
  nominal,
  width = 132,
  height = 30,
  color = '#181A1C',
}) => {
  if (!data || data.length < 2) {
    return <svg width={width} height={height} className="spark" />;
  }

  const min = Math.min(...data, nominal !== undefined ? nominal * 0.8 : 0);
  const max = Math.max(...data, nominal !== undefined ? nominal * 1.2 : 10);
  const range = max - min || 1;

  const points = data
    .map((val, idx) => {
      const x = (idx / (data.length - 1)) * (width - 4) + 2;
      const y = height - ((val - min) / range) * (height - 8) - 4;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const nominalY = nominal !== undefined ? height - ((nominal - min) / range) * (height - 8) - 4 : null;

  return (
    <svg width={width} height={height} className="spark" viewBox={`0 0 ${width} ${height}`}>
      {nominalY !== null && (
        <line
          x1={2}
          y1={nominalY}
          x2={width - 2}
          y2={nominalY}
          className="nominal"
        />
      )}
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
};
