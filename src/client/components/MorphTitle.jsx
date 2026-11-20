import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from '../lib/morph.js';
import './MorphTitle.css';

const FADE_OUT_MS = 130;
const HEIGHT_MORPH_MS = 300;

/**
 * Smoothly transitions group titles across both same-line edits and 1-line <-> 2-line height changes.
 */
export function MorphTitle({
  text = '',
  morphKey = 'default',
  as = 'h1',
  className = '',
  title,
}) {
  const normalized = text ?? '';
  const Tag = as;
  const boxRef = useRef(null);
  const [displayedText, setDisplayedText] = useState(normalized);
  const [phase, setPhase] = useState('idle'); // 'idle' | 'out' | 'in'
  const [textHidden, setTextHidden] = useState(false);

  const prevMorphKeyRef = useRef(morphKey);
  const displayedRef = useRef(normalized);
  const fromHeightRef = useRef(null);
  const fadeTimerRef = useRef(null);
  const settleTimerRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    displayedRef.current = displayedText;
  }, [displayedText]);

  const clearTimers = () => {
    if (fadeTimerRef.current) {
      clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }
    if (settleTimerRef.current) {
      clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  useEffect(() => () => clearTimers(), []);

  useEffect(() => {
    if (prevMorphKeyRef.current !== morphKey) {
      prevMorphKeyRef.current = morphKey;
      clearTimers();
      fromHeightRef.current = null;
      if (boxRef.current) {
        boxRef.current.style.transition = '';
        boxRef.current.style.height = '';
      }
      displayedRef.current = normalized;
      setDisplayedText(normalized);
      setTextHidden(false);
      setPhase('idle');
      return;
    }

    if (normalized === displayedRef.current) return;

    clearTimers();
    if (prefersReducedMotion() || !boxRef.current) {
      fromHeightRef.current = null;
      if (boxRef.current) {
        boxRef.current.style.transition = '';
        boxRef.current.style.height = '';
      }
      displayedRef.current = normalized;
      setDisplayedText(normalized);
      setTextHidden(false);
      setPhase('idle');
      return;
    }

    const boxEl = boxRef.current;
    const currentHeight = boxEl.getBoundingClientRect().height;
    fromHeightRef.current = currentHeight;
    boxEl.style.transition = 'none';
    boxEl.style.height = `${currentHeight}px`;

    setPhase('out');
    setTextHidden(true);

    fadeTimerRef.current = setTimeout(() => {
      fadeTimerRef.current = null;
      displayedRef.current = normalized;
      setDisplayedText(normalized);
      setPhase('in');
    }, FADE_OUT_MS);
  }, [normalized, morphKey]);

  useLayoutEffect(() => {
    if (phase !== 'in') return undefined;
    const boxEl = boxRef.current;
    if (!boxEl) {
      setTextHidden(false);
      setPhase('idle');
      return undefined;
    }

    const fromHeight = fromHeightRef.current;
    boxEl.style.transition = 'none';
    boxEl.style.height = 'auto';
    const toHeight = boxEl.getBoundingClientRect().height;

    if (fromHeight != null && Math.abs(toHeight - fromHeight) > 0.5) {
      boxEl.style.height = `${fromHeight}px`;
      void boxEl.offsetHeight;
      boxEl.style.transition = `height ${HEIGHT_MORPH_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
      boxEl.style.height = `${toHeight}px`;
    } else {
      boxEl.style.height = '';
      boxEl.style.transition = '';
    }

    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      setTextHidden(false);
    });

    settleTimerRef.current = setTimeout(() => {
      settleTimerRef.current = null;
      if (boxRef.current) {
        boxRef.current.style.transition = '';
        boxRef.current.style.height = '';
      }
      fromHeightRef.current = null;
      setPhase('idle');
    }, HEIGHT_MORPH_MS + 30);

    return undefined;
  }, [phase, displayedText]);

  return (
    <span ref={boxRef} className="morph-title">
      <Tag
        className={`morph-title__text${textHidden ? ' is-out' : ''}${className ? ` ${className}` : ''}`}
        title={title}
      >
        {displayedText}
      </Tag>
    </span>
  );
}
