import React, { useCallback, useState } from 'react';
import { evidenceText, hypothesisOrder, hypothesisStatus } from '../../lib/hypothesisGraph';
import type { Hypothesis, IncidentDetail } from '../../types';
import { HypothesisGraphModal } from './HypothesisGraphModal';

interface Props { items: Hypothesis[]; model: string | null; title?: string; compact?: boolean; detail?: IncidentDetail }
export const Hypotheses: React.FC<Props> = ({ items, model, title = 'Hypotheses', compact, detail }) => {
  const [mapOpen, setMapOpen] = useState(false);
  const [initialNode, setInitialNode] = useState<string>();
  const closeMap = useCallback(() => setMapOpen(false), []);
  const ordered = [...items].sort((a, b) => hypothesisOrder[a.status] - hypothesisOrder[b.status] || a.label.localeCompare(b.label, undefined, { numeric: true }));
  const supported = items.filter(item => item.status === 'supported' || item.status === 'confirmed').length;
  const rejected = items.filter(item => item.status === 'rejected').length;
  const shown = ordered.slice(0, compact ? 2 : 3);
  const openMap = (node?: string) => { setInitialNode(node); setMapOpen(true); };
  return <section id="hypothesis-board" className="investigation-card hypothesis-board hypothesis-overview" aria-label={title}>
    <div className="investigation-card-head"><div><span className="investigation-eyebrow">Muse Wonder · diagnosis</span><h3>{title}</h3></div>
      <button className="hypothesis-expand" type="button" onClick={() => openMap()} aria-haspopup="dialog">Expand map <span aria-hidden="true">↗</span></button>
    </div>
    {items.length > 0 && <div className="hypothesis-overview-key" aria-label="Hypothesis summary"><span className="is-supported">{supported} supported</span><span>{items.length - supported - rejected} under review</span><span className="is-rejected">{rejected} ruled out</span></div>}
    {items.length === 0 ? <p className="hypothesis-overview-empty">Wonder’s possible causes will appear here as the investigation develops.</p> : <ol className="finding-list">{shown.map(hypothesis => {
      const primary = hypothesis.status === 'rejected' ? hypothesis.evidence_against : hypothesis.evidence_for;
      return <li className={`finding finding-${hypothesis.status}`} key={hypothesis.label}><button className="hypothesis-row" type="button" onClick={() => openMap(`hypothesis:${hypothesis.label}`)} aria-haspopup="dialog" aria-label={`${hypothesis.label}: ${hypothesis.statement}. ${hypothesisStatus[hypothesis.status]}. Open full evidence`}>
        <span className="hypothesis-row-heading"><span className="hypothesis-id">{hypothesis.label}</span><strong>{hypothesis.statement}</strong><span className={`hypothesis-row-status is-${hypothesis.status}`}>{hypothesisStatus[hypothesis.status]}</span></span>
        <span className="hypothesis-row-evidence">{primary.length ? evidenceText(primary[0]) : hypothesis.status === 'rejected' ? 'No rejection reason recorded.' : 'Evidence still being assessed.'}</span>
      </button></li>;
    })}</ol>}
    {ordered.length > shown.length && <button className="hypothesis-more" type="button" onClick={() => openMap()} aria-haspopup="dialog">View all {ordered.length} hypotheses and recorded checks <span aria-hidden="true">→</span></button>}
    {mapOpen && <HypothesisGraphModal items={items} detail={detail} model={model} initialNode={initialNode} onClose={closeMap} />}
  </section>;
};
