import { useEffect, useState } from 'react';

export interface PlantPack {
  assets: Array<{ id: string; kind: string; name: string }>;
  edges: Array<{ id: string; from: { asset: string; port: string }; to: { asset: string; port: string } }>;
  instruments: Array<{
    tag: string;
    observe: string;
    quantity: string;
    attach: { asset?: string; port?: string; span?: string[]; edge?: string };
  }>;
}

const FITTINGS = new Set(['tee', 'valve', 'header', 'drain']);
const cache = new Map<string, Promise<PlantPack>>();

async function fetchPack(plantId: string): Promise<PlantPack> {
  for (const name of [plantId, 'waterplant']) {
    const response = await fetch(`/plants/${name}.json`);
    if (response.ok) return response.json();
  }
  throw new Error('HTTP 404');
}

export function loadPlantPack(plantId: string): Promise<PlantPack> {
  let pending = cache.get(plantId);
  if (!pending) {
    pending = fetchPack(plantId);
    cache.set(plantId, pending);
    pending.catch(() => cache.delete(plantId));
  }
  return pending;
}

export function usePlantPack(plantId: string | undefined): PlantPack | null {
  const [pack, setPack] = useState<PlantPack | null>(null);
  useEffect(() => {
    if (!plantId) return;
    let cancelled = false;
    loadPlantPack(plantId)
      .then((loaded) => !cancelled && setPack(loaded))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [plantId]);
  return pack;
}

// The asset an instrument is mounted on, following the pack's attach reference.
export function hostOfTag(pack: PlantPack, tag: string): string | null {
  const instrument = pack.instruments.find((i) => i.tag === tag);
  if (!instrument) return null;
  const at = instrument.attach;
  if (at.asset) return at.asset;
  if (at.port) return at.port.split('.')[0];
  if (at.span?.length) return at.span[0].split('.')[0];
  if (at.edge) {
    const edge = pack.edges.find((e) => e.id === at.edge);
    if (!edge) return null;
    const kind = pack.assets.find((a) => a.id === edge.from.asset)?.kind;
    return kind && FITTINGS.has(kind) ? edge.to.asset : edge.from.asset;
  }
  return null;
}
