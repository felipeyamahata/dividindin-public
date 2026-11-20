import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy, Share2, X } from 'lucide-react';
import { buildInviteSharePayload } from '../../domain/invite.js';
import {
  attachDialogOutsideFallback,
  closeAnimatedDialog,
  copyTextToClipboard,
} from '../lib/dialogTopLayer.js';
import { useBackLayer } from '../lib/useHistoryNavigation.js';
import './InviteDialog.css';

export function InviteDialog({ isOpen = true, event, onClose }) {
  const dialogRef = useRef(null);
  const inputRef = useRef(null);
  const statusTimerRef = useRef(null);
  const lastAnnouncementRef = useRef('');
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState('');

  useBackLayer('invite-dialog', isOpen, () => onClose?.());

  const share = buildInviteSharePayload({
    eventTitle: event?.title,
    origin: typeof window !== 'undefined' ? window.location.origin : '',
    pathname: typeof window !== 'undefined' ? window.location.pathname : '',
    eventCode: event?.code,
  });

  const announce = (message, persistCopied = false) => {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    const nextMessage = message === lastAnnouncementRef.current ? `${message}\u00A0` : message;
    lastAnnouncementRef.current = message;
    setCopied(persistCopied);
    setStatus(nextMessage);
    statusTimerRef.current = setTimeout(() => {
      setCopied(false);
      setStatus('');
      statusTimerRef.current = null;
    }, 2500);
  };

  useEffect(() => () => {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
  }, []);

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
    if (isOpen) {
      dialog.removeAttribute('data-closing');
      setCopied(false);
      setStatus('');
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      closeAnimatedDialog(dialog, false);
    }
  }, [isOpen, event?.code]);

  async function handleCopy() {
    if (await copyTextToClipboard(share.url, dialogRef.current)) {
      announce('link copiado!', true);
      return;
    }
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.select();
    announce('selecione e copie o link acima.');
  }

  async function handleShare() {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: share.title,
          text: share.text,
          url: share.url,
        });
        announce('convite compartilhado!');
        return;
      } catch (err) {
        if (err?.name === 'AbortError') return;
      }
    }
    const insecureHttp = typeof window !== 'undefined' && window.isSecureContext === false;
    if (await copyTextToClipboard(share.shareMessage, dialogRef.current)) {
      announce(
        insecureHttp
          ? 'mensagem e link copiados! (share nativo requer HTTPS)'
          : 'mensagem e link copiados!'
      );
      return;
    }
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.select();
    announce(
      insecureHttp
        ? 'share nativo e cópia automática exigem HTTPS.'
        : 'selecione e copie o link acima.'
    );
  }

  return (
    <dialog
      ref={dialogRef}
      className="invite-dialog"
      aria-labelledby="invite-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        closeAnimatedDialog(dialogRef.current, false);
      }}
      onClose={() => {
        if (dialogRef.current) {
          dialogRef.current.removeAttribute('data-closing');
          dialogRef.current.returnValue = '';
        }
        if (isOpen) onClose();
      }}
    >
      <header className="invite-dialog__header">
        <h2 id="invite-dialog-title">convidar participantes</h2>
        <button
          type="button"
          className="invite-dialog__close"
          aria-label="Fechar"
          onClick={() => closeAnimatedDialog(dialogRef.current, false)}
        >
          <X size={20} aria-hidden="true" />
        </button>
      </header>
      <label htmlFor="invite-link">link de convite</label>
      <input
        ref={inputRef}
        id="invite-link"
        readOnly
        value={share.url}
        onClick={(e) => e.currentTarget.select()}
      />
      <div className="invite-dialog__actions">
        <button type="button" className="invite-dialog__copy" onClick={handleCopy}>
          {copied ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
          {copied ? 'link copiado' : 'copiar link'}
        </button>
        <button type="button" className="invite-dialog__share" onClick={handleShare}>
          <Share2 size={18} aria-hidden="true" />
          compartilhar
        </button>
      </div>
      <p className={`invite-dialog__status${status ? ' is-visible' : ''}`} role="status">
        {status}
      </p>
    </dialog>
  );
}
