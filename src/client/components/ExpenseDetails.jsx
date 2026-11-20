import React, { useMemo, useState } from 'react';
import { ArrowRight, Check, ChevronDown, Pencil, Trash2 } from 'lucide-react';
import { calculateBalances } from '../../domain/settlement.js';
import { computeSettlementAttribution } from '../../domain/settlementAttribution.js';
import { formatCurrency, formatDate, formatReceiptDateTime } from '../lib/format.js';
import { ParticipantAvatar } from './ParticipantAvatars.jsx';
import { ParticipantName } from './ParticipantName.jsx';
import { SmoothTextSwap } from './SmoothTextSwap.jsx';
import './ExpenseDetails.css';
import { requestConfirmation } from './ConfirmDialog.jsx';

export function ExpenseDetails({ expense, participants, user, revealState = 'idle' }) {
  const payer = participants.find(person => person.id === expense.payer_id);
  const creator = participants.find(person => person.user_id && person.user_id === expense.created_by);
  const isOwn = Boolean(user && payer?.user_id === user.id);
  const allocations = calculateBalances(participants, [expense]);
  const included = expense.split_mode === 'EQUAL_ALL' ? participants : participants.filter(person => expense.splits?.some(split => split.participant_id === person.id));
  const receiptDate = formatReceiptDateTime(expense.created_at);
  const fullDate = expense.created_at
    ? new Date(expense.created_at).toLocaleString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '';
  const stateClass = revealState === 'awaiting'
    ? ' expense-detail--awaiting'
    : revealState === 'revealing'
      ? ' expense-detail--revealing'
      : '';
  return <>
    <div className={`expense-detail expense-detail--${isOwn ? 'own' : 'paper'}${stateClass}`}>
      <div className="expense-detail__total" style={{ '--receipt-step': 0 }}>
        <div className="expense-detail__total-head">
          <span>valor do lançamento</span>
          {receiptDate && (
            <time className="expense-detail__date" dateTime={expense.created_at} title={fullDate}>
              {receiptDate}
            </time>
          )}
        </div>
        <strong>{formatCurrency(expense.amount)}</strong>
      </div>
      <div className="expense-detail__meta" style={{ '--receipt-step': 1 }} aria-label="Informações do lançamento">
        <span className="expense-detail__meta-item">pago por <strong><ParticipantName participant={payer || { name: expense.payer_name }} isGeneric={!payer?.user_id} /></strong></span>
        {creator && creator.user_id !== payer?.user_id && (
          <span className="expense-detail__meta-item expense-detail__meta-item--secondary">lançado por <strong><SmoothTextSwap text={creator.name} /></strong></span>
        )}
      </div>
      <h2 style={{ '--receipt-step': 2 }}>dividido entre</h2>
      <section className="expense-detail__card expense-detail__people" style={{ '--receipt-step': 3 }} aria-label="Divisão do lançamento">
        {included.map((person, index) => <div className="expense-detail__person" key={person.id} style={{ '--person-step': Math.min(index, 10) }}><ParticipantAvatar participant={person} className="expense-feed__avatar" /><span><ParticipantName participant={person} suffix={person.user_id === user?.id ? ' (você)' : ''} /></span><strong>{formatCurrency(allocations.get(person.id)?.totalConsumed || 0)}</strong></div>)}
      </section>
    </div>
  </>;
}

export function ExpenseDetailActions({ expense, onEdit, onDelete }) {
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  async function remove() {
    if (!await requestConfirmation(`Excluir “${expense.description}”? Essa ação não pode ser desfeita.`, 'excluir')) return;
    setDeleting(true); setError('');
    try { await onDelete(expense.id); } catch (err) { setError(err.message || 'não foi possível excluir o lançamento.'); setDeleting(false); }
  }
  return <div className="expense-detail__action-area">{error && <p className="expense-detail__error" role="alert">{error}</p>}<div className="expense-detail__actions"><button type="button" className="expense-detail__delete" disabled={deleting} onClick={remove}><Trash2 size={18}/> excluir</button><button type="button" className="expense-detail__edit" disabled={deleting} onClick={() => onEdit(expense)}><Pencil size={18}/> editar lançamento</button></div></div>;
}

