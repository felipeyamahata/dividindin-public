import { useEffect, useRef } from 'react';
import { computeReconnectDelayMs } from '../../domain/eventSync.js';
import { api } from './api.js';

/**
 * Subscribes to a server-sent events endpoint while the view is active and the document is visible.
 * Automatically pauses in background tabs, runs a catch-up sync on return, and coalesces burst events.
 */
export function useEventAutoSync({
  endpoint,
  enabled = true,
  onSync,
}) {
  const onSyncRef = useRef(onSync);
  onSyncRef.current = onSync;

  useEffect(() => {
    if (!enabled || !endpoint || typeof window === 'undefined') {
      return undefined;
    }

    let disposed = false;
    let activeController = null;
    let reconnectTimer = null;
    let attempt = 0;
    let syncInFlight = false;
    let syncQueued = false;

    const triggerSync = async (payload = null) => {
      if (disposed) return;
      if (syncInFlight) {
        syncQueued = true;
        return;
      }
      syncInFlight = true;
      try {
        await onSyncRef.current?.(payload);
      } finally {
        syncInFlight = false;
        if (syncQueued && !disposed) {
          syncQueued = false;
          triggerSync(null);
        }
      }
    };

    const clearReconnect = () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const closeStream = () => {
      clearReconnect();
      if (activeController) {
        activeController.abort();
        activeController = null;
      }
    };

    const scheduleReconnect = () => {
      if (disposed || document.visibilityState === 'hidden' || navigator.onLine === false) return;
      clearReconnect();
      const delayMs = computeReconnectDelayMs({ attempt });
      attempt += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delayMs);
    };

    const connect = () => {
      if (disposed || document.visibilityState === 'hidden' || navigator.onLine === false) return;
      closeStream();
      const controller = new AbortController();
      activeController = controller;

      api.openEventStream(endpoint, {
        signal: controller.signal,
        onReady: () => {
          attempt = 0;
        },
        onEvent: (evt) => {
          if (evt.event !== 'sync') return;
          let payload = null;
          try {
            payload = evt.data ? JSON.parse(evt.data) : null;
          } catch {
            payload = null;
          }
          triggerSync(payload);
        },
        onClose: ({ fatal } = {}) => {
          if (activeController === controller) {
            activeController = null;
          }
          if (!disposed && !fatal) {
            scheduleReconnect();
          }
        },
      });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        closeStream();
      } else if (document.visibilityState === 'visible') {
        attempt = 0;
        triggerSync({ reason: 'visibility_resume' });
        connect();
      }
    };

    const handleOnline = () => {
      attempt = 0;
      triggerSync({ reason: 'network_online' });
      connect();
    };

    const handleOffline = () => {
      closeStream();
    };

    connect();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      disposed = true;
      closeStream();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [endpoint, enabled]);
}
