import React from 'react';
import { deriveCommanderEvent } from '../../lib/commander';
import { usePlant } from '../../state/PlantContext';
import { ActionBar } from './ActionBar';

export const CurrentEvent: React.FC = () => {
  const state = usePlant();
  const event = deriveCommanderEvent(state);
  const date = event.at ? new Date(event.at) : null;
  const time = date && Number.isFinite(date.getTime())
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
    : null;

  return (
    <section className={'command-event command-event-' + event.tone} aria-label="Current system event">
      <div className="command-event-marker" aria-hidden="true">NOW</div>
      <div className="command-event-content" aria-live="polite" aria-atomic="true">
        <div className="command-event-meta">
          <span className="command-state-dot" aria-hidden="true" />
          <span className="command-event-label">Current event</span>
          <span>{event.actor}</span>
          {time && <time dateTime={event.at!}>{time}</time>}
        </div>
        <h1>{event.title}</h1>
        {event.detail && <p>{event.detail}</p>}
        {state.incident?.flag && state.incident.incident.incident_id === state.selectedIncidentId && <a className="command-event-origin" href="#investigation-thread">From Spark’s detection to this decision <span aria-hidden="true">↗</span></a>}
      </div>
      <ActionBar />
    </section>
  );
};
