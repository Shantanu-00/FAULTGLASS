import React from 'react';
import { usePlant } from './context/PlantContext';
import { Header } from './components/common/Header';
import { TargetBar } from './components/common/TargetBar';
import { NowBanner } from './components/common/NowBanner';
import { WorkflowRibbon } from './components/common/WorkflowRibbon';
import { CommanderConsole } from './components/console/CommanderConsole';
import { FieldCompanion } from './components/field/FieldCompanion';
import { RecordingStudio } from './components/demo/RecordingStudio';
import { PlantTwinView } from './components/twin/PlantTwinView';

export const App: React.FC = () => {
  const { activeTab, toastMessage } = usePlant();

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Header />
      <TargetBar />
      <NowBanner />
      <WorkflowRibbon />

      <div style={{ flex: 1, marginTop: 14 }}>
        {activeTab === 'studio' && <RecordingStudio />}
        {activeTab === 'console' && <CommanderConsole />}
        {activeTab === 'field' && (
          <div style={{ padding: '0 18px 24px' }}>
            <FieldCompanion />
          </div>
        )}
        {activeTab === 'twin' && <PlantTwinView />}
      </div>

      <footer className="bottom-footer">
        <div>FAULTGLASS / FIELD OPERATIONS / COMMANDER HMI</div>
        <div>telemetry · field task · evidence · verification</div>
      </footer>

      {/* FLOATING TOAST NOTIFICATION */}
      <div className={`toast ${toastMessage ? 'on' : ''}`} role="status">
        {toastMessage}
      </div>
    </div>
  );
};
