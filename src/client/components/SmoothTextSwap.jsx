import React, { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from '../lib/morph.js';
import './SmoothTextSwap.css';

const FADE_OUT_MS = 140;

/**
 * Smoothly transitions short display text changes via sequential fade-out then fade-in.
 */
export function SmoothTextSwap({ text = '', className = '' }) {
  const normalized = text ?? '';
  const [renderedText, setRenderedText] = useState(normalized);
  const [phase, setPhase] = useState('idle');
  const renderedRef = useRef(normalized);
  const timerRef = useRef(null);

  useEffect(() => {
    renderedRef.current = renderedText;
  }, [renderedText]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  useEffect(() => {
    if (normalized === renderedRef.current) return undefined;

    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (prefersReducedMotion()) {
      renderedRef.current = normalized;
      setRenderedText(normalized);
      setPhase('idle');
      return undefined;
    }

    setPhase('out');
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      renderedRef.current = normalized;
      setRenderedText(normalized);
      setPhase('idle');
    }, FADE_OUT_MS);

    return undefined;
  }, [normalized]);

  const resolvedClass = `smooth-text-swap${phase === 'out' ? ' smooth-text-swap--out' : ''}${className ? ` ${className}` : ''}`;
  return <span className={resolvedClass}>{renderedText}</span>;
}
