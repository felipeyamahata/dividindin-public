import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { EVENT_LOADING_ENTRY_FLIGHT_MS } from '../../domain/loadingTransition.js';
import { captureBrandMarkSnapshot, launchBrandMarkFlight, prefersReducedMotion } from '../lib/morph.js';
import { BrandMark } from './BrandMark.jsx';
import './EventLoadingOverlay.css';

export function EventLoadingOverlay({
  phase = 'idle',
  entrySnapshot = null,
  onRegisterCenterCapture,
}) {
  const centerMarkRef = useRef(null);
  const entryFlightLaunchedRef = useRef(false);

  useEffect(() => {
    if (!onRegisterCenterCapture) return undefined;
    onRegisterCenterCapture(() => captureBrandMarkSnapshot(centerMarkRef.current));
    return () => onRegisterCenterCapture(null);
  }, [onRegisterCenterCapture]);

  useLayoutEffect(() => {
    if (phase !== 'loading') {
      entryFlightLaunchedRef.current = false;
      return undefined;
    }
    if (entryFlightLaunchedRef.current) return undefined;
    entryFlightLaunchedRef.current = true;

    const markEl = centerMarkRef.current;
    if (!markEl || !entrySnapshot?.rect || !entrySnapshot?.cloneNode || prefersReducedMotion()) {
      return undefined;
    }

    const toRect = markEl.getBoundingClientRect();
    return launchBrandMarkFlight({
      cloneNode: entrySnapshot.cloneNode,
      hideTargetEl: markEl,
      fromRect: entrySnapshot.rect,
      toRect,
      duration: EVENT_LOADING_ENTRY_FLIGHT_MS,
    });
  }, [phase, entrySnapshot]);

  if (phase === 'idle') return null;

  const isExiting = phase === 'exiting';

  return (
    <div
      className={`event-loading${isExiting ? ' is-exiting' : ''}`}
      aria-busy={isExiting ? undefined : 'true'}
    >
      <div className="event-loading__scrim" aria-hidden="true" />
      <div className="event-loading__stage">
        <div className="event-loading__mark-wrap">
          <BrandMark
            ref={centerMarkRef}
            className={`event-loading__mark${isExiting ? ' is-hidden' : ''}`}
          />
        </div>
        <p className="event-loading__label" role="status" aria-live="polite">
          <span>Carregando evento</span>
          <span className="event-loading__dots" aria-hidden="true">
            <span className="event-loading__dot event-loading__dot--1">.</span>
            <span className="event-loading__dot event-loading__dot--2">.</span>
            <span className="event-loading__dot event-loading__dot--3">.</span>
          </span>
        </p>
      </div>
    </div>
  );
}
