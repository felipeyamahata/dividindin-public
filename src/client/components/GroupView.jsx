import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Crown, Link, Plus, Trash2 } from 'lucide-react';
import { formatCurrency, getPaidSummaryDisplay } from '../lib/format.js';
import { api } from '../lib/api.js';
import { AddParticipantModal } from './AddParticipantModal.jsx';
import { RemoveParticipantModal } from './RemoveParticipantModal.jsx';
import { requestNotice } from './ConfirmDialog.jsx';
import { InviteDialog } from './InviteDialog.jsx';
import { ParticipantAvatar } from './ParticipantAvatars.jsx';
import { ParticipantName } from './ParticipantName.jsx';
import './GroupView.css';

export function GroupView({
  event,
  participants = [],
  balances = [],
  currentParticipant,
  onAddParticipant,
  onRemoveParticipant,
}) {
  const [expanded, setExpanded] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState(null);
  const [removePreview, setRemovePreview] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const listRef = useRef(null);
  const [fade, setFade] = useState({ top: false, bottom: false });

  const isEventAdmin = Boolean(
    currentParticipant?.user_id
    && event?.created_by
    && currentParticipant.user_id === event.created_by,
  );

  const { adminParticipant, otherParticipants } = useMemo(() => {
    const admin = participants.find(
      person => person.user_id && event?.created_by && person.user_id === event.created_by,
    ) || null;
    const others = participants.filter(person => person.id !== admin?.id);
    return { adminParticipant: admin, otherParticipants: others };
  }, [participants, event?.created_by]);

  const updateFade = useCallback(() => {
    const el = listRef.current;
    if (el) setFade({ top: el.scrollTop > 1, bottom: el.scrollTop + el.clientHeight < el.scrollHeight - 1 });
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(updateFade);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    updateFade();
    return () => observer.disconnect();
  }, [updateFade, participants.length]);

  const handleOpenAdd = () => {
    if (!isEventAdmin) {
      requestNotice('Somente o admin pode adicionar participantes');
      return;
    }
    setAddOpen(true);
  };

  const handleOpenRemove = async (person) => {
    setRemoveTarget(person);
    setRemovePreview(null);
    setLoadingPreview(true);
    try {
      const res = await api.getRemovalPreview(event.id, person.id);
      setRemovePreview(res.preview);
    } catch (err) {
      setRemoveTarget(null);
      requestNotice(err.message || 'Não foi possível analisar a remoção.');
    } finally {
      setLoadingPreview(false);
    }
  };

  const renderParticipantCard = (person, index) => {
    const stats = balances.find(item => item.id === person.id);
    const paidDisplay = getPaidSummaryDisplay(stats);
    const net = stats?.netBalance;
    const open = expanded === person.id;
    const isCreator = Boolean(person.user_id && event?.created_by && person.user_id === event.created_by);
    const isMe = currentParticipant?.id === person.id;
    const canRemove = isEventAdmin && !isCreator;

    return (
      <div className={`group-view__card${isMe ? ' group-view__card--own' : ''}`} key={person.id} style={{ '--reveal-delay': `${Math.min(index * 100, 500)}ms` }}>
        <button type="button" className="group-view__person" aria-expanded={open} onClick={() => setExpanded(open ? null : person.id)}>
          <ParticipantAvatar participant={person} className="group-view__avatar" />
          <span className="group-view__identity">
            <strong><ParticipantName participant={person} /></strong>
            {isCreator && (
              <span className="group-view__badges">
                <span className="group-view__badge group-view__badge--admin"><Crown size={11} aria-hidden="true" /> admin</span>
              </span>
            )}
          </span>
          <span className={`group-view__balance${net < 0 ? ' group-view__balance--debit' : net > 0 ? ' group-view__balance--credit' : ''}`}>
            <span>{net == null ? 'saldo indisponível' : net < 0 ? 'deve' : net > 0 ? 'recebe' : 'tudo certo'}</span>
            {net != null && net !== 0 && <strong>{formatCurrency(Math.abs(net))}</strong>}
          </span>
          <ChevronDown size={18} className={`group-view__chevron${open ? ' is-open' : ''}`} />
        </button>
        {open && (
          <div className="group-view__expanded">
            <div className="group-view__summary">
              <div className={paidDisplay?.isNegativeNetPaid ? 'group-view__summary-item--received' : undefined}><span>{paidDisplay ? paidDisplay.label : 'pagou'}</span><strong>{paidDisplay ? formatCurrency(paidDisplay.amountCents) : '—'}</strong></div>
              <div><span>consumo</span><strong>{stats ? formatCurrency(stats.totalConsumed) : '—'}</strong></div>
            </div>
            {canRemove && (
              <button
                type="button"
                className="group-view__remove"
                onClick={() => handleOpenRemove(person)}
              >
                <Trash2 size={14} aria-hidden="true" /> remover participante
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  const remainingForRemoval = removeTarget
    ? participants.filter(p => p.id !== removeTarget.id)
    : [];

  return <>
    <section className="group-view" aria-labelledby="group-title">
      <div className="group-view__heading">
        <h2 id="group-title">participantes <span>{participants.length}</span></h2>
        {currentParticipant && (
          <button
            type="button"
            className={`group-view__add${!isEventAdmin ? ' group-view__add--unavailable' : ''}`}
            aria-disabled={!isEventAdmin ? 'true' : undefined}
            onClick={handleOpenAdd}
            aria-label="adicionar participante"
            title={isEventAdmin ? 'adicionar participante' : 'Somente o admin pode adicionar participantes'}
          >
            <Plus size={20} aria-hidden="true" />
          </button>
        )}
      </div>
      <div
        ref={listRef}
        onScroll={updateFade}
        className={`group-view__viewport${fade.top ? ' events-home__viewport--top' : ''}${fade.bottom ? ' events-home__viewport--bottom' : ''}`}
        tabIndex={0}
        aria-label="Lista de participantes"
      >
        <div className="group-view__scroll-content">
          <div className="group-view__list">
            {adminParticipant && renderParticipantCard(adminParticipant, 0)}
            {adminParticipant && otherParticipants.length > 0 && (
              <div className="group-view__divider" role="separator" aria-label="Demais participantes" />
            )}
            {otherParticipants.map((person, idx) => renderParticipantCard(person, idx + (adminParticipant ? 1 : 0)))}
          </div>
        </div>
      </div>
      <button type="button" className="group-view__invite" onClick={() => setInviteOpen(true)}>
        copiar link de convite <Link size={16} aria-hidden="true" />
      </button>
    </section>
    <AddParticipantModal isOpen={addOpen} onClose={() => setAddOpen(false)} onAdd={onAddParticipant} />
    <RemoveParticipantModal
      isOpen={Boolean(removeTarget)}
      participant={removeTarget}
      remainingParticipants={remainingForRemoval}
      defaultReplacementPayerId={adminParticipant?.id || remainingForRemoval[0]?.id || ''}
      preview={removePreview}
      loadingPreview={loadingPreview}
      onClose={() => {
        setRemoveTarget(null);
        setRemovePreview(null);
      }}
      onConfirm={async (participantId, replacementPayerId) => {
        await onRemoveParticipant?.(participantId, replacementPayerId);
        setExpanded(null);
      }}
    />
    <InviteDialog isOpen={inviteOpen} event={event} onClose={() => setInviteOpen(false)} />
  </>;
}
