import React from 'react';
import { SmoothTextSwap } from './SmoothTextSwap.jsx';

export function isGenericParticipant(participant) {
  return Boolean(participant && !participant.user_id);
}

export function ParticipantName({ participant, name, isGeneric, suffix = '', className = '' }) {
  const displayName = name ?? participant?.name ?? '';
  const generic = isGeneric ?? isGenericParticipant(participant);
  const resolvedClass = `${generic ? 'participant-name--generic ' : ''}${className}`.trim();

  return (
    <>
      {resolvedClass ? (
        <span className={resolvedClass}><SmoothTextSwap text={displayName} /></span>
      ) : (
        <SmoothTextSwap text={displayName} />
      )}
      {suffix}
    </>
  );
}
