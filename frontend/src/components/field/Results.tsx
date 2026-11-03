import React from 'react';
import { humanize } from '../../lib/format';
import type { FieldTaskResult, GaugeResult, ValvePolicy, VoicePayload } from '../../types';
import { Pill, type Tone } from '../common/Pill';

const GAUGE_STATUS: Record<string, { text: string; tone: Tone }> = {
  agree: { text: 'Agree', tone: 'ok' },
  single_source: { text: 'Single source', tone: 'warning' },
  uncertain: { text: 'Uncertain', tone: 'warning' },
  unreadable: { text: 'Unreadable', tone: 'alarm' },
  not_found: { text: 'Not found', tone: 'alarm' },
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
          <th scope="col" className="num">Wonder</th>
          <th scope="col" className="num">Needle</th>
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
              <td className="num">{fmt(g.wonder_psi)}</td>
              <td className="num">{fmt(g.needle_psi)}</td>
              <td><Pill tone={status.tone}>{status.text}</Pill></td>
            </tr>
          );
        })}
      </tbody>
    </table>
    <p className="muted small">
      All values in psi. Dials located with SAM, read by Muse Wonder on the red psi scale, cross-checked against the needle angle measured in code. Only agreeing or single-source values are stored.
    </p>
  </div>
);

const COMPARISON_TEXT: Record<string, { text: string; tone: Tone }> = {
  AGREE: { text: 'Agrees with photo', tone: 'ok' },
  DISAGREE: { text: 'Disagrees with photo', tone: 'alarm' },
  PARTIAL: { text: 'Partly checked', tone: 'warning' },
  AWAITING_PHOTO: { text: 'Awaiting photo', tone: 'neutral' },
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
      {policy.stages_seen.length > 0 && <p className="small">Stages seen: {policy.stages_seen.map((s) => humanize(s)).join(' then ')}</p>}
      {policy.reasons.length > 0 && (
        <ul className="small plain-list">
          {policy.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
      <p className="muted small">Lever and pipe masks tracked by SAM; the angle and the staged rule are computed in code.</p>
    </div>
  );
};

export const TaskResultView: React.FC<{ result: FieldTaskResult }> = ({ result }) => (
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
    {result.voice && <VoiceResult voice={result.voice} />}
    {result.note && <p className="small">Operator note: {result.note}</p>}
  </div>
);