function SettlementProgressBar({ settledCents, totalCents }) {
  const safeTotal = Math.max(0, totalCents || 0);
  const safeSettled = Math.max(0, Math.min(safeTotal, settledCents || 0));
  const pct = safeTotal > 0 ? Math.min(100, Math.max(0, (safeSettled / safeTotal) * 100)) : 0;
  const label = formatCurrency(safeSettled);

  return (
    <div
      className="expense-detail__progress"
      style={{ '--progress': `${pct.toFixed(2)}%` }}
      role="progressbar"
      aria-valuenow={safeSettled}
      aria-valuemin={0}
      aria-valuemax={safeTotal}
      aria-label={`${label} quitados de ${formatCurrency(safeTotal)}`}
    >
      <span className="expense-detail__progress-track" aria-hidden="true">
        {label}
      </span>
      <span className="expense-detail__progress-fill" aria-hidden="true">
        {label}
      </span>
    </div>
  );
}

function getItemStatusLabel(item) {
  switch (item.status) {
    case 'settled_now':
      return 'quitado';
    case 'settled_prior':
      return 'quitado antes';
    case 'compensated':
      return 'compensado';
    case 'partial_now':
      return `quitou ${formatCurrency(item.settledNowCents)} · faltam ${formatCurrency(item.remainingAfterCents)}`;
    case 'partial_prior':
      return `faltam ${formatCurrency(item.remainingAfterCents)}`;
    default:
      return 'em aberto';
  }
}

function ActorName({ participant, isOwn }) {
  if (isOwn) return 'você';
  return <ParticipantName participant={participant} />;
}

