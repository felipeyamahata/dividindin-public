import React, { useState } from 'react';
import { ArrowRight, ChevronDown, Trash2 } from 'lucide-react';
import { formatCurrency, formatDate } from '../lib/format.js';
import { ParticipantAvatar } from './ParticipantAvatars.jsx';
import { ParticipantName } from './ParticipantName.jsx';
import './SettlementView.css';
import { requestConfirmation } from './ConfirmDialog.jsx';

export function SettlementView({ userSummary, simplifiedTransactions = [], settlements = [], participants = [], currentParticipant, onOpenRecordPayment, onDeleteSettlement }) {
  const [expanded, setExpanded] = useState(null);
  const [showTransfers, setShowTransfers] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const person = (id, name) => participants.find(p => p.id === id) || { name };
  const pending = [
    ...(userSummary?.toPay || []).map(tx => ({ ...tx, direction: 'pay', personId: tx.to, name: tx.toName })),
    ...(userSummary?.toReceive || []).map(tx => ({ ...tx, direction: 'receive', personId: tx.from, name: tx.fromName })),
  ];
  let revealIndex = 0;
  const revealStyle = () => ({ '--reveal-delay': `${Math.min(revealIndex++, 7) * 75}ms` });
  return <div className="settlement-view">
    <section aria-labelledby="settlement-personal-title">
      <div className="settlement-view__heading" style={revealStyle()}><h2 id="settlement-personal-title">seus acertos</h2>{currentParticipant && <button type="button" className="settlement-view__record" onClick={() => onOpenRecordPayment(null)}>informar pagamento</button>}</div>
      {!currentParticipant ? <div className="settlement-view__empty" style={revealStyle()}>entre no evento para ver seus acertos.</div> : pending.length === 0 ? <div className="settlement-view__empty" style={revealStyle()}>tudo acertado por aqui.</div> : <div className="settlement-view__list">{pending.map(tx => {
        const key = `${tx.from}-${tx.to}`;
        const open = expanded === key;
        return <div className="settlement-view__card" key={key} style={revealStyle()}>
          <button type="button" className="settlement-view__person" aria-expanded={open} onClick={() => setExpanded(open ? null : key)}>
            <ParticipantAvatar participant={person(tx.personId, tx.name)} className="settlement-view__avatar" />
            <span className="settlement-view__identity"><strong><ParticipantName participant={person(tx.personId, tx.name)} /></strong><span>{tx.direction === 'pay' ? 'você deve' : 'você recebe'}</span></span>
            <strong className={tx.direction === 'pay' ? 'settlement-view__debit' : 'settlement-view__credit'}>{formatCurrency(tx.amount)}</strong>
            <ChevronDown size={18} className={open ? 'settlement-view__chevron is-open' : 'settlement-view__chevron'} />
          </button>
          {open && <div className="settlement-view__card-action"><button type="button" onClick={() => onOpenRecordPayment(tx)}>quitar</button></div>}
        </div>;
      })}</div>}
    </section>
    <section className="settlement-view__accordion" style={revealStyle()}><button type="button" aria-expanded={showTransfers} onClick={() => setShowTransfers(!showTransfers)}><span>acertos do grupo <small>{simplifiedTransactions.length}</small></span><ChevronDown size={19} className={showTransfers ? 'settlement-view__chevron is-open' : 'settlement-view__chevron'} /></button>
      {showTransfers && <div className="settlement-view__rows">{simplifiedTransactions.length ? simplifiedTransactions.map(tx => <div className="settlement-view__transfer" key={`${tx.from}-${tx.to}`}><ParticipantAvatar participant={person(tx.from, tx.fromName)} className="settlement-view__avatar settlement-view__avatar--small"/><span><ParticipantName participant={person(tx.from, tx.fromName)} /></span><ArrowRight size={15}/><ParticipantAvatar participant={person(tx.to, tx.toName)} className="settlement-view__avatar settlement-view__avatar--small"/><span><ParticipantName participant={person(tx.to, tx.toName)} /></span><strong>{formatCurrency(tx.amount)}</strong></div>) : <p>tudo acertado por aqui.</p>}</div>}
    </section>
    <section className="settlement-view__accordion" style={revealStyle()}><button type="button" aria-expanded={showHistory} onClick={() => setShowHistory(!showHistory)}><span>pagamentos registrados <small>{settlements.length}</small></span><ChevronDown size={19} className={showHistory ? 'settlement-view__chevron is-open' : 'settlement-view__chevron'} /></button>
      {showHistory && <div className="settlement-view__rows">{deleteError && <p role="alert">{deleteError}</p>}{settlements.length ? settlements.map(item => <div className="settlement-view__history" key={item.id}><div><strong><ParticipantName participant={person(item.from_participant_id, item.from_name)} isGeneric={!item.from_user_id} /> → <ParticipantName participant={person(item.to_participant_id, item.to_name)} isGeneric={!item.to_user_id} /></strong><span>{formatDate(item.created_at)}{item.notes ? ` · ${item.notes}` : ''}</span></div><strong>{formatCurrency(item.amount)}</strong>{currentParticipant && <button type="button" aria-label="Excluir pagamento" onClick={async () => { if (!await requestConfirmation('deseja excluir este registro de pagamento?', 'excluir')) return; try { setDeleteError(''); await onDeleteSettlement(item.id); } catch (err) { setDeleteError(err.message || 'não foi possível excluir o pagamento.'); } }}><Trash2 size={17}/></button>}</div>) : <p>nenhum pagamento registrado.</p>}</div>}
    </section>
  </div>;
}
