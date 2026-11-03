import { useMemo } from 'react';
import { usePlantPack } from '../lib/plantPack';
import { deriveTargets, flaggedHosts } from '../lib/twinTargets';
import { usePlant } from './PlantContext';

export function useTwinState() {
  const { plant, flags, incident } = usePlant();
  const pack = usePlantPack(plant?.plant_id);

  const flaggedTags = useMemo(
    () => [...new Set(flags.filter((f) => f.status === 'open' || f.status === 'picked_up').flatMap((f) => f.tags))],
    [flags],
  );
  const warningAssets = useMemo(() => flaggedHosts(pack, flaggedTags), [pack, flaggedTags]);
  const targets = useMemo(() => deriveTargets(incident, pack), [incident, pack]);

  return { pack, flaggedTags, warningAssets, targets };
}