function CompensationAccordion({
  details,
  fromParticipant,
  toParticipant,
  isFromOwn,
  isToOwn,
  mutualOffsetCents,
  stepIndex,
}) {
  const [expanded, setExpanded] = useState(false);
  const creditOffsetCents = (details?.directCounterSubtotalCents || 0) + (details?.groupSubtotalCents || 0);
  const hasRedirectionOffset = (details?.adjustmentCents || 0) > 0;
  const hasCreditOffset = creditOffsetCents > 0;

  return (
    <div
      className="expense-detail__offset-wrap"
      style={{ '--person-step': Math.min(stepIndex, 10) }}
    >
      <button
        type="button"
        className="expense-detail__accordion-trigger expense-detail__offset"
        aria-expanded={expanded}
        onClick={() => setExpanded(prev => !prev)}
      >
        <div className="expense-detail__item-main">
          <span className="expense-detail__offset-label">compensação mútua / outras pessoas</span>
          <span className="expense-detail__item-sub">
            <span>{expanded ? 'ocultar resumo' : 'ver resumo'}</span>
          </span>
        </div>
        <span className="expense-detail__accordion-right">
          <strong>-{formatCurrency(mutualOffsetCents)}</strong>
          <ChevronDown
            size={15}
            className={`expense-detail__chevron${expanded ? ' is-open' : ''}`}
            aria-hidden="true"
          />
        </span>
      </button>

      {expanded && details && (
        <div className="expense-detail__accordion-body">
          <div className="expense-detail__equation expense-detail__equation--plain">
            {details.directCounterSubtotalCents !== 0 && (
              <div>
                <span>
                  {details.directCounterSubtotalCents > 0 ? (
                    isFromOwn ? (
                      <>
                        o que <ActorName participant={toParticipant} isOwn={false} /> te devia
                      </>
                    ) : (
                      <>
                        o que <ActorName participant={toParticipant} isOwn={isToOwn} /> devia a{' '}
                        <ActorName participant={fromParticipant} isOwn={false} />
                      </>
                    )
                  ) : isFromOwn ? (
                    <>
                      o que você já recebeu de <ActorName participant={toParticipant} isOwn={false} />
                    </>
                  ) : (
                    <>
                      o que <ActorName participant={fromParticipant} isOwn={false} /> já recebeu de{' '}
                      <ActorName participant={toParticipant} isOwn={isToOwn} />
                    </>
                  )}
                </span>
                <strong>
                  {details.directCounterSubtotalCents > 0
                    ? formatCurrency(details.directCounterSubtotalCents)
                    : `-${formatCurrency(Math.abs(details.directCounterSubtotalCents))}`}
                </strong>
              </div>
            )}

            {details.groupSubtotalCents !== 0 && (
              <div>
                <span>
                  {details.groupSubtotalCents > 0 ? (
                    isFromOwn ? (
                      'o que outras pessoas te deviam'
                    ) : (
                      <>
                        o que outras pessoas deviam a <ActorName participant={fromParticipant} isOwn={false} />
                      </>
                    )
                  ) : isFromOwn ? (
                    'o que você devia a outras pessoas'
                  ) : (
                    <>
                      o que <ActorName participant={fromParticipant} isOwn={false} /> devia a outras pessoas
                    </>
                  )}
                </span>
                <strong>
                  {details.groupSubtotalCents > 0
                    ? formatCurrency(details.groupSubtotalCents)
                    : `-${formatCurrency(Math.abs(details.groupSubtotalCents))}`}
                </strong>
              </div>
            )}

            {details.adjustmentCents !== 0 && (
              <div>
                <span>
                  {details.adjustmentCents < 0
                    ? 'excedente mantido em outros acertos'
                    : 'redirecionado a outro credor'}
                </span>
                <strong>
                  {details.adjustmentCents > 0
                    ? formatCurrency(details.adjustmentCents)
                    : `-${formatCurrency(Math.abs(details.adjustmentCents))}`}
                </strong>
              </div>
            )}

            <div className="expense-detail__equation-total expense-detail__equation-split">
              <span>total abatido das despesas acima</span>
              <strong>{formatCurrency(details.mutualOffsetCents)}</strong>
            </div>
          </div>

          <p className="expense-detail__accordion-caption">
            {hasRedirectionOffset && !hasCreditOffset ? (
              <>
                {isToOwn ? 'Você' : <ActorName participant={toParticipant} isOwn={false} />} já tinha acertos
                previstos com outras pessoas. Para evitar transferências em cadeia, esses{' '}
                <strong>{formatCurrency(details.mutualOffsetCents)}</strong> das despesas acima foram
                redirecionados para outro credor antes deste pagamento.
              </>
            ) : hasRedirectionOffset && hasCreditOffset ? (
              <>
                Dos <strong>{formatCurrency(details.mutualOffsetCents)}</strong> abatidos acima,{' '}
                <strong>{formatCurrency(creditOffsetCents)}</strong> eram créditos que{' '}
                {isFromOwn ? 'você tinha' : <><ActorName participant={fromParticipant} isOwn={false} /> tinha</>} a
                receber e <strong>{formatCurrency(details.adjustmentCents)}</strong> foram redirecionados para
                outro credor
                {details.debtBeforeCents > 0 && (
                  <>
                    , deixando {isFromOwn ? 'sua' : 'a'} dívida com{' '}
                    <ActorName participant={toParticipant} isOwn={isToOwn} /> em{' '}
                    <strong>{formatCurrency(details.debtBeforeCents)}</strong>
                  </>
                )}{' '}
                antes deste pagamento.
              </>
            ) : (
              <>
                Esse crédito de <strong>{formatCurrency(details.mutualOffsetCents)}</strong> que{' '}
                {isFromOwn ? 'você tinha' : <><ActorName participant={fromParticipant} isOwn={false} /> tinha</>} a
                receber foi descontado direto dos{' '}
                <strong>{formatCurrency(details.directTotalBeforeCents)}</strong> listados acima,{' '}
                {details.debtBeforeCents > 0 ? (
                  <>
                    deixando {isFromOwn ? 'sua' : 'a'} dívida com{' '}
                    <ActorName participant={toParticipant} isOwn={isToOwn} /> em{' '}
                    <strong>{formatCurrency(details.debtBeforeCents)}</strong>.
                  </>
                ) : (
                  <>
                    quitando o que{' '}
                    {isFromOwn ? 'você' : <ActorName participant={fromParticipant} isOwn={false} />} devia a{' '}
                    <ActorName participant={toParticipant} isOwn={isToOwn} /> antes deste pagamento.
                  </>
                )}
              </>
            )}
          </p>
        </div>
      )}
    </div>
  );
}

