import React from 'react';
import { humanize } from '../../lib/format';
import type { Differential, FieldTaskResult, GaugeResult, ValvePolicy, VoiceComparison, VoicePayload } from '../../types';
import { Pill, type Tone } from '../common/Pill';

const GAUGE_STATUS: Record<string, { text: string; tone: Tone }> = {
  read: { text: 'Read', tone: 'ok' },
  ambiguous: { text: 'Two dials in photo', tone: 'warning' },
  unreadable: { text: 'Unreadable', tone: 'alarm' },
  not_found: { text: 'Not found', tone: 'alarm' },
};

const between = (reasoning: string | null | undefined) => {
  const m = reasoning?.match(/^BETWEEN:\s*(.+)$/im);
  return m ? m[1].trim() : '-';
};

const fmt = (n: number | null | undefined) => (n === null || n === undefined ? '-' : n.toFixed(1));

export const GaugeResults: React.FC<{ gauges: GaugeResult[] }> = ({ gauges }) => (
  <div className="table-wrap">
    <table className="results-table">
      <caption className="visually-hidden">Gauge readings in psi</caption>
      <thead>
        <tr>
          <th scope="col">Gauge</th>
          <th scope="col" className="num">Value</th>
          <th scope="col">Pointer between</th>
          <th scope="col">Status</th>
        </tr>
      </thead>
      <tbody>
        {gauges.map((g) => {
          const status = GAUGE_STATUS[g.status] ?? { text: humanize(g.status), tone: 'neutral' as Tone };
          return (
            <tr key={g.tag}>
              <th scope="row"><code className="tag">{g.tag}</code></th>
              <td className="num strong">{fmt(g.value)}</td>
              <td>{between(g.wonder_reasoning)}</td>
              <td><Pill tone={status.tone}>{status.text}</Pill></td>
            </tr>
          );
        })}
      </tbody>
    </table>
    <p className="muted small">
      All values in psi. SAM 3.1 masks the dial, code cuts out the masked dial, and Muse Wonder reads the red psi scale on that cut-out. Only read values are stored.
    </p>
  </div>
);

export const DifferentialResult: React.FC<{ differential: Differential }> = ({ differential: d }) => (
  <div className={`attempt${d.restricted ? ' is-retry' : ' is-ok'}`}>
    <p>
      <strong>Differential {d.dp_psi.toFixed(1)} psi</strong> (inlet {d.inlet_psi.toFixed(1)} minus outlet {d.outlet_psi.toFixed(1)}).{' '}
      <Pill tone={d.restricted ? 'alarm' : 'ok'}>{d.restricted ? 'Bank restricted' : 'Within normal range'}</Pill>
    </p>
    <p className="muted small">Normal is about {d.normal_dp_psi.toFixed(0)} psi; a restriction starts at {d.limit_dp_psi.toFixed(0)} psi. Computed in code.</p>
  </div>
);

const COMPARISON_TEXT: Record<string, { text: string; tone: Tone }> = {
  AGREE: { text: 'Agrees with photo', tone: 'ok' },
  DISAGREE: { text: 'Disagrees with photo', tone: 'alarm' },
  PARTIAL: { text: 'Partly checked', tone: 'warning' },
  AWAITING_PHOTO: { text: 'Awaiting photo', tone: 'neutral' },
};

const VoiceReadings: React.FC<{ comparison: VoiceComparison | undefined }> = ({ comparison }) => {
  const spoken = comparison?.spoken_readings ?? {};
  const photo = comparison?.photo_readings ?? {};
  const tags = [...new Set([...Object.keys(spoken), ...Object.keys(photo)])].sort();
  if (tags.length === 0) return null;
  return (
    <table className="mini-table" aria-label="Spoken readings against photo readings">
      <thead>
        <tr>
          <th scope="col">Gauge</th>
          <th scope="col" className="num">Spoken</th>
          <th scope="col" className="num">Photo</th>
        </tr>
      </thead>
      <tbody>
        {tags.map((tag) => (
          <tr key={tag}>
            <th scope="row"><code className="tag">{tag}</code></th>
            <td className="num strong">{fmt(spoken[tag])}</td>
            <td className="num">{fmt(photo[tag])}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

export const VoiceResult: React.FC<{ voice: VoicePayload }> = ({ voice }) => {
  if (voice.error) return <p className="result-error">{voice.error}</p>;
  const status = voice.comparison ? (COMPARISON_TEXT[voice.comparison.status] ?? { text: humanize(voice.comparison.status), tone: 'neutral' as Tone }) : null;
  return (
    <div className="voice-result">
      <div className="result-head">
        <strong>Voice note</strong>
        {status && <Pill tone={status.tone}>{status.text}</Pill>}
        {voice.model && <span className="attribution">Transcribed by {voice.model}</span>}
      </div>
      {voice.transcript && <blockquote>{voice.transcript}</blockquote>}
      {voice.structured?.observation && <p className="small">Structured observation: {voice.structured.observation}</p>}
      <VoiceReadings comparison={voice.comparison} />
      {voice.comparison?.summary && <p className="small muted">{voice.comparison.summary}</p>}
    </div>
  );
};

const POLICY_TEXT: Record<string, { text: string; tone: Tone }> = {
  passed: { text: 'Staged rule passed', tone: 'ok' },
  violated: { text: 'Staged rule violated', tone: 'alarm' },
  uncertain: { text: 'Uncertain', tone: 'warning' },
};

export const PolicyResult: React.FC<{ policy: ValvePolicy }> = ({ policy }) => {
  const status = POLICY_TEXT[policy.status] ?? { text: humanize(policy.status), tone: 'neutral' as Tone };
  return (
    <div className="policy-result">
      <div className="result-head">
        <strong>Lever clip</strong>
        <Pill tone={status.tone}>{status.text}</Pill>
      </div>
      {(policy.segments ?? []).length > 0 && (
        <p className="small">
          Timeline:{' '}
          {policy.segments.map((seg) => `${seg.kind === 'moving' ? 'moved' : 'still'} ${seg.duration_s.toFixed(1)} s`).join(', then ')}
        </p>
      )}
      <p className="small">
        Movements by hand: {policy.movements ?? 0}
        {policy.hold_s !== null && policy.hold_s !== undefined && <> · hold between them {policy.hold_s.toFixed(1)} s</>}
      </p>
      {policy.reasons.length > 0 && (
        <ul className="small plain-list">
          {policy.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
      <p className="muted small">SAM 3.1 tracks the lever and the hand; code times the movements and checks the staged rule. No angle is measured; the closed position is confirmed by the verifier on telemetry.</p>
    </div>
  );
};

export const TaskResultView: React.FC<{ result: FieldTaskResult; hideVoice?: boolean }> = ({ result, hideVoice }) => (
  <div className="task-result">
    {result.gauges && result.gauges.length > 0 && <GaugeResults gauges={result.gauges} />}
    {!result.gauges && result.readings && Object.keys(result.readings).length > 0 && (
      <ul className="plain-list">
        {Object.entries(result.readings).map(([tag, value]) => (
          <li key={tag}>
            <code className="tag">{tag}</code> <span className="num strong">{value.toFixed(1)}</span> psi (typed by the operator)
          </li>
        ))}
      </ul>
    )}
    {result.policy && <PolicyResult policy={result.policy} />}
    {result.voice && !hideVoice && <VoiceResult voice={result.voice} />}
    {result.note && <p className="small">Operator note: {result.note}</p>}
  </div>
);
