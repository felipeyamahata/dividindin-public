import React, { useLayoutEffect, useMemo, useRef } from 'react';
import { ArrowRight } from 'lucide-react';
import { FEED_TOP_SCROLL_THRESHOLD_PX } from '../../domain/eventSync.js';
import { buildUnifiedFeed } from '../../domain/feed.js';
import { computeSettlementBreakdowns } from '../../domain/settlement.js';
import { ParticipantAvatar } from './ParticipantAvatars.jsx';
import { ParticipantName } from './ParticipantName.jsx';
import { SmoothTextSwap } from './SmoothTextSwap.jsx';
import { formatCurrency, formatTime, groupFeedByDate } from '../lib/format.js';
import { prefersReducedMotion } from '../lib/morph.js';
import './ExpenseFeed.css';

function TimelineEntry({ entry }) {
  const timeLabel = formatTime(entry.created_at);
  const actorName = entry.current_actor_name || entry.actor_name;
  const actorParticipant = {
    user_id: entry.actor_user_id,
    avatar_version: entry.actor_avatar_version,
    name: actorName,
    color: entry.placeholder_color || entry.current_participant_color || '#6366f1',
  };
  const genericName = entry.placeholder_name || entry.current_participant_name || actorName;
  const genericParticipant = {
    user_id: null,
    avatar_version: null,
    name: genericName,
    color: entry.placeholder_color || entry.current_participant_color || '#6366f1',
  };

  if (entry.type === 'PARTICIPANT_JOINED') {
    return (
      <div className="expense-feed__timeline-stack">
        <div className="expense-feed__timeline-pill">
          <ParticipantAvatar participant={actorParticipant} className="expense-feed__timeline-avatar" />
          <span className="expense-feed__timeline-text">
            <strong><SmoothTextSwap text={actorName} /></strong> entrou
          </span>
          {timeLabel && <time className="expense-feed__timeline-time" dateTime={entry.created_at}>{timeLabel}</time>}
        </div>
      </div>
    );
  }

  if (entry.type === 'PARTICIPANT_CLAIMED') {
    return (
      <div className="expense-feed__timeline-stack">
        <div className="expense-feed__timeline-pill">
          <ParticipantAvatar participant={genericParticipant} className="expense-feed__timeline-avatar" />
          <span className="expense-feed__timeline-text">
            <strong><ParticipantName name={genericName} isGeneric /></strong>
            <span className="expense-feed__timeline-arrow" aria-hidden="true">→</span>
          </span>
          <ParticipantAvatar participant={actorParticipant} className="expense-feed__timeline-avatar" />
          <span className="expense-feed__timeline-text">
            <strong><SmoothTextSwap text={actorName} /></strong>
          </span>
          {timeLabel && <time className="expense-feed__timeline-time" dateTime={entry.created_at}>{timeLabel}</time>}
        </div>
      </div>
    );
  }

  if (entry.type === 'PARTICIPANT_LEFT') {
    return (
      <div className="expense-feed__timeline-stack">
        <div className="expense-feed__timeline-pill">
          <ParticipantAvatar participant={actorParticipant} className="expense-feed__timeline-avatar" />
          <span className="expense-feed__timeline-text">
            <strong><SmoothTextSwap text={actorName} /></strong> saiu
          </span>
          {timeLabel && <time className="expense-feed__timeline-time" dateTime={entry.created_at}>{timeLabel}</time>}
        </div>
        <div className="expense-feed__timeline-pill">
          <ParticipantAvatar participant={actorParticipant} className="expense-feed__timeline-avatar" />
          <span className="expense-feed__timeline-text">
            <strong><SmoothTextSwap text={actorName} /></strong>
            <span className="expense-feed__timeline-arrow" aria-hidden="true">→</span>
          </span>
          <ParticipantAvatar participant={genericParticipant} className="expense-feed__timeline-avatar" />
          <span className="expense-feed__timeline-text">
            <strong><ParticipantName name={genericName} isGeneric /></strong>
          </span>
        </div>
      </div>
    );
  }

  return null;
}

