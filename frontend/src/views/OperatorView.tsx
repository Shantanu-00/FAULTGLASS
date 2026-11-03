import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ApiUnreachable } from '../components/common/ApiUnreachable';
import { ConnectionBanner } from '../components/common/ConnectionBanner';
import { CurrentEvent } from '../components/operator/CurrentEvent';
import { InvestigationStack } from '../components/operator/InvestigationStack';
import { ProductionTrend } from '../components/operator/ProductionTrend';
import { TelemetryPanel } from '../components/operator/TelemetryPanel';
import { TwinPane } from '../components/twin/TwinPane';
import { usePlant } from '../state/PlantContext';
import '../styles/operator.css';
import '../styles/commander.css';

export const OperatorView: React.FC = () => {
  const { plant } = usePlant();
  const [measurementsOpen, setMeasurementsOpen] = useState(false);
  const [investigationFocus, setInvestigationFocus] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  const openMeasurements = useCallback(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setMeasurementsOpen(true);
  }, []);
  const closeMeasurements = useCallback(() => {
    setMeasurementsOpen(false);
    requestAnimationFrame(() => opener.current?.focus());
  }, []);

  useEffect(() => {
    if (!measurementsOpen) return;
    closeButton.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMeasurements();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [measurementsOpen, closeMeasurements]);

  if (!plant) return <ApiUnreachable />;

  return (
    <div className={'commander' + (investigationFocus ? ' has-investigation-focus' : '')}>
      <ConnectionBanner />
      <CurrentEvent />
      <div className="command-workspace">
        <div className="command-plant-column">
          <div className="command-plant-content" inert={measurementsOpen}>
            <TwinPane />
            <ProductionTrend onOpenMeasurements={openMeasurements} />
          </div>
          {measurementsOpen && (
            <section className="command-measurements" id="plant-measurements" role="dialog" aria-modal="false" aria-labelledby="plant-measurements-title">
              <div className="command-measurements-header">
                <div><span className="command-eyebrow">Live signals</span><h2 id="plant-measurements-title">Plant measurements</h2></div>
                <button className="command-close" type="button" ref={closeButton} onClick={closeMeasurements} aria-label="Close plant measurements">Close <span aria-hidden="true">×</span></button>
              </div>
              <div className="command-measurements-scroll"><TelemetryPanel /></div>
            </section>
          )}
        </div>
        <section className="command-investigation" aria-labelledby="command-investigation-title">
          <div className="command-column-header">
            <div><span className="command-eyebrow">Evidence & decisions</span><h2 id="command-investigation-title">Investigation</h2></div>
            <button className={'command-tool command-focus-toggle' + (investigationFocus ? ' is-active' : '')} type="button" aria-pressed={investigationFocus} onClick={() => setInvestigationFocus((current) => !current)}>{investigationFocus ? 'Restore layout' : 'Expand'}</button>
          </div>
          <div className="command-investigation-scroll"><InvestigationStack /></div>
        </section>
      </div>
    </div>
  );
};
