import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { getInstallGuideContent } from '../../domain/pwa.js';
import { attachDialogOutsideFallback, closeAnimatedDialog } from '../lib/dialogTopLayer.js';
import { useBackLayer } from '../lib/useHistoryNavigation.js';
import './InstallGuideModal.css';

export function InstallGuideModal({ isOpen, browserGuide, onClose }) {
  const dialogRef = useRef(null);
  const guide = getInstallGuideContent(browserGuide);

  useBackLayer('install-guide-modal', Boolean(isOpen && guide), () => onClose?.(), { priority: 30 });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    dialog.setAttribute('closedby', 'any');
    return attachDialogOutsideFallback(
      dialog,
      () => false,
      () => closeAnimatedDialog(dialog, false)
    );
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && guide) {
      dialog.removeAttribute('data-closing');
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      closeAnimatedDialog(dialog, false);
    }
  }, [isOpen, guide]);

  if (!guide) return null;

  return (
    <dialog
      ref={dialogRef}
      className="install-guide-dialog"
      aria-labelledby="install-guide-title"
      onClose={() => {
        if (dialogRef.current) dialogRef.current.returnValue = '';
        if (isOpen) onClose?.();
      }}
    >
      <header className="install-guide-dialog__header">
        <h2 id="install-guide-title">{guide.title}</h2>
        <button
          type="button"
          className="install-guide-dialog__close"
          onClick={() => closeAnimatedDialog(dialogRef.current, false)}
          aria-label="Fechar"
        >
          <X size={20} aria-hidden="true" />
        </button>
      </header>

      <ol className="install-guide-dialog__steps">
        {guide.steps.map((step, index) => (
          <li key={step}>
            <span className="install-guide-dialog__num" aria-hidden="true">{index + 1}</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>

      <button
        type="button"
        className="install-guide-dialog__done"
        onClick={() => closeAnimatedDialog(dialogRef.current, false)}
      >
        entendi
      </button>
    </dialog>
  );
}
