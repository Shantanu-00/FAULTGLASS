import React from 'react';
import { AppHeader } from './components/common/AppHeader';
import { MobileTabs } from './components/common/MobileTabs';
import { ToastHost } from './components/common/Toast';
import { PlantProvider } from './state/PlantContext';
import { useView } from './state/route';
import { FieldView } from './views/FieldView';
import { OperatorView } from './views/OperatorView';
import { TwinView } from './views/TwinView';

export const App: React.FC = () => {
  const [view, setView] = useView();

  return (
    <PlantProvider wantTelemetry={view !== 'field'} autoStartRun={view !== 'field'}>
      <AppHeader view={view} onNavigate={setView} />
      <main className={`app-main app-main-${view}`}>
        {view === 'operator' && <OperatorView onNavigate={setView} />}
        {view === 'field' && <FieldView />}
        {view === 'twin' && <TwinView />}
      </main>
      <MobileTabs view={view} onNavigate={setView} />
      <ToastHost />
    </PlantProvider>
  );
};
