import React, { useState } from 'react';
import { evidenceUrl } from '../../api/client';
import type { EvidenceAttachment } from '../../types';
import '../../styles/evidence.css';

function MediaItem({ item }: { item: EvidenceAttachment }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const url = item.available ? evidenceUrl(item.url) : null;
  const unavailable = !url || failed;
  const title = item.label || `Submitted ${item.kind}`;
  return <figure className={`evidence-file evidence-file-${item.kind}`}>
    {unavailable ? <div className="evidence-unavailable" role="status">
      <strong>{failed ? 'File could not be loaded' : 'Original file unavailable'}</strong>
      <p>{failed ? 'Check the connection and try again.' : 'This record has no accessible original file.'}</p>
      {failed && <button type="button" className="btn btn-small" onClick={() => { setFailed(false); setLoaded(false); setAttempt(value => value + 1); }}>Retry</button>}
    </div> : <div className="evidence-preview">
      {!loaded && <span className="evidence-loading" role="status">Loading {item.kind}…</span>}
      {item.kind === 'image' ? <a href={url} target="_blank" rel="noreferrer" aria-label={`Open ${title}`}>
        <img key={attempt} src={url} alt={title} loading="lazy" onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />
      </a> : item.kind === 'audio' ? <audio key={attempt} controls preload="metadata" src={url} aria-label={title}
        onLoadedMetadata={() => setLoaded(true)} onError={() => setFailed(true)} />
      : <video key={attempt} controls playsInline preload="metadata" src={url} aria-label={title}
        onLoadedMetadata={() => setLoaded(true)} onError={() => setFailed(true)} />}
    </div>}
    <figcaption><strong>{title}</strong><span>{item.kind === 'image' ? 'Photo · click to enlarge' : item.kind === 'audio' ? 'Audio · original recording' : 'Video · original recording'}</span>
      {url && <a href={url} target="_blank" rel="noreferrer">Open original <span aria-hidden="true">↗</span></a>}
    </figcaption>
  </figure>;
}

export const EvidenceMedia: React.FC<{ media?: EvidenceAttachment[]; compact?: boolean; emptyMessage?: string }> = ({ media, compact = false, emptyMessage }) => {
  if (!media?.length) return emptyMessage ? <p className="evidence-empty">{emptyMessage}</p> : null;
  return <div className={`evidence-media${compact ? ' is-compact' : ''}`} aria-label="Submitted media">
    {media.map(item => <MediaItem key={item.id} item={item} />)}
  </div>;
};