function GroupDebtAccordion({
  details,
  fromParticipant,
  toParticipant,
  isFromOwn,
  isToOwn,
  groupDebtBeforeCents,
  groupSettledNowCents,
  groupRemainingAfterCents,
  stepIndex,
}) {
  const [expanded, setExpanded] = useState(false);
  const creditOffsetCents = (details?.directCounterSubtotalCents || 0) + (details?.groupSubtotalCents || 0);
  const hasRedirectionOffset = (details?.adjustmentCents || 0) > 0;
  const hasCreditOffset = creditOffsetCents > 0;
  const isCleared = groupRemainingAfterCents === 0;
  const isPartial = !isCleared && groupSettledNowCents > 0;
  const statusLabel = isCleared ? 'quitado' : 'em aberto';

  return (
    <div
      className={`expense-detail__group-wrap expense-detail__item--${isCleared ? 'settled_now' : isPartial ? 'partial_now' : 'open'}`}
      style={{ '--person-step': Math.min(stepIndex, 10) }}
    >
      <button
        type="button"
        className="expense-detail__accordion-trigger expense-detail__item"
        aria-expanded={expanded}
        onClick={() => setExpanded(prev => !prev)}
      >
        <div className="expense-detail__item-main">
          <span className={`expense-detail__item-title${isCleared ? ' is-struck' : ''}`}>
            acerto simplificado
          </span>
          <span className="expense-detail__item-sub">
            {!isPartial && (
              <>
                <span className={`expense-detail__item-status${isCleared && groupSettledNowCents > 0 ? ' is-settled-now' : ''}`}>
                  {isCleared && groupSettledNowCents > 0 && <Check size={12} aria-hidden="true" />}
                  {statusLabel}
                </span>
                <span aria-hidden="true">·</span>
              </>
            )}
            <span>{expanded ? 'ocultar resumo' : 'ver resumo'}</span>
          </span>
        </div>
        <span className="expense-detail__accordion-right">
          <span className="expense-detail__item-amount">
            <strong className={isCleared ? 'is-struck' : undefined}>
              {formatCurrency(groupDebtBeforeCents)}
            </strong>
          </span>
          <ChevronDown
            size={15}
            className={`expense-detail__chevron${expanded ? ' is-open' : ''}`}
            aria-hidden="true"
          />
        </span>
      </button>

      {isPartial && (
        <SettlementProgressBar
          settledCents={groupSettledNowCents}
          totalCents={groupDebtBeforeCents}
        />
      )}

      {expanded && details && (
        <div className="expense-detail__accordion-body">
          <div className="expense-detail__equation expense-detail__equation--plain">
            <div>
              <span>
                o que <ActorName participant={fromParticipant} isOwn={isFromOwn} /> devia a outras pessoas
              </span>
              <strong>{formatCurrency(details.fromTotalDebtCents)}</strong>
            </div>

            {details.directOpenTotalBeforeCents > 0 && (
              <div>
                <span className="expense-detail__equation-label">
                  <span>
                    {isFromOwn ? (
                      <>
                        suas dívidas diretas com{' '}
                        <ActorName participant={toParticipant} isOwn={isToOwn} />
                      </>
                    ) : (
                      <>
                        dívidas de <ActorName participant={fromParticipant} isOwn={false} /> com{' '}
                        <ActorName participant={toParticipant} isOwn={isToOwn} />
                      </>
                    )}
                  </span>
                  <small>(já listados acima)</small>
                </span>
                <strong>-{formatCurrency(details.directOpenTotalBeforeCents)}</strong>
              </div>
            )}

            {details.otherCreditorsDebtCents > 0 && (
              <div>
                <span>direcionado a outros credores</span>
                <strong>-{formatCurrency(details.otherCreditorsDebtCents)}</strong>
              </div>
            )}

            <div className="expense-detail__equation-total expense-detail__equation-split">
              <span>
                dívida redirecionada para <ActorName participant={toParticipant} isOwn={isToOwn} />
              </span>
              <strong>{formatCurrency(details.groupDebtBeforeCents)}</strong>
            </div>
          </div>

          <p className="expense-detail__accordion-caption">
            {details.directOpenTotalBeforeCents === 0 ? (
              <>
                {isToOwn ? (
                  <>
                    Você não lançou despesas para <ActorName participant={fromParticipant} isOwn={false} />
                  </>
                ) : (
                  <>
                    <ActorName participant={toParticipant} isOwn={false} /> não lançou despesas com{' '}
                    <ActorName participant={fromParticipant} isOwn={isFromOwn} />
                  </>
                )}
                , mas as pessoas para quem <ActorName participant={fromParticipant} isOwn={isFromOwn} /> devia
                também tinham valores a acertar com <ActorName participant={toParticipant} isOwn={isToOwn} />.
                Esse valor foi redirecionado para evitar transferências em cadeia.
              </>
            ) : (
              <>
                As pessoas para quem <ActorName participant={fromParticipant} isOwn={isFromOwn} /> devia essa
                diferença também tinham valores a acertar com{' '}
                <ActorName participant={toParticipant} isOwn={isToOwn} />. Para evitar transferências em
                cadeia, esse valor foi redirecionado direto para{' '}
                <ActorName participant={toParticipant} isOwn={isToOwn} />.
              </>
            )}
          </p>
        </div>
      )}
    </div>
  );
}

