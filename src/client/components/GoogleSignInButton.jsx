import React, { useEffect, useRef, useState } from 'react';
import './GoogleSignInButton.css';

const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim();
const GIS_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';

let gisLoaderPromise = null;

function loadGoogleIdentityScript() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('Ambiente sem navegador'));
  }
  if (window.google?.accounts?.id) {
    return Promise.resolve(window.google);
  }
  if (gisLoaderPromise) {
    return gisLoaderPromise;
  }

  gisLoaderPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${GIS_SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(window.google), { once: true });
      existing.addEventListener('error', () => {
        gisLoaderPromise = null;
        reject(new Error('Falha ao carregar login do Google'));
      }, { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = GIS_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.google?.accounts?.id) {
        resolve(window.google);
      } else {
        gisLoaderPromise = null;
        reject(new Error('Login do Google indisponível'));
      }
    };
    script.onerror = () => {
      gisLoaderPromise = null;
      reject(new Error('Falha ao carregar login do Google'));
    };
    document.head.appendChild(script);
  });

  return gisLoaderPromise;
}

export function isGoogleSignInEnabled() {
  return Boolean(GOOGLE_CLIENT_ID);
}

/**
 * Renders Google Identity Services sign-in button with reserved slot height to prevent layout shift.
 */
export function GoogleSignInButton({
  onCredential,
  onError,
  disabled = false,
  text = 'continue_with',
  labelDivider = 'ou',
}) {
  const containerRef = useRef(null);
  const slotRef = useRef(null);
  const onCredentialRef = useRef(onCredential);
  const onErrorRef = useRef(onError);
  onCredentialRef.current = onCredential;
  onErrorRef.current = onError;

  const [width, setWidth] = useState(320);
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'unavailable'

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const updateWidth = () => {
      const measured = Math.floor(el.getBoundingClientRect().width);
      if (measured > 0) {
        setWidth(Math.min(400, Math.max(220, measured)));
      }
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return undefined;
    let active = true;

    loadGoogleIdentityScript()
      .then((google) => {
        if (!active || !slotRef.current) return;
        google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          ux_mode: 'popup',
          callback: async (response) => {
            if (!response?.credential) {
              onErrorRef.current?.('não foi possível validar sua conta google.');
              return;
            }
            try {
              await onCredentialRef.current?.(response.credential);
            } catch (err) {
              onErrorRef.current?.(err?.message || 'não foi possível entrar com google.');
            }
          },
        });

        slotRef.current.innerHTML = '';
        google.accounts.id.renderButton(slotRef.current, {
          type: 'standard',
          theme: 'filled_black',
          size: 'large',
          text,
          shape: 'rectangular',
          logo_alignment: 'left',
          width,
          locale: 'pt-BR',
        });
        setStatus('ready');
      })
      .catch(() => {
        if (!active) return;
        setStatus('unavailable');
      });

    return () => {
      active = false;
    };
  }, [width, text]);

  if (!GOOGLE_CLIENT_ID || status === 'unavailable') {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className={`google-auth${disabled ? ' google-auth--disabled' : ''}`}
      aria-busy={disabled || status === 'loading' ? 'true' : undefined}
    >
      {labelDivider && (
        <div className="google-auth__divider" aria-hidden="true">
          <span>{labelDivider}</span>
        </div>
      )}
      <div
        ref={slotRef}
        className="google-auth__slot"
      />
    </div>
  );
}
