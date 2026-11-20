import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { getInstallGuideContent } from '../../domain/pwa.js';
import { attachDialogOutsideFallback, closeAnimatedDialog } from '../lib/dialogTopLayer.js';
import { useBackLayer } from '../lib/useHistoryNavigation.js';
import installAppPreviewUrl from '../assets/install-app-preview.jpg';
import './PostLoginInstallModal.css';

export function PostLoginInstallModal({
  isOpen,
  mode = 'install-native',
  browserGuide = null,
  onInstall,
  onClose,
}) {
  const titleId = useId();
  const dialogRef = useRef(null);
  const clearTimerRef = useRef(null);
  const [rendered, setRendered] = useState(isOpen);
  const [step, setStep] = useState('invite');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const guide = getInstallGuideContent(browserGuide);

  const handleCloseRequest = useCallback(async () => {
    if (busy) return;
    await closeAnimatedDialog(dialogRef.current, false);
  }, [busy]);

  useBackLayer('post-login-install-modal', isOpen, () => {
    if (!busy) onClose?.();
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    dialog.setAttribute('closedby', 'any');
    return attachDialogOutsideFallback(dialog, () => busy, () => handleCloseRequest());
  }, [busy, handleCloseRequest]);

  useEffect(() => () => {
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
  }, []);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      if (clearTimerRef.current) {
        clearTimeout(clearTimerRef.current);
        clearTimerRef.current = null;
      }
      setRendered(true);
      setStep('invite');
      setNotice('');
      setBusy(false);
      dialog.removeAttribute('data-closing');
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      closeAnimatedDialog(dialog, false);
      clearTimerRef.current = setTimeout(() => {
        setRendered(false);
        clearTimerRef.current = null;
      }, 280);
    } else {
      clearTimerRef.current = setTimeout(() => {
        setRendered(false);
        clearTimerRef.current = null;
      }, 280);
    }
  }, [isOpen]);

  const handleInstallAction = async () => {
    if (busy) return;
    if (mode === 'install-manual' && guide) {
      setStep('guide');
      return;
    }

    setBusy(true);
    setNotice('');
    try {
      const outcome = await onInstall?.();
      if (outcome === 'accepted') {
        await closeAnimatedDialog(dialogRef.current, false);
      } else if (outcome === 'dismissed') {
        await handleCloseRequest();
      } else if (guide) {
        setStep('guide');
      } else if (!window.isSecureContext) {
        setNotice('prévia de staging: a instalação automática ativa em https.');
      } else {
        setNotice('toque no menu do navegador e escolha "adicionar à tela inicial".');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="post-login-install-dialog"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) handleCloseRequest();
      }}
      onClose={() => {
        if (dialogRef.current) dialogRef.current.returnValue = '';
        if (isOpen) {
          onClose?.();
        }
      }}
    >
      {rendered && (
        <div className="post-login-install-dialog__surface" data-step={step}>
          {step === 'guide' && guide ? (
            <div className="post-login-install-dialog__body post-login-install-dialog__body--guide" key="guide">
              <h2 id={titleId}>{guide.title}</h2>
              <ol className="post-login-install-dialog__steps">
                {guide.steps.map((text, index) => (
                  <li key={text}>
                    <span className="post-login-install-dialog__step-num" aria-hidden="true">
                      {index + 1}
                    </span>
                    <span>{text}</span>
                  </li>
                ))}
              </ol>
              <div className="post-login-install-dialog__actions">
                <button
                  type="button"
                  className="post-login-install-dialog__primary"
                  onClick={() => handleCloseRequest()}
                >
                  entendi
                </button>
              </div>
            </div>
          ) : (
            <div className="post-login-install-dialog__body post-login-install-dialog__body--invite" key="invite">
              <div className="post-login-install-dialog__preview">
                <img
                  src={installAppPreviewUrl}
                  alt="Prévia do ícone DiviDinDin! na tela inicial do celular"
                  className="post-login-install-dialog__preview-img"
                  width="512"
                  height="512"
                  decoding="async"
                />
              </div>

              <h2 id={titleId}>instale o DiviDinDin!</h2>
              <p className="post-login-install-dialog__subtitle">
                tenha acesso rápido direto da tela inicial do celular, como um app.
              </p>

              {notice && (
                <p className="post-login-install-dialog__notice" role="status" aria-live="polite">
                  {notice}
                </p>
              )}

              <div className="post-login-install-dialog__actions">
                <button
                  type="button"
                  className="post-login-install-dialog__primary"
                  disabled={busy}
                  onClick={handleInstallAction}
                >
                  <Download size={17} aria-hidden="true" />
                  {busy ? 'instalando...' : 'instalar'}
                </button>
                <button
                  type="button"
                  className="post-login-install-dialog__later"
                  disabled={busy}
                  onClick={() => handleCloseRequest()}
                >
                  deixar para depois
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </dialog>
  );
}
