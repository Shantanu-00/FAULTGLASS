import React from 'react';
import { API_BASE } from '../../api/client';
import { usePlant } from '../../state/PlantContext';
import { Icon } from './Icon';

export const ApiUnreachable: React.FC = () => {
  const { connection, connectionError, retry } = usePlant();
  const connecting = connection === 'connecting';

  return (
    <section className="panel empty-state" role="alert">
      <div className="empty-icon">
        <Icon name="alert" size={28} />
      </div>
      <h1>{connecting ? 'Connecting to the FAULTGLASS API' : 'Cannot reach the FAULTGLASS API'}</h1>
      <p>
        {connecting ? 'Waiting for ' : 'No response from '}
        <code>{API_BASE}</code>
        {connectionError && !connecting ? ` (${connectionError})` : ''}.
      </p>
      {!connecting && <p className="muted">No readings are shown until the API answers. Retrying every 5 seconds.</p>}
      <button type="button" className="btn btn-primary" onClick={retry} disabled={connecting}>
        <Icon name="refresh" size={16} />
        Retry now
      </button>
    </section>
  );
};
