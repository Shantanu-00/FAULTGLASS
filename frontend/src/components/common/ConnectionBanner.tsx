import React from 'react';
import { formatTime } from '../../lib/format';
import { usePlant } from '../../state/PlantContext';
import { Icon } from './Icon';

export const ConnectionBanner: React.FC = () => {
  const { connection, lastUpdate, retry } = usePlant();
  if (connection !== 'offline') return null;
  return (
    <div className="banner banner-alarm" role="alert">
      <Icon name="alert" size={18} />
      <span>
        Connection to the FAULTGLASS API lost.
        {lastUpdate ? ` Values below are from ${formatTime(new Date(lastUpdate).toISOString())} and are not current.` : ''}
      </span>
      <button type="button" className="btn btn-small" onClick={retry}>
        Retry
      </button>
    </div>
  );
};
