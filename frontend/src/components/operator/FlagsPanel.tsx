import React from 'react';
import { formatTime, humanize } from '../../lib/format';
import { usePlant } from '../../state/PlantContext';
import { Pill, type Tone } from '../common/Pill';

const SEVERITY_TONE: Record<string, Tone> = { info: 'neutral', warning: 'warning', critical: 'alarm' };
const STATUS_TEXT: Record<string, string> = {
  open: 'Open',
  picked_up: 'Picked up',
  dismissed: 'Dismissed',
  resolved: 'Resolved',
};

export const FlagsPanel: React.FC = () => {
  const { flags, hiddenFlagCount } = usePlant();

  return (
    <section className="panel" aria-label="Signal flags">
      <div className="panel-head">
        <h2 className="panel-title">Signal flags</h2>
        <span className="count">{flags.length}</span>
      </div>
      {flags.length === 0 ? (
        <p className="muted">No flags raised.</p>
      ) : (
        <ul className="flag-list">
          {flags.map((flag) => (
            <li className="flag" key={flag.id}>
              <div className="flag-head">
                <Pill tone={SEVERITY_TONE[flag.severity] ?? 'neutral'}>{humanize(flag.severity)}</Pill>
                <span className="flag-status">{STATUS_TEXT[flag.status] ?? humanize(flag.status)}</span>
                <time className="flag-time">{formatTime(flag.raised_at)}</time>
              </div>
              <p className="flag-summary">{flag.summary}</p>
              <div className="chips">
                {flag.tags.map((tag) => (
                  <code className="tag" key={tag}>
                    {tag}
                  </code>
                ))}
              </div>
              <div className="flag-meta">
                {flag.model ? `Raised by ${flag.model}` : 'Raised by the watcher'}
                {flag.incident_id ? ` - incident ${flag.incident_id}` : ''}
              </div>
            </li>
          ))}
        </ul>
      )}
      {hiddenFlagCount > 0 && <p className="muted small">{hiddenFlagCount} earlier flag{hiddenFlagCount === 1 ? '' : 's'} from previous runs not shown.</p>}
    </section>
  );
};
