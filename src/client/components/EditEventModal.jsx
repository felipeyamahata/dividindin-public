import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useBackLayer } from '../lib/useHistoryNavigation.js';
import './EditEventModal.css';

function isOutsideRect(e, el) {
  const rect = el.getBoundingClientRect();
  return e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom;
}

export function EditEventModal({ isOpen, event, onClose, onSave }) {
  const dialogRef = useRef(null);
  const pressedOutsideRef = useRef(false);
  const [title, setTitle] = useState(event?.title || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.setAttribute('closedby', 'any');
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen) {
      setTitle(event?.title || '');
      setError('');
      setBusy(false);
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [isOpen, event?.id, event?.title]);

  const handleClose = () => {
    if (busy) return;
    onClose();
  };

  useBackLayer('edit-event-modal', isOpen, handleClose);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      setError('informe o nome do evento');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onSave(trimmed);
      onClose();
    } catch (err) {
      setError(err.message || 'não foi possível atualizar o evento');
    } finally {
      setBusy(false);
    }
  };

  // Fallback for browsers without native <dialog closedby="any"> light-dismiss (e.g. Safari)
  const handlePointerDown = (e) => {
    if ('closedBy' in HTMLDialogElement.prototype || !dialogRef.current) return;
    pressedOutsideRef.current = isOutsideRect(e, dialogRef.current);
  };

  const handlePointerUp = (e) => {
    if ('closedBy' in HTMLDialogElement.prototype || !dialogRef.current) return;
    const releasedOutside = pressedOutsideRef.current && isOutsideRect(e, dialogRef.current);
    pressedOutsideRef.current = false;
    if (releasedOutside && !busy) onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      className="edit-event-dialog"
      aria-labelledby="edit-event-title"
      onCancel={(e) => {
        if (busy) { e.preventDefault(); return; }
      }}
      onClose={() => {
        if (dialogRef.current) dialogRef.current.returnValue = '';
        if (isOpen) onClose();
      }}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
    >
      <header className="edit-event-dialog__header">
        <h2 id="edit-event-title">editar evento</h2>
        <button type="button" onClick={handleClose} disabled={busy} className="edit-event-dialog__close" aria-label="Fechar">
          <X size={20} aria-hidden="true" />
        </button>
      </header>
      {error && <p className="edit-event-dialog__error" role="alert">{error}</p>}
      <form onSubmit={handleSubmit} className="edit-event-dialog__form">
        <label>
          nome do evento
          <input
            type="text"
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="ex: viagem, churrasco, apê"
            autoFocus
            required
          />
        </label>
        <div className="edit-event-dialog__actions">
          <button type="button" onClick={handleClose} disabled={busy} className="edit-event-dialog__cancel">
            cancelar
          </button>
          <button type="submit" disabled={busy || !title.trim()} className="edit-event-dialog__save">
            {busy ? 'salvando...' : 'salvar'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