export function ExpenseFeed({
  eventId = null,
  expenses = [],
  settlements = [],
  timelineEvents = [],
  participants = [],
  user,
  feedScrollElRef,
  feedScrollTopRef,
  onNewItemsWhileScrolled,
  onSelectExpense,
  onSelectSettlement,
}) {
  const feedRootRef = useRef(null);
  const unified = useMemo(
    () => buildUnifiedFeed({ expenses, settlements, timelineEvents }),
    [expenses, settlements, timelineEvents],
  );
  const settlementBreakdowns = useMemo(
    () => computeSettlementBreakdowns({ participants, expenses, settlements }),
    [participants, expenses, settlements],
  );

  const prevSnapshotRef = useRef(null);
  const pendingDiffRef = useRef(null);
  const currentIds = useMemo(() => new Set(unified.map((entry) => entry.id)), [unified]);

  // Capture pre-commit scroll anchor synchronously during render while the previous DOM is still mounted.
  if (prevSnapshotRef.current && prevSnapshotRef.current.eventId === eventId) {
    const addedIds = unified
      .filter((entry) => !prevSnapshotRef.current.ids.has(entry.id))
      .map((entry) => entry.id);

    if (addedIds.length > 0) {
      const scrollEl = feedScrollElRef?.current || null;
      const scrollTopBefore = scrollEl ? scrollEl.scrollTop : 0;
      const isScrolledDown = scrollTopBefore > FEED_TOP_SCROLL_THRESHOLD_PX;
      let anchor = null;

      if (isScrolledDown && scrollEl && feedRootRef.current) {
        const viewportTop = scrollEl.getBoundingClientRect().top;
        const nodes = feedRootRef.current.querySelectorAll('[data-feed-id]');
        for (const node of nodes) {
          const id = node.getAttribute('data-feed-id');
          if (!id || !prevSnapshotRef.current.ids.has(id)) continue;
          const rect = node.getBoundingClientRect();
          if (rect.bottom > viewportTop + 1) {
            anchor = { id, topBefore: rect.top };
            break;
          }
        }
      }

      pendingDiffRef.current = { addedIds, isScrolledDown, anchor };
    } else {
      pendingDiffRef.current = null;
    }
  } else {
    pendingDiffRef.current = null;
  }

  useLayoutEffect(() => {
    prevSnapshotRef.current = { eventId, ids: currentIds };
    const diff = pendingDiffRef.current;
    pendingDiffRef.current = null;
    if (!diff || !diff.addedIds.length) return undefined;

    const scrollEl = feedScrollElRef?.current || null;
    const rootEl = feedRootRef.current;

    if (diff.isScrolledDown) {
      if (diff.anchor && scrollEl && rootEl) {
        const anchorNode = Array.from(rootEl.querySelectorAll('[data-feed-id]')).find(
          (node) => node.getAttribute('data-feed-id') === diff.anchor.id,
        );
        if (anchorNode) {
          const deltaY = anchorNode.getBoundingClientRect().top - diff.anchor.topBefore;
          if (Math.abs(deltaY) > 0.5) {
            scrollEl.scrollTop += deltaY;
            if (feedScrollTopRef) {
              feedScrollTopRef.current = scrollEl.scrollTop;
            }
          }
        }
      }
      onNewItemsWhileScrolled?.(diff.addedIds.length);
      return undefined;
    }

    if (!rootEl || prefersReducedMotion()) return undefined;

    const addedSet = new Set(diff.addedIds);
    const animations = [];
    const targetNodes = Array.from(rootEl.querySelectorAll('[data-feed-id]')).filter((node) =>
      addedSet.has(node.getAttribute('data-feed-id')),
    );

    for (const node of targetNodes) {
      node.setAttribute('data-live-inserted', 'true');
      const rect = node.getBoundingClientRect();
      if (!rect.height) continue;
      const hasSibling = Boolean(node.parentElement && node.parentElement.children.length > 1);
      const fromFrame = {
        height: '0px',
        opacity: 0,
        transform: 'translateY(-10px) scale(0.95)',
        overflow: 'hidden',
        ...(hasSibling ? { marginBottom: '-10px' } : {}),
      };
      const toFrame = {
        height: `${rect.height}px`,
        opacity: 1,
        transform: 'translateY(0) scale(1)',
        overflow: 'hidden',
        ...(hasSibling ? { marginBottom: '0px' } : {}),
      };
      const anim = node.animate([fromFrame, toFrame], {
        duration: 400,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      });
      animations.push(anim);
    }

    return () => {
      for (const anim of animations) {
        anim.cancel();
      }
    };
  }, [eventId, currentIds, feedScrollElRef, feedScrollTopRef, onNewItemsWhileScrolled]);

  if (!unified.length) {
    return (
      <div className="expense-feed__empty" ref={feedRootRef}>
        <strong>nenhum lançamento ainda.</strong>
        <span>os gastos do evento aparecem aqui.</span>
      </div>
    );
  }

  const groups = groupFeedByDate(unified);
  let globalIndex = 0;

  return (
    <div className="expense-feed" ref={feedRootRef}>
      {groups.map((group) => (
        <section className="expense-feed__group" key={group.dateKey}>
          <div className="expense-feed__date-header">
            <span className="expense-feed__date-pill">{group.label}</span>
          </div>
          <div className="expense-feed__group-items">
            {group.items.map(({ entry, isFirstInSequence }) => {
              const itemIndex = globalIndex++;

              if (entry.kind === 'timeline') {
                return (
                  <div
                    className="expense-feed__timeline-row"
                    key={entry.id}
                    data-feed-id={entry.id}
                    style={{ '--reveal-delay': `${Math.min(itemIndex, 5) ** 1.3 * 70}ms` }}
                  >
                    <TimelineEntry entry={entry.data} />
                  </div>
                );
              }

              if (entry.kind === 'settlement') {
                const settlement = entry.data;
                const sender = participants.find(person => person.id === settlement.from_participant_id) || {
                  id: settlement.from_participant_id,
                  name: settlement.from_name,
                  color: settlement.from_color,
                  user_id: settlement.from_user_id,
                  avatar_version: settlement.from_avatar_version,
                };
                const receiver = participants.find(person => person.id === settlement.to_participant_id) || {
                  id: settlement.to_participant_id,
                  name: settlement.to_name,
                  color: settlement.to_color,
                  user_id: settlement.to_user_id,
                  avatar_version: settlement.to_avatar_version,
                };
                const isOwn = Boolean(user && sender.user_id === user.id);
                const creator = participants.find(person => person.user_id && person.user_id === settlement.created_by);
                const breakdown = settlementBreakdowns.get(settlement.id) || {
                  debtBeforeCents: 0,
                  settledCents: 0,
                  creditedCents: settlement.amount,
                  remainingCents: 0,
                };

                return (
                  <article
                    className={`expense-feed__item${isOwn ? ' expense-feed__item--own' : ''}${!isFirstInSequence ? ' expense-feed__item--chained' : ''}`}
                    key={settlement.id}
                    data-feed-id={settlement.id}
                    style={{ '--reveal-delay': `${Math.min(itemIndex, 5) ** 1.3 * 70}ms` }}
                  >
                    {isFirstInSequence ? (
                      <ParticipantAvatar participant={sender} className="expense-feed__avatar" />
                    ) : (
                      <div className="expense-feed__avatar-spacer" aria-hidden="true" />
                    )}
                    <div className="expense-feed__body">
                      {!isOwn && isFirstInSequence && (
                        <span className="expense-feed__payer" title={sender.name}>
                          <ParticipantName participant={sender} />
                        </span>
                      )}
                      <button
                        type="button"
                        className="expense-feed__bubble expense-feed__bubble--payment"
                        data-expense-id={settlement.id}
                        onClick={(event) => onSelectSettlement?.(settlement, { element: event.currentTarget, isOwn })}
                        aria-label={`Ver pagamento de ${sender.name} para ${receiver.name}`}
                      >
                        <div className="expense-feed__payment-header">
                          <div className="expense-feed__payment-target" title={`Pagou para ${receiver.name}`}>
                            <span className="expense-feed__payment-verb">Pagou</span>
                            <ArrowRight size={14} className="expense-feed__payment-arrow" aria-hidden="true" />
                            <ParticipantAvatar participant={receiver} className="expense-feed__target-avatar" />
                            <span className="expense-feed__target-name">
                              <ParticipantName participant={receiver} />
                            </span>
                          </div>
                          <div className="expense-feed__meta expense-feed__payment-meta">
                            <span>{formatTime(settlement.created_at)}</span>
                            {creator && creator.user_id !== sender.user_id && (
                              <div className="expense-feed__creator" title={`lançado por ${creator.name}`}>
                                <span className="expense-feed__creator-label">lançado por</span>
                                <span className="expense-feed__creator-name"><SmoothTextSwap text={creator.name} /></span>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="expense-feed__payment-total">
                          <strong className="expense-feed__amount expense-feed__amount--payment">
                            {formatCurrency(settlement.amount)}
                          </strong>
                        </div>
                        <div className="expense-feed__payment-breakdown">
                          <div className="expense-feed__payment-row">
                            <span>devia</span>
                            <strong>{formatCurrency(breakdown.debtBeforeCents)}</strong>
                          </div>
                          <div className="expense-feed__payment-row">
                            <span>quitou</span>
                            <strong>{formatCurrency(breakdown.settledCents)}</strong>
                          </div>
                          {breakdown.creditedCents > 0 && (
                            <div className="expense-feed__payment-row expense-feed__payment-row--credit">
                              <span>creditou</span>
                              <strong>+{formatCurrency(breakdown.creditedCents)}</strong>
                            </div>
                          )}
                          {breakdown.remainingCents > 0 && (
                            <div className="expense-feed__payment-row expense-feed__payment-row--remaining">
                              <span>resta</span>
                              <strong>{formatCurrency(breakdown.remainingCents)}</strong>
                            </div>
                          )}
                        </div>
                      </button>
                    </div>
                  </article>
                );
              }

              const expense = entry.data;
              const payer = participants.find(person => person.id === expense.payer_id) || { name: expense.payer_name, color: expense.payer_color };
              const isOwn = Boolean(user && payer.user_id === user.id);
              const creator = participants.find(person => person.user_id && person.user_id === expense.created_by);

              return (
                <article
                  className={`expense-feed__item${isOwn ? ' expense-feed__item--own' : ''}${!isFirstInSequence ? ' expense-feed__item--chained' : ''}`}
                  key={expense.id}
                  data-feed-id={expense.id}
                  style={{ '--reveal-delay': `${Math.min(itemIndex, 5) ** 1.3 * 70}ms` }}
                >
                  {isFirstInSequence ? (
                    <ParticipantAvatar participant={payer} className="expense-feed__avatar" />
                  ) : (
                    <div className="expense-feed__avatar-spacer" aria-hidden="true" />
                  )}
                  <div className="expense-feed__body">
                    {!isOwn && isFirstInSequence && (
                      <span className="expense-feed__payer" title={payer.name}>
                        <ParticipantName participant={payer} />
                      </span>
                    )}
                    <button
                      type="button"
                      className="expense-feed__bubble"
                      data-expense-id={expense.id}
                      onClick={(event) => onSelectExpense(expense, { element: event.currentTarget, isOwn })}
                      aria-label={`Ver detalhes de ${expense.description}`}
                    >
                      <div className="expense-feed__meta">
                        <span>{formatTime(expense.created_at)}</span>
                        {creator && creator.user_id !== payer.user_id && (
                          <div className="expense-feed__creator" title={`lançado por ${creator.name}`}>
                            <span className="expense-feed__creator-label">lançado por</span>
                            <span className="expense-feed__creator-name"><SmoothTextSwap text={creator.name} /></span>
                          </div>
                        )}
                      </div>
                      <div className="expense-feed__details">
                        <h2 title={expense.description}>{expense.description}</h2>
                        <strong className="expense-feed__amount">{formatCurrency(expense.amount)}</strong>
                      </div>
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
