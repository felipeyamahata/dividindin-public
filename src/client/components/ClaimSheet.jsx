import React, { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { getInitials } from '../lib/format.js';
import { ParticipantName } from './ParticipantName.jsx';

export function ClaimSheet(props) { return props.isOpen && props.unclaimedParticipants?.length ? <ClaimSheetContent {...props} /> : null; }

function ClaimSheetContent({
  isOpen,
  unclaimedParticipants = [],
  user,
  onClaim,
  onJoinNew,
}) {


  const [loadingId, setLoadingId] = useState(null);
  const [joiningNew, setJoiningNew] = useState(false);

  const handleClaim = async (participantId) => {
    setLoadingId(participantId);
    try {
      await onClaim(participantId);
    } finally {
      setLoadingId(null);
    }
  };

  const handleJoinNew = async () => {
    setJoiningNew(true);
    try {
      await onJoinNew();
    } finally {
      setJoiningNew(false);
    }
  };

  return (
    <div className="app-dialog-overlay">
      <section className="app-dialog" role="dialog" aria-modal="true" aria-labelledby="claim-title">
        <h2 id="claim-title">você está no grupo?</h2>
        <p className="app-dialog__hint">escolha seu nome para reunir seus gastos e saldo na sua conta.</p>
        <div className="app-dialog__participants">
          {unclaimedParticipants.map(person => <button type="button" key={person.id} disabled={Boolean(loadingId) || joiningNew} onClick={() => handleClaim(person.id)}>
            <span className="app-dialog__avatar" style={{backgroundColor: person.color || '#6366f1'}}>{getInitials(person.name)}</span>
            <span><ParticipantName participant={person} /></span><ArrowRight size={18} />
          </button>)}
        </div>
        <button className="app-dialog__primary" type="button" disabled={Boolean(loadingId) || joiningNew} onClick={handleJoinNew}>{joiningNew ? 'aguarde...' : 'entrar como novo participante'}</button>
      </section>
    </div>
  );
}
