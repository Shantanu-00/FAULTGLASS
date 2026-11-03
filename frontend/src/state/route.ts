import { useCallback, useEffect, useState } from 'react';

export type View = 'operator' | 'field' | 'twin';

export const VIEWS: Array<{ id: View; label: string }> = [
  { id: 'operator', label: 'Operator' },
  { id: 'field', label: 'Field' },
  { id: 'twin', label: 'Twin' },
];

function parse(): View {
  const fromQuery = new URLSearchParams(window.location.search).get('view');
  const fromHash = window.location.hash.replace(/^#\/?/, '');
  const found = VIEWS.find((v) => v.id === (fromQuery ?? fromHash));
  return found ? found.id : 'operator';
}

export function useView(): [View, (view: View) => void] {
  const [view, setViewState] = useState<View>(parse);

  useEffect(() => {
    const onChange = () => setViewState(parse());
    window.addEventListener('popstate', onChange);
    window.addEventListener('hashchange', onChange);
    return () => {
      window.removeEventListener('popstate', onChange);
      window.removeEventListener('hashchange', onChange);
    };
  }, []);

  const setView = useCallback((next: View) => {
    const url = new URL(window.location.href);
    url.searchParams.set('view', next);
    url.hash = '';
    window.history.pushState(null, '', url);
    setViewState(next);
  }, []);

  return [view, setView];
}

export const DEFAULT_CLOCK_SPEED = 10;

export function clockSpeedFromUrl(): number {
  const raw = Number(new URLSearchParams(window.location.search).get('speed'));
  return Math.min(10, Math.max(1, Math.round(raw) || DEFAULT_CLOCK_SPEED));
}
