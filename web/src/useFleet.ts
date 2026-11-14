import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type FleetEvent, type Home, type Lesson, type Scoreboard } from './api';

export interface FleetState {
  homes: Home[];
  lessons: Lesson[];
  events: FleetEvent[];
  scoreboard: Scoreboard | null;
  connected: boolean;
}

export function useFleet(onEvent: (e: FleetEvent) => void) {
  const [state, setState] = useState<FleetState>({ homes: [], lessons: [], events: [], scoreboard: null, connected: false });
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  // Full state only on (re)connect. Live updates come as pushed events and home documents;
  // event-driven refreshes reload lessons only, so a slow response can't overwrite newer home state.
  const refresh = useCallback(async () => {
    const s = await api<Omit<FleetState, 'connected'>>('/api/state');
    setState((p) => ({ ...p, ...s }));
  }, []);
  const refreshLessons = useCallback(async () => {
    const lessons = await api<Lesson[]>('/api/lessons');
    setState((p) => ({ ...p, lessons }));
  }, []);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let stop = false;
    let retry: ReturnType<typeof setTimeout>;
    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/ws`);
      ws.onopen = () => {
        setState((p) => ({ ...p, connected: true }));
        refresh().catch(() => {});
      };
      ws.onclose = () => {
        setState((p) => ({ ...p, connected: false }));
        if (!stop) retry = setTimeout(connect, 1000);
      };
      ws.onmessage = (m) => {
        const msg = JSON.parse(m.data);
        if (msg.kind === 'event') {
          setState((p) => ({ ...p, events: [...p.events.slice(-120), msg.event] }));
          onEventRef.current(msg.event);
          if (['published', 'rolled_back', 'forgotten'].includes(msg.event.type) || (msg.event.type === 'ran' && msg.event.detail?.cause === 'ask')) {
            refreshLessons().catch(() => {});
          }
        } else if (msg.kind === 'home') {
          setState((p) => ({ ...p, homes: p.homes.map((h) => (h._id === msg.home._id ? msg.home : h)) }));
        } else if (msg.kind === 'scoreboard') {
          setState((p) => ({ ...p, scoreboard: msg.scoreboard }));
        }
      };
    };
    connect();
    return () => { stop = true; clearTimeout(retry); ws?.close(); };
  }, [refresh, refreshLessons]);

  return { ...state, refresh, refreshLessons };
}
