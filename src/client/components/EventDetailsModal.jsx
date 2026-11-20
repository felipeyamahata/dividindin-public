import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUpRight, Crown, Receipt, Users, X } from 'lucide-react';
import { computeMorphDelta } from '../../domain/eventMenu.js';
import { attachDialogOutsideFallback, closeAnimatedDialog } from '../lib/dialogTopLayer.js';
import { useBackLayer } from '../lib/useHistoryNavigation.js';
import { formatCurrency, formatReceiptDateTime } from '../lib/format.js';
import { ParticipantAvatar } from './ParticipantAvatars.jsx';
import { ParticipantName } from './ParticipantName.jsx';
import './EventDetailsModal.css';

function applyMorphVars(dialog, { dx, dy, sx, sy }) {
  if (!dialog) return;
  dialog.style.setProperty('--morph-dx', `${dx}px`);
  dialog.style.setProperty('--morph-dy', `${dy}px`);
  dialog.style.setProperty('--morph-sx', String(sx));
  dialog.style.setProperty('--morph-sy', String(sy));
}

export function EventDetailsModal({ isOpen, event, getOriginRect, currentUser, onClose, onOpenEvent }) {
  const titleId = useId();
  const dialogRef = useRef(null);
  const viewportRef = useRef(null);
  const clearTimerRef = useRef(null);
  const [renderedEvent, setRenderedEvent] = useState(event || null);
  const [fade, setFade] = useState({ top: false, bottom: false });

  const updateFade = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    setFade({
      top: el.scrollTop > 1,
      bottom: el.scrollTop + el.clientHeight < el.scrollHeight - 1,
    });
  }, []);

  const syncOriginMorph = useCallback(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const originRect = getOriginRect?.();
    const targetRect = dialog.getBoundingClientRect();
    applyMorphVars(dialog, computeMorphDelta({ originRect, targetRect }));
  }, [getOriginRect]);

  const requestClose = useCallback(() => {
    syncOriginMorph();
    closeAnimatedDialog(dialogRef.current);
  }, [syncOriginMorph]);

  useBackLayer('event-details-modal', Boolean(isOpen && event), () => {
    onClose?.();
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    dialog.setAttribute('closedby', 'any');
    return attachDialogOutsideFallback(dialog, () => false, requestClose);
  }, [requestClose]);

  useEffect(() => () => {
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
  }, []);

  useEffect(() => {
    if (isOpen && event) {
      if (clearTimerRef.current) {
        clearTimeout(clearTimerRef.current);
        clearTimerRef.current = null;
      }
      setRenderedEvent(event);
    } else if (!isOpen) {
      clearTimerRef.current = setTimeout(() => {
        setRenderedEvent(null);
        clearTimerRef.current = null;
      }, 340);
    }
  }, [isOpen, event]);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && event) {
      dialog.removeAttribute('data-closing');
      if (!dialog.open) dialog.showModal();
      syncOriginMorph();
      if (viewportRef.current) viewportRef.current.scrollTop = 0;
      requestAnimationFrame(updateFade);
    } else if (dialog.open) {
      syncOriginMorph();
      closeAnimatedDialog(dialog);
    }
  }, [isOpen, event, syncOriginMorph, updateFade]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el || !isOpen) return undefined;
    const observer = new ResizeObserver(updateFade);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    updateFade();
    return () => observer.disconnect();
  }, [isOpen, renderedEvent?.participants?.length, updateFade]);

  const displayEvent = isOpen && event ? event : renderedEvent;
  const participants = displayEvent?.participants || [];
  const expenseCount = Number(displayEvent?.expense_count || 0);
  const createdLabel = displayEvent?.created_at ? formatReceiptDateTime(displayEvent.created_at) : '';
  const hasBalance = typeof displayEvent?.user_balance === 'number';
  const balanceDebit = hasBalance && displayEvent.user_balance < 0;
  const balanceZero = hasBalance && displayEvent.user_balance === 0;

  return (
    <dialog
      ref={dialogRef}
      className="event-details-dialog"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        requestClose();
      }}
      onClose={() => {
        if (dialogRef.current) dialogRef.current.returnValue = '';
        if (isOpen) onClose();
      }}
    >
      {displayEvent && (
        <>
          <header className="event-details-dialog__header">
            <div className="event-details-dialog__title-block">
              <h2 id={titleId} title={displayEvent.title}>{displayEvent.title}</h2>
              {createdLabel && (
                <span className="event-details-dialog__date">
                  criado em {createdLabel}
                </span>
              )}
            </div>
            <button
              type="button"
              className="event-details-dialog__close"
              onClick={requestClose}
              aria-label="Fechar"
            >
              <X size={20} aria-hidden="true" />
            </button>
          </header>

          <section className="event-details-dialog__summary-card" aria-label="Resumo financeiro do evento">
            <div className="event-details-dialog__kpis">
              <div className={`event-details-dialog__kpi${balanceDebit ? ' event-details-dialog__kpi--debit' : ''}`}>
                <span>
                  {!hasBalance
                    ? 'seu saldo'
                    : balanceZero
                      ? 'tudo certo'
                      : displayEvent.user_balance > 0
                        ? 'você recebe'
                        : 'você deve'}
                </span>
                <strong>{hasBalance ? formatCurrency(Math.abs(displayEvent.user_balance)) : '—'}</strong>
              </div>
              <div className="event-details-dialog__kpi event-details-dialog__kpi--right">
                <span>total gasto</span>
                <strong>{formatCurrency(displayEvent.total_expenses || 0)}</strong>
              </div>
            </div>

            <div className="event-details-dialog__stats">
              <span>
                <Users size={13} aria-hidden="true" />
                {participants.length} {participants.length === 1 ? 'participante' : 'participantes'}
              </span>
              <span>
                <Receipt size={13} aria-hidden="true" />
                {expenseCount} {expenseCount === 1 ? 'lançamento' : 'lançamentos'}
              </span>
            </div>

            {displayEvent.description?.trim() && (
              <p className="event-details-dialog__description">{displayEvent.description.trim()}</p>
            )}

            <div className="event-details-dialog__latest">
              {displayEvent.latest_expense_description ? (
                <>
                  <span className="event-details-dialog__latest-caption">último lançamento</span>
                  <div className="event-details-dialog__latest-row">
                    <span>{displayEvent.latest_expense_description}</span>
                    <strong>{formatCurrency(displayEvent.latest_expense_amount || 0)}</strong>
                  </div>
                </>
              ) : (
                <span className="event-details-dialog__latest-caption">nenhum lançamento ainda</span>
              )}
            </div>
          </section>

          <div className="event-details-dialog__people-head">
            <h3>participantes</h3>
            <span>{participants.length}</span>
          </div>

          <div
            ref={viewportRef}
            onScroll={updateFade}
            tabIndex={0}
            aria-label="Lista detalhada de participantes"
            className={`event-details-dialog__people-viewport${fade.top ? ' event-details-dialog__people-viewport--top' : ''}${fade.bottom ? ' event-details-dialog__people-viewport--bottom' : ''}`}
          >
            {participants.length ? (
              <ul className="event-details-dialog__people-list">
                {participants.map((person) => {
                  const isPersonCreator = Boolean(person.user_id && displayEvent.created_by && person.user_id === displayEvent.created_by);
                  const isMe = Boolean(person.user_id && currentUser?.id && person.user_id === currentUser.id);
                  const isPlaceholder = !person.user_id;
                  return (
                    <li key={person.id} className="event-details-dialog__person">
                      <ParticipantAvatar participant={person} className="event-details-dialog__avatar" />
                      <span className="event-details-dialog__person-name" title={person.name}>
                        <ParticipantName participant={person} />
                      </span>
                      <span className="event-details-dialog__badges">
                        {isPersonCreator && (
                          <span className="event-details-dialog__badge event-details-dialog__badge--admin">
                            <Crown size={10} aria-hidden="true" /> admin
                          </span>
                        )}
                        {isMe && <span className="event-details-dialog__badge">você</span>}
                        {isPlaceholder && (
                          <span className="event-details-dialog__badge event-details-dialog__badge--muted">
                            sem conta
                          </span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="event-details-dialog__empty-people">nenhum participante registrado.</p>
            )}
          </div>

          <footer className="event-details-dialog__footer">
            <button
              type="button"
              className="event-details-dialog__open-btn"
              onClick={async () => {
                applyMorphVars(dialogRef.current, { dx: 0, dy: 8, sx: 0.97, sy: 0.97 });
                await closeAnimatedDialog(dialogRef.current);
                onOpenEvent(displayEvent);
              }}
            >
              abrir evento <ArrowUpRight size={17} aria-hidden="true" />
            </button>
          </footer>
        </>
      )}
    </dialog>
  );
}
