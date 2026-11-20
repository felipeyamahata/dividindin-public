import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { attachDialogOutsideFallback, closeAnimatedDialog } from '../lib/dialogTopLayer.js';
import { useBackLayer } from '../lib/useHistoryNavigation.js';
import './AddParticipantModal.css';

export function AddParticipantModal({ isOpen, onClose, onAdd }) {
  const dialogRef = useRef(null);
  const inputRef = useRef(null);
  const busyRef = useRef(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  busyRef.current = busy;

  useBackLayer('add-participant-modal', isOpen, () => {
    if (!busyRef.current) onClose?.();
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    dialog.setAttribute('closedby', busy ? 'none' : 'any');
    return undefined;
  }, [busy]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    return attachDialogOutsideFallback(
      dialog,
      () => busyRef.current,
      () => closeAnimatedDialog(dialog, busyRef.current)
    );
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen) {
      dialog.removeAttribute('data-closing');
      setName('');
      setError('');
      setBusy(false);
      if (!dialog.open) {
        dialog.showModal();
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    } else if (dialog.open) {
      closeAnimatedDialog(dialog, false);
    }
  }, [isOpen]);

  const requestClose = () => {
    closeAnimatedDialog(dialogRef.current, busy);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setError('');
    setBusy(true);
    try {
      await onAdd(trimmed);
      await closeAnimatedDialog(dialogRef.current, false);
    } catch (err) {
      setError(err.message || 'não foi possível adicionar participante.');
      setBusy(false);
      return;
    }
    setBusy(false);
  };

  return (
    <dialog
      ref={dialogRef}
      className="add-participant-dialog"
      aria-labelledby="add-participant-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) closeAnimatedDialog(dialogRef.current, false);
      }}
      onClose={() => {
        if (dialogRef.current) {
          dialogRef.current.removeAttribute('data-closing');
          dialogRef.current.returnValue = '';
        }
        if (isOpen) onClose();
      }}
    >
      <header className="add-participant-dialog__header">
        <h2 id="add-participant-title">adicionar participante</h2>
        <button
          type="button"
          onClick={requestClose}
          disabled={busy}
          className="add-participant-dialog__close"
          aria-label="Fechar"
        >
          <X size={20} aria-hidden="true" />
        </button>
      </header>
      {error && (
        <p className="add-participant-dialog__error" role="alert">
          {error}
        </p>
      )}
      <form onSubmit={handleSubmit} className="add-participant-dialog__form">
        <label htmlFor="participant-name-modal">
          nome do participante
          <input
            ref={inputRef}
            id="participant-name-modal"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            autoFocus
            disabled={busy}
            placeholder="ex: carlos, bia, rodrigo"
          />
        </label>
        <div className="add-participant-dialog__actions">
          <button
            type="button"
            onClick={requestClose}
            disabled={busy}
            className="add-participant-dialog__cancel"
          >
            cancelar
          </button>
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="add-participant-dialog__submit"
          >
            {busy ? 'adicionando...' : 'adicionar'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
