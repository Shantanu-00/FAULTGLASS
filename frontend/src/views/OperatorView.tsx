import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ApiUnreachable } from '../components/common/ApiUnreachable';
import { ConnectionBanner } from '../components/common/ConnectionBanner';
import { CurrentEvent } from '../components/operator/CurrentEvent';
import { InvestigationStack } from '../components/operator/InvestigationStack';
import { InvestigationJourney } from '../components/operator/InvestigationJourney';
import { PlantReadings } from '../components/operator/PlantReadings';
import { ProductionTrend } from '../components/operator/ProductionTrend';
import { TelemetryPanel } from '../components/operator/TelemetryPanel';
import { TwinPane } from '../components/twin/TwinPane';
import { usePlant } from '../state/PlantContext';
import '../styles/operator.css';
import '../styles/commander.css';

export const OperatorView: React.FC = () => {
  const { plant, incident, selectedIncidentId } = usePlant();
  const [measurementsOpen, setMeasurementsOpen] = useState(false);
  const [plantExpanded, setPlantExpanded] = useState(false);
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
    <div className={'commander' + (plantExpanded ? ' is-plant-expanded' : '')}>
      <ConnectionBanner />
      <CurrentEvent />
      <nav className="command-section-nav" aria-label="Commander sections">
        <span>Operations workspace</span>
        <a href="#plant-overview">Plant overview</a>
        <a href={incident && incident.incident.incident_id === selectedIncidentId ? '#hypothesis-board' : '#command-investigation-title'}>Hypotheses</a>
        {incident && incident.incident.incident_id === selectedIncidentId && <a href="#investigation-thread">Investigation thread <span aria-hidden="true">↗</span></a>}
      </nav>
      <div className="command-workspace">
        <div className="command-plant-column">
          <div className="command-plant-content" inert={measurementsOpen}>
            <div className="command-process-module" id="plant-overview">
              <TwinPane expanded={plantExpanded} onToggleExpanded={() => setPlantExpanded((current) => !current)} />
              <PlantReadings onOpenMeasurements={openMeasurements} />
            </div>
            <ProductionTrend onOpenMeasurements={openMeasurements} />
            {incident && incident.incident.incident_id === selectedIncidentId && <div id="investigation-thread"><InvestigationJourney detail={incident} /></div>}
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
            <div><span className="command-eyebrow">Muse Wonder</span><h2 id="command-investigation-title">Diagnosis & decisions</h2></div>
            <span className="command-record-label">Evidence-led</span>
          </div>
          <div className="command-investigation-scroll"><InvestigationStack /></div>
        </section>
      </div>
    </div>
  );
};
