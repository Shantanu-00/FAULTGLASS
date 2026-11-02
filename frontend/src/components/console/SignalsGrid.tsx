import React from 'react';
import { usePlant } from '../../context/PlantContext';
import { SparklineSvg } from './SparklineSvg';

export const SignalsGrid: React.FC = () => {
  const { signals, readings, series } = usePlant();

  const groups = [
    { title: 'PRODUCT WATER & PERMEATE', tags: ['FIT-301', 'AIT-301'] },
    { title: 'HIGH-PRESSURE CIRCUIT', tags: ['PIT-301', 'PIT-302', 'JI-301'] },
    { title: 'RAW WATER & FEED SUPPLY', tags: ['FIT-101', 'LSL-101'] },
    { title: 'PUMP DRIVES & RUN STATES', tags: ['YS-101', 'YS-301'] },
  ];

  return (
    <div className="signals">
      {groups.map((group) => {
        const groupSignals = signals.filter((s) => group.tags.includes(s.tag));
        if (!groupSignals.length) return null;

        return (
          <section key={group.title} className="group">
            <h2>{group.title}</h2>
            {groupSignals.map((signal) => {
              const reading = readings[signal.tag];
              const val = reading?.value ?? null;
              const history = series[signal.tag] || [];

              let state = 'ok';
              if (val === null) state = 'stale';
              else if (signal.limits.low_alarm !== undefined && val <= signal.limits.low_alarm) state = 'alarm';
              else if (signal.limits.high_alarm !== undefined && val >= signal.limits.high_alarm) state = 'alarm';

              let displayVal = '—';
              if (val !== null) {
                if (signal.type === 'state') {
                  displayVal = signal.state_labels?.[String(Math.round(val))] ?? String(val);
                } else {
                  displayVal = val.toFixed(1);
                }
              }

              return (
                <div key={signal.tag} className="row" data-state={state}>
                  <span className="dot" />
                  <span className="label">
                    {signal.name} <code>{signal.tag}</code>
                  </span>
                  <span className="reading">
                    <span className="num">{displayVal}</span>
                    <span className="unit">{signal.unit}</span>
                  </span>
                  <span className="trend">
                    {signal.type === 'measurement' && (
                      <SparklineSvg
                        data={history}
                        nominal={signal.limits.nominal}
                        color={state === 'alarm' ? '#DC2626' : '#181A1C'}
                      />
                    )}
                  </span>
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
};
