import React from 'react';

interface Props {
  en: React.ReactNode;
  mr?: string;
  stack?: boolean;
}

export const Bi: React.FC<Props> = ({ en, mr, stack }) => (
  <span className={`bi${stack ? ' bi-stack' : ''}`}>
    <span className="bi-en">{en}</span>
    {mr && (
      <span className="bi-mr" lang="mr">
        {mr}
      </span>
    )}
  </span>
);
