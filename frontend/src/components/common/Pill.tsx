import React from 'react';

export type Tone = 'neutral' | 'ok' | 'warning' | 'alarm' | 'accent';

export const Pill: React.FC<{ tone?: Tone; children: React.ReactNode; title?: string }> = ({ tone = 'neutral', children, title }) => (
  <span className={`pill pill-${tone}`} title={title}>
    {children}
  </span>
);
