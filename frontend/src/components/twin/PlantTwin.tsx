import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { PlantPack } from '../../lib/plantPack';
import { loadPlantPack } from '../../lib/plantPack';
import type { TwinTargets } from '../../lib/twinTargets';
import { usePlant } from '../../state/PlantContext';
// @ts-expect-error plantScene is plain JavaScript
import { createPlantScene } from '../../scene/plantScene';

interface Scene {
  model: PlantPack;
  setInstrument: (tag: string, value: number | null) => void;
  highlight: (ids: string[], kind: string) => void;
  setObservability: (on: boolean) => void;
  flyTo: (target: string | string[]) => void;
  dispose: () => void;
  on: (name: string, fn: (payload: { assetId?: string; tag?: string | null }) => void) => () => void;
}

export interface PlantTwinHandle {
  flyTo: (target: string | string[]) => void;
  flyToTargets: () => void;
}

interface Props {
  targets: TwinTargets;
  warningAssets?: string[];
  alarmAssets?: string[];
  feedValues?: boolean;
  observability?: boolean;
  autoFly?: boolean;
  labels?: boolean;
  className?: string;
  onSelect?: (code: string) => void;
  onReady?: (ready: boolean) => void;
}

export const PlantTwin = forwardRef<PlantTwinHandle, Props>(function PlantTwin(
  { targets, warningAssets = [], alarmAssets = [], feedValues = true, observability = false, autoFly = true, labels = true, className, onSelect, onReady },
  ref,
) {
  const { plant, readings: latest, run } = usePlant();
  const container = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const plantId = plant?.plant_id;

  useEffect(() => {
    const host = container.current;
    if (!host || !plantId) return;
    let disposed = false;
    setLoadError(null);
    loadPlantPack(plantId)
      .then((model) => {
        if (disposed) return;
        const scene: Scene = createPlantScene(host, model, { labels });
        scene.on('select', ({ assetId, tag }) => onSelectRef.current?.(tag ?? assetId ?? ''));
        sceneRef.current = scene;
        setReady(true);
        onReady?.(true);
      })
      .catch((error: Error) => !disposed && setLoadError(`The plant model could not be loaded (${error.message}).`));
    return () => {
      disposed = true;
      sceneRef.current?.dispose();
      sceneRef.current = null;
      setReady(false);
      onReady?.(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plantId, labels]);

  useImperativeHandle(
    ref,
    () => ({
      flyTo: (target) => sceneRef.current?.flyTo(target),
      flyToTargets: () => targets.frame.length && sceneRef.current?.flyTo(targets.frame),
    }),
    [targets],
  );

  // A reading from an earlier run is history, not the plant's current state.
  const readings = useMemo(
    () => (feedValues ? Object.entries(latest).filter(([, r]) => !run || r.run_id === run.id) : []),
    [latest, run, feedValues],
  );

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !ready) return;
    for (const [tag, reading] of readings) scene.setInstrument(tag, reading.value);
  }, [readings, ready]);

  const taskIds = targets.kind === 'task' ? targets.highlightIds.join('|') : '';
  const focusIds = targets.kind === 'focus' ? targets.highlightIds.join('|') : '';
  const warnKey = warningAssets.join('|');
  const alarmKey = alarmAssets.join('|');

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !ready) return;
    scene.highlight(taskIds ? taskIds.split('|') : [], 'task');
    scene.highlight(focusIds ? focusIds.split('|') : [], 'focus');
    scene.highlight(warnKey ? warnKey.split('|') : [], 'warning');
    scene.highlight(alarmKey ? alarmKey.split('|') : [], 'alarm');
  }, [ready, taskIds, focusIds, warnKey, alarmKey]);

  const hadTargets = useRef(false);
  useEffect(() => {
    if (!ready || !autoFly) return;
    if (targets.frame.length > 0) {
      sceneRef.current?.flyTo(targets.frame);
      hadTargets.current = true;
    } else if (hadTargets.current) {
      // The work is over: step back to the whole plant.
      sceneRef.current?.flyTo('overview');
      hadTargets.current = false;
    }
    // fly once per distinct target set
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, autoFly, targets.key]);

  useEffect(() => {
    if (ready) sceneRef.current?.setObservability(observability);
  }, [ready, observability]);

  return (
    <div className={`twin-canvas${className ? ` ${className}` : ''}`} ref={container}>
      {loadError && (
        <div className="twin-error" role="alert">
          {loadError}
        </div>
      )}
    </div>
  );
});
