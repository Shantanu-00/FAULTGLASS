import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatTime } from '../../lib/format';
import { deriveHypothesisGraph, type GraphLane, type HypothesisGraphEdge } from '../../lib/hypothesisGraph';
import type { Hypothesis, IncidentDetail } from '../../types';

interface Props { items: Hypothesis[]; detail?: IncidentDetail; model: string | null; initialNode?: string; onClose: () => void }
const LANES: { id: GraphLane; label: string; detail: string }[] = [
  { id: 'observations', label: 'Detection & evidence', detail: 'What was observed' },
  { id: 'hypotheses', label: 'Competing causes', detail: 'What Wonder tested' },
  { id: 'response', label: 'Recorded response', detail: 'What was requested' },
  { id: 'outcome', label: 'Verification', detail: 'What the plant confirmed' },
];
interface DrawnEdge { key: string; d: string; relation: HypothesisGraphEdge['relation']; label: string }

export const HypothesisGraphModal: React.FC<Props> = ({ items, detail, model, initialNode, onClose }) => {
  const titleId = useId();
  const descriptionId = useId();
  const markerId = useId().replace(/:/g, '');
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef(new Map<string, HTMLButtonElement>());
  const graph = useMemo(() => deriveHypothesisGraph(detail, items), [detail, items]);
  const [selectedId, setSelectedId] = useState(initialNode ?? graph.nodes.find(node => node.lane === 'hypotheses')?.id ?? graph.nodes[0]?.id);
  const selected = graph.nodes.find(node => node.id === selectedId) ?? graph.nodes[0];
  const [drawn, setDrawn] = useState<{ edges: DrawnEdge[]; width: number; height: number }>({ edges: [], width: 0, height: 0 });

  useEffect(() => {
    const priorFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab') return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? [])]
        .filter(element => element.getClientRects().length > 0);
      if (!focusable.length) { event.preventDefault(); dialogRef.current?.focus(); return; }
      const first = focusable[0], last = focusable.at(-1)!;
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown);
    const keepFocusInside = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialogRef.current?.contains(event.target)) closeRef.current?.focus();
    };
    document.addEventListener('focusin', keepFocusInside);
    return () => {
      document.body.style.overflow = priorOverflow;
      document.removeEventListener('keydown', keydown);
      document.removeEventListener('focusin', keepFocusInside);
      if (priorFocus?.isConnected) priorFocus.focus();
    };
  }, [onClose]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const measure = () => {
      const base = canvas.getBoundingClientRect();
      const edges = graph.edges.flatMap((edge, index): DrawnEdge[] => {
        const source = nodeRefs.current.get(edge.from), target = nodeRefs.current.get(edge.to);
        if (!source || !target) return [];
        const a = source.getBoundingClientRect(), b = target.getBoundingClientRect();
        const sameLane = source.dataset.lane === target.dataset.lane;
        const x1 = (sameLane ? a.left + a.width / 2 : a.right) - base.left;
        const y1 = (sameLane ? a.bottom : a.top + a.height / 2) - base.top;
        const x2 = (sameLane ? b.left + b.width / 2 : b.left) - base.left;
        const y2 = (sameLane ? b.top : b.top + b.height / 2) - base.top;
        const bend = Math.max(22, Math.abs(x2 - x1) * .42);
        const d = sameLane ? `M ${x1} ${y1} L ${x2} ${y2 - 5}` : `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2 - 5} ${y2}`;
        return [{ key: `${edge.from}-${edge.to}-${index}`, d, relation: edge.relation, label: edge.label }];
      });
      setDrawn({ edges, width: canvas.scrollWidth, height: canvas.scrollHeight });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    for (const element of nodeRefs.current.values()) observer.observe(element);
    return () => observer.disconnect();
  }, [graph]);

  const nodeConnections = graph.edges.filter(edge => edge.from === selected?.id || edge.to === selected?.id);
  return createPortal(<div className="hypothesis-map-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="hypothesis-map-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} tabIndex={-1}>
      <header className="hypothesis-map-header">
        <div><span className="hypothesis-map-eyebrow">Muse Wonder · saved investigation</span><h2 id={titleId}>Investigation map</h2><p id={descriptionId}>Follow the observations, competing causes and recorded response. Select any card for its full evidence.</p></div>
        <button className="hypothesis-map-close" type="button" ref={closeRef} onClick={onClose} aria-label="Close investigation map"><span aria-hidden="true">×</span><span>Close</span></button>
      </header>
      <div className="hypothesis-map-toolbar">
        <div className="hypothesis-map-legend"><span><i className="map-dot is-supported" />Supported</span><span><i className="map-dot is-rejected" />Ruled out</span><span><i className="map-dot is-open" />Under review</span></div>
        <div className="hypothesis-map-edge-key"><span><i />Recorded link</span><span><i className="is-context" />Investigation context</span></div>
      </div>
      <div className="hypothesis-map-body">
        <div className="hypothesis-map-scroll" tabIndex={0} role="region" aria-label="Investigation flowchart; scroll to explore all columns">
          <div className="hypothesis-map-canvas" ref={canvasRef}>
            <svg className="hypothesis-map-connections" aria-hidden="true" width={drawn.width} height={drawn.height}>
              <defs><marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#81908c" /></marker></defs>
              {drawn.edges.map(edge => <path key={edge.key} d={edge.d} className={edge.relation === 'context' ? 'is-context' : ''} markerEnd={`url(#${markerId})`}><title>{edge.label}</title></path>)}
            </svg>
            {LANES.map(lane => <section className={`hypothesis-map-lane lane-${lane.id}`} key={lane.id} aria-label={lane.label}>
              <div className="hypothesis-map-lane-heading"><h3>{lane.label}</h3><span>{lane.detail}</span></div>
              <div className="hypothesis-map-lane-nodes">{graph.nodes.filter(node => node.lane === lane.id).map(node => <button type="button" className={`hypothesis-map-node tone-${node.tone}${selected?.id === node.id ? ' is-selected' : ''}`} key={node.id}
                ref={element => { if (element) nodeRefs.current.set(node.id, element); else nodeRefs.current.delete(node.id); }} data-lane={lane.id}
                aria-pressed={selected?.id === node.id} onClick={() => setSelectedId(node.id)}>
                <span className="hypothesis-map-node-eyebrow">{node.eyebrow}</span><strong>{node.title}</strong><span className="hypothesis-map-node-status">{node.status}</span><p>{node.summary}</p>
              </button>)}</div>
            </section>)}
          </div>
        </div>
        {selected && <aside className={`hypothesis-map-inspector tone-${selected.tone}`} aria-label="Selected record details" aria-live="polite">
          <div className="hypothesis-map-inspector-head"><span className="hypothesis-map-eyebrow">{selected.eyebrow}</span><span className="hypothesis-map-node-status">{selected.status}</span><h3>{selected.title}</h3>{selected.at && <time dateTime={selected.at}>Recorded {formatTime(selected.at)}</time>}</div>
          <p className="hypothesis-map-inspector-summary">{selected.summary}</p>
          {selected.sections.map((section, index) => <section className="hypothesis-map-detail-section" key={index}><h4>{section.title}</h4>{section.entries.length ? <ul>{section.entries.map((entry, entryIndex) => <li key={entryIndex}>{entry}</li>)}</ul> : <p>No evidence recorded.</p>}</section>)}
          {nodeConnections.length > 0 && <details className="hypothesis-map-link-details"><summary>How this record is connected</summary><ul>{nodeConnections.map((edge, index) => <li key={index}>{edge.label}.</li>)}</ul></details>}
        </aside>}
      </div>
      <footer className="hypothesis-map-footer"><span>Dashed arrows show investigation context, not proven causation. Current statuses come from saved records.</span><span>{model || 'Model not recorded'}{detail ? ` · ${detail.incident.incident_id}` : ''}</span></footer>
    </div>
  </div>, document.body);
};
