import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { attachDialogOutsideFallback, closeAnimatedDialog } from '../lib/dialogTopLayer.js';
import { useBackLayer } from '../lib/useHistoryNavigation.js';
import { formatCurrency } from '../lib/format.js';
import { ParticipantAvatar } from './ParticipantAvatars.jsx';
import { ParticipantName } from './ParticipantName.jsx';
import './RemoveParticipantModal.css';

export function RemoveParticipantModal({
  isOpen,
  participant,
  remainingParticipants = [],
  defaultReplacementPayerId = '',
  preview = null,
  loadingPreview = false,
  onClose,
  onConfirm,
}) {
  const dialogRef = useRef(null);
  const busyRef = useRef(false);
  const [replacementPayerId, setReplacementPayerId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  busyRef.current = busy;

  useBackLayer('remove-participant-modal', isOpen, () => {
    if (!busyRef.current) onClose?.();
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.setAttribute('closedby', busy ? 'none' : 'any');
  }, [busy]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    return attachDialogOutsideFallback(
      dialog,
      () => busyRef.current,
      () => closeAnimatedDialog(dialog, busyRef.current),
    );
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen) {
      dialog.removeAttribute('data-closing');
      setError('');
      setBusy(false);
      setReplacementPayerId(defaultReplacementPayerId || remainingParticipants[0]?.id || '');
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      closeAnimatedDialog(dialog, false);
    }
  }, [isOpen, defaultReplacementPayerId, remainingParticipants]);

  const requestClose = () => {
    closeAnimatedDialog(dialogRef.current, busy);
  };

  const needsReplacement = Boolean(preview?.paidExpensesCount > 0);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (busy || loadingPreview) return;
    if (needsReplacement && !replacementPayerId) {
      setError('Escolha quem assumirá as despesas pagas.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      await onConfirm(participant.id, needsReplacement ? replacementPayerId : null);
      await closeAnimatedDialog(dialogRef.current, false);
    } catch (err) {
      setError(err.message || 'Não foi possível remover o participante.');
      setBusy(false);
      return;
    }
    setBusy(false);
  };

  return (
    <dialog
      ref={dialogRef}
      className="remove-participant-dialog"
      aria-labelledby="remove-participant-title"
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
      <header className="remove-participant-dialog__header">
        <h2 id="remove-participant-title">remover participante</h2>
        <button
          type="button"
          onClick={requestClose}
          disabled={busy}
          className="remove-participant-dialog__close"
          aria-label="Fechar"
        >
          <X size={20} aria-hidden="true" />
        </button>
      </header>

      {participant && (
        <div className="remove-participant-dialog__target">
          <ParticipantAvatar participant={participant} className="remove-participant-dialog__avatar" />
          <div className="remove-participant-dialog__target-info">
            <strong><ParticipantName participant={participant} /></strong>
            <span>{participant.user_id ? 'conta vinculada' : 'participante genérico'}</span>
          </div>
        </div>
      )}

      {loadingPreview ? (
        <p className="remove-participant-dialog__loading">calculando impacto nos lançamentos...</p>
      ) : preview && (
        <ul className="remove-participant-dialog__summary">
          <li>
            <span>despesas redistribuídas igualmente</span>
            <strong>{preview.redistributedExpensesCount + preview.equalAllExpensesCount}</strong>
          </li>
          {preview.orphanExpensesCount > 0 && (
            <li className="remove-participant-dialog__warn">
              <span>despesas exclusivas removidas</span>
              <strong>{preview.orphanExpensesCount}</strong>
            </li>
          )}
          {preview.settlementsCount > 0 && (
            <li className="remove-participant-dialog__warn">
              <span>pagamentos estornados</span>
              <strong>{preview.settlementsCount} ({formatCurrency(preview.settlementsTotal)})</strong>
            </li>
          )}
        </ul>
      )}

      <form onSubmit={handleSubmit} className="remove-participant-dialog__form">
        {needsReplacement && (
          <label className="remove-participant-dialog__select-wrap">
            <span>
              <AlertTriangle size={14} aria-hidden="true" />
              pagou {preview.paidExpensesCount} {preview.paidExpensesCount === 1 ? 'despesa' : 'despesas'} ({formatCurrency(preview.paidExpensesTotal)}). quem assume?
            </span>
            <select
              value={replacementPayerId}
              onChange={(e) => setReplacementPayerId(e.target.value)}
              disabled={busy}
            >
              {remainingParticipants.map(person => (
                <option key={person.id} value={person.id}>
                  {person.name}{!person.user_id ? ' (genérico)' : ''}
                </option>
              ))}
            </select>
          </label>
        )}

        {error && (
          <p className="remove-participant-dialog__error" role="alert">
            {error}
          </p>
        )}

        <div className="remove-participant-dialog__actions">
          <button
            type="button"
            onClick={requestClose}
            disabled={busy}
            className="remove-participant-dialog__cancel"
          >
            cancelar
          </button>
          <button
            type="submit"
            disabled={busy || loadingPreview}
            className="remove-participant-dialog__confirm"
          >
            {busy ? 'removendo...' : 'remover participante'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