export function SettlementDetails({
  settlement,
  participants,
  expenses = [],
  settlements = [],
  user,
  revealState = 'idle',
}) {
  const fromParticipant = participants.find(p => p.id === settlement.from_participant_id) || {
    id: settlement.from_participant_id,
    name: settlement.from_name,
    color: settlement.from_color,
    user_id: settlement.from_user_id,
    avatar_version: settlement.from_avatar_version,
  };
  const toParticipant = participants.find(p => p.id === settlement.to_participant_id) || {
    id: settlement.to_participant_id,
    name: settlement.to_name,
    color: settlement.to_color,
    user_id: settlement.to_user_id,
    avatar_version: settlement.to_avatar_version,
  };
  const creator = participants.find(person => person.user_id && person.user_id === settlement.created_by);
  const isOwn = Boolean(user && fromParticipant?.user_id === user.id);
  const isToOwn = Boolean(user && toParticipant?.user_id === user.id);
  const receiptDate = formatReceiptDateTime(settlement.created_at);
  const fullDate = settlement.created_at
    ? new Date(settlement.created_at).toLocaleString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '';
  const stateClass = revealState === 'awaiting'
    ? ' expense-detail--awaiting'
    : revealState === 'revealing'
      ? ' expense-detail--revealing'
      : '';

  const attribution = useMemo(
    () => computeSettlementAttribution({
      settlementId: settlement.id,
      participants,
      expenses,
      settlements: settlements.length ? settlements : [settlement],
    }),
    [settlement, participants, expenses, settlements],
  );

  const breakdown = attribution?.breakdown || {
    debtBeforeCents: 0,
    settledCents: 0,
    creditedCents: settlement.amount,
    remainingCents: 0,
  };
  const items = attribution?.items || [];
  const mutualOffsetCents = attribution?.mutualOffsetCents || 0;
  const groupDebtBeforeCents = attribution?.groupDebtBeforeCents || 0;
  const groupSettledNowCents = attribution?.groupSettledNowCents || 0;
  const groupRemainingAfterCents = attribution?.groupRemainingAfterCents || 0;

  const clearedCount = items.filter(item => item.remainingAfterCents === 0).length;

  return (
    <div className={`expense-detail expense-detail--payment expense-detail--${isOwn ? 'own' : 'paper'}${stateClass}`}>
      <div className="expense-detail__total" style={{ '--receipt-step': 0 }}>
        <div className="expense-detail__total-head">
          <span>pagamento registrado</span>
          {receiptDate && (
            <time className="expense-detail__date" dateTime={settlement.created_at} title={fullDate}>
              {receiptDate}
            </time>
          )}
        </div>
        <strong>{formatCurrency(settlement.amount)}</strong>
      </div>

      <div className="expense-detail__meta expense-detail__meta--payment" style={{ '--receipt-step': 1 }}>
        <div className="expense-detail__pair" aria-label={`Pagamento de ${fromParticipant.name} para ${toParticipant.name}`}>
          <span className="expense-detail__pair-side">
            <ParticipantAvatar participant={fromParticipant} className="expense-detail__pair-avatar" />
            <strong className="expense-detail__pair-name">
              <ParticipantName
                participant={fromParticipant}
                suffix={fromParticipant.user_id === user?.id ? ' (você)' : ''}
              />
            </strong>
          </span>
          <ArrowRight size={15} className="expense-detail__pair-arrow" aria-hidden="true" />
          <span className="expense-detail__pair-side">
            <ParticipantAvatar participant={toParticipant} className="expense-detail__pair-avatar" />
            <strong className="expense-detail__pair-name">
              <ParticipantName
                participant={toParticipant}
                suffix={toParticipant.user_id === user?.id ? ' (você)' : ''}
              />
            </strong>
          </span>
        </div>
        {creator && creator.user_id !== fromParticipant?.user_id && (
          <span className="expense-detail__meta-item expense-detail__meta-item--secondary">
            lançado por <strong><SmoothTextSwap text={creator.name} /></strong>
          </span>
        )}
        {settlement.notes?.trim() && (
          <span className="expense-detail__meta-item expense-detail__note">
            “{settlement.notes.trim()}”
          </span>
        )}
      </div>

      <section className="expense-detail__card expense-detail__breakdown" style={{ '--receipt-step': 2 }} aria-label="Resumo financeiro entre os participantes">
        <div className="expense-detail__breakdown-row">
          <span>devia</span>
          <strong>{formatCurrency(breakdown.debtBeforeCents)}</strong>
        </div>
        <div className="expense-detail__breakdown-row">
          <span>quitou</span>
          <strong>{formatCurrency(breakdown.settledCents)}</strong>
        </div>
        {breakdown.creditedCents > 0 && (
          <div className="expense-detail__breakdown-row expense-detail__breakdown-row--credit">
            <span>creditou</span>
            <strong>+{formatCurrency(breakdown.creditedCents)}</strong>
          </div>
        )}
        {breakdown.remainingCents > 0 && (
          <div className="expense-detail__breakdown-row expense-detail__breakdown-row--remaining">
            <span>resta</span>
            <strong>{formatCurrency(breakdown.remainingCents)}</strong>
          </div>
        )}
      </section>

      <div className="expense-detail__section-head" style={{ '--receipt-step': 3 }}>
        <h2>
          despesas de <ParticipantName participant={toParticipant} />
        </h2>
        {items.length > 0 && (
          <span className="expense-detail__section-count">
            {clearedCount} de {items.length}
          </span>
        )}
      </div>

      <section className="expense-detail__card expense-detail__items" style={{ '--receipt-step': 4 }} aria-label="Despesas consideradas até o pagamento">
        {items.map((item, index) => {
          const isCleared = item.remainingAfterCents === 0;
          const isPriorOnly = item.status === 'settled_prior' || item.status === 'compensated';
          const isPartial = item.status === 'partial_now' || item.status === 'partial_prior';
          const dateLabel = formatDate(item.createdAt);

          if (isPartial) {
            const settledTotalCents = Math.max(0, item.participantShareCents - item.remainingAfterCents);
            return (
              <div
                key={item.expenseId}
                className={`expense-detail__item expense-detail__item--partial expense-detail__item--${item.status}`}
                style={{ '--person-step': Math.min(index, 10) }}
              >
                <div className="expense-detail__item-row">
                  <div className="expense-detail__item-main">
                    <span className="expense-detail__item-title">{item.description}</span>
                    {dateLabel && (
                      <span className="expense-detail__item-sub">
                        <span>{dateLabel}</span>
                      </span>
                    )}
                  </div>
                  <div className="expense-detail__item-amount">
                    <strong>{formatCurrency(item.participantShareCents)}</strong>
                  </div>
                </div>
                <SettlementProgressBar
                  settledCents={settledTotalCents}
                  totalCents={item.participantShareCents}
                />
              </div>
            );
          }

          return (
            <div
              key={item.expenseId}
              className={`expense-detail__item expense-detail__item--${item.status}`}
              style={{ '--person-step': Math.min(index, 10) }}
            >
              <div className="expense-detail__item-main">
                <span className={`expense-detail__item-title${isCleared ? ' is-struck' : ''}`}>
                  {item.description}
                </span>
                <span className="expense-detail__item-sub">
                  {dateLabel && <span>{dateLabel}</span>}
                  {dateLabel && <span aria-hidden="true">·</span>}
                  <span className={`expense-detail__item-status${item.status === 'settled_now' ? ' is-settled-now' : ''}`}>
                    {item.status === 'settled_now' && <Check size={12} aria-hidden="true" />}
                    {getItemStatusLabel(item)}
                  </span>
                </span>
              </div>
              <div className="expense-detail__item-amount">
                <strong className={isCleared ? `is-struck${isPriorOnly ? ' is-muted' : ''}` : undefined}>
                  {formatCurrency(item.participantShareCents)}
                </strong>
              </div>
            </div>
          );
        })}

        {mutualOffsetCents > 0 && (
          <CompensationAccordion
            details={attribution?.compensationDetails}
            fromParticipant={fromParticipant}
            toParticipant={toParticipant}
            isFromOwn={isOwn}
            isToOwn={isToOwn}
            mutualOffsetCents={mutualOffsetCents}
            stepIndex={items.length}
          />
        )}

        {groupDebtBeforeCents > 0 && (
          <GroupDebtAccordion
            details={attribution?.groupDebtDetails}
            fromParticipant={fromParticipant}
            toParticipant={toParticipant}
            isFromOwn={isOwn}
            isToOwn={isToOwn}
            groupDebtBeforeCents={groupDebtBeforeCents}
            groupSettledNowCents={groupSettledNowCents}
            groupRemainingAfterCents={groupRemainingAfterCents}
            stepIndex={items.length}
          />
        )}

        {items.length === 0 && groupDebtBeforeCents === 0 && (
          <p className="expense-detail__empty">
            nenhuma despesa em aberto até este pagamento.
          </p>
        )}
      </section>
    </div>
  );
}

export function SettlementDetailActions({ settlement, onEdit, onDelete }) {
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  async function remove() {
    if (!await requestConfirmation('Deseja excluir este registro de pagamento?', 'excluir')) return;
    setDeleting(true); setError('');
    try { await onDelete(settlement.id); } catch (err) { setError(err.message || 'não foi possível excluir o pagamento.'); setDeleting(false); }
  }
  return <div className="expense-detail__action-area">{error && <p className="expense-detail__error" role="alert">{error}</p>}<div className="expense-detail__actions"><button type="button" className="expense-detail__delete" disabled={deleting} onClick={remove}><Trash2 size={18}/> excluir</button><button type="button" className="expense-detail__edit" disabled={deleting} onClick={() => onEdit(settlement)}><Pencil size={18}/> editar pagamento</button></div></div>;
}
