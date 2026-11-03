import React from 'react';
import { usePlant } from '../../state/PlantContext';

export const ToastHost: React.FC = () => {
  const { toast } = usePlant();
  return (
    <div className="toast-host" role="status" aria-live="polite">
      {toast && (
        <div key={toast.id} className={`toast toast-${toast.tone}`}>
          {toast.message}
        </div>
      )}
    </div>
  );
};
