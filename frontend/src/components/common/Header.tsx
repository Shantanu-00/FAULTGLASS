import React from 'react';
import { usePlant } from '../../context/PlantContext';

export const Header: React.FC = () => {
  const { activeTab, setActiveTab, isBackendConnected } = usePlant();

  return (
    <header className="top-header">
      <div className="brand-group">
        <div className="brand-badge">FG</div>
        <div className="brand-titles">
          <div className="brand-title">FAULTGLASS</div>
          <div className="brand-sub">FIELD OPERATIONS / COMMANDER HMI</div>
        </div>
      </div>

      <div className="breadcrumbs">
        <span className="crumb active">LIVE OPERATOR VIEW</span>
        <span className="slash">/</span>
        <span className="crumb">SPARK TELEMETRY</span>
        <span className="slash">/</span>
        <span className="crumb">MUSE WONDER</span>
        <span className="slash">/</span>
        <span className="crumb">DYNAMIC WORKFLOW</span>
        <span className="slash">/</span>
        <span className="crumb active">
          {isBackendConnected ? 'BACKEND LINKED' : 'HMI DEMO ENGINE'}
        </span>
      </div>

      <nav className="nav-links">
        <button
          type="button"
          className={`nav-btn ${activeTab === 'studio' ? 'active' : ''}`}
          onClick={() => setActiveTab('studio')}
          title="Split-Screen View for YouTube Demo Recording"
        >
          🎬 RECORDING STUDIO
        </button>
        <button
          type="button"
          className={`nav-btn ${activeTab === 'console' ? 'active' : ''}`}
          onClick={() => setActiveTab('console')}
        >
          COMMANDER HMI
        </button>
        <button
          type="button"
          className={`nav-btn ${activeTab === 'field' ? 'active' : ''}`}
          onClick={() => setActiveTab('field')}
        >
          FIELD COMPANION
        </button>
        <button
          type="button"
          className={`nav-btn ${activeTab === 'twin' ? 'active' : ''}`}
          onClick={() => setActiveTab('twin')}
        >
          PLANT TWIN
        </button>
      </nav>
    </header>
  );
};
