import React, { useCallback, useEffect, useRef, useState } from 'react';
import { attachDialogOutsideFallback, closeAnimatedDialog } from '../lib/dialogTopLayer.js';
import { useBackLayer } from '../lib/useHistoryNavigation.js';

export function requestConfirmation(message, action = 'confirmar') {
  return new Promise(resolve => window.dispatchEvent(new CustomEvent('divide:confirm', { detail: { message, action, isNotice: false, title: 'confirmar ação', resolve } })));
}

export function requestNotice(message, action = 'entendi', title = 'aviso') {
  return new Promise(resolve => window.dispatchEvent(new CustomEvent('divide:confirm', { detail: { message, action, isNotice: true, title, resolve } })));
}

async function waitForDialogExit(el) {
  if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const animations = el.getAnimations?.({ subtree: true }) || [];
  if (!animations.length) return;
  await Promise.race([
    Promise.allSettled(animations.map((a) => a.finished)),
    new Promise((resolve) => setTimeout(resolve, 260)),
  ]);
}

export function ConfirmDialog() {
  const [request, setRequest] = useState(null);
  const [rendered, setRendered] = useState(null);
  const [closing, setClosing] = useState(false);
  const dialog = useRef(null);
  const closingRef = useRef(false);
  const requestRef = useRef(null);
  const clearTimerRef = useRef(null);

  const scheduleClearRendered = useCallback(() => {
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    clearTimerRef.current = setTimeout(() => {
      if (!requestRef.current) setRendered(null);
      clearTimerRef.current = null;
    }, 240);
  }, []);

  const finish = useCallback(async (result) => {
    const active = requestRef.current;
    if (!active || closingRef.current) return;
    closingRef.current = true;
    setClosing(true);

    const el = dialog.current;
    await closeAnimatedDialog(el);
    await waitForDialogExit(el);

    closingRef.current = false;
    setClosing(false);
    requestRef.current = null;
    setRequest(null);
    scheduleClearRendered();
    active.resolve(result);
  }, [scheduleClearRendered]);

  useBackLayer(
    'confirm-dialog',
    Boolean(request) && !closing,
    () => {
      void finish(false);
    },
    { priority: 100 }
  );

  useEffect(() => () => {
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
  }, []);

  useEffect(() => {
    const open = (event) => {
      if (clearTimerRef.current) {
        clearTimeout(clearTimerRef.current);
        clearTimerRef.current = null;
      }
      closingRef.current = false;
      setClosing(false);
      requestRef.current = event.detail;
      setRequest(event.detail);
      setRendered(event.detail);
    };
    window.addEventListener('divide:confirm', open);
    return () => window.removeEventListener('divide:confirm', open);
  }, []);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return undefined;
    el.setAttribute('closedby', 'any');
    return attachDialogOutsideFallback(el, () => closingRef.current, () => finish(false));
  }, [finish]);

  useEffect(() => {
    const el = dialog.current;
    if (!el || !request) return;
    el.removeAttribute('data-closing');
    if (!el.open) el.showModal();
  }, [request]);

  return (
    <dialog
      ref={dialog}
      className="confirm-dialog"
      onCancel={(e) => {
        e.preventDefault();
        finish(false);
      }}
      onClose={() => {
        if (dialog.current) dialog.current.returnValue = '';
        if (!closingRef.current && requestRef.current) {
          const active = requestRef.current;
          requestRef.current = null;
          setRequest(null);
          scheduleClearRendered();
          active.resolve(false);
        }
      }}
      aria-labelledby="confirm-title"
    >
      {rendered && (
        <>
          <h2 id="confirm-title">{rendered.title || 'confirmar ação'}</h2>
          <p>{rendered.message}</p>
          <div className="confirm-dialog__actions">
            {!rendered.isNotice && (
              <button type="button" disabled={closing} onClick={() => finish(false)} autoFocus>
                cancelar
              </button>
            )}
            <button type="button" disabled={closing} onClick={() => finish(true)} autoFocus={Boolean(rendered.isNotice)}>
              {rendered.action}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
