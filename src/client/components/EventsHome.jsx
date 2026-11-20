import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Plus } from 'lucide-react';
import { isEventCreator } from '../../domain/eventMenu.js';
import { prefersReducedMotion } from '../lib/morph.js';
import { EventCardMenu } from './EventCardMenu.jsx';
import { EventDetailsModal } from './EventDetailsModal.jsx';
import { MorphTitle } from './MorphTitle.jsx';
import { ParticipantAvatars } from './ParticipantAvatars.jsx';
import { formatCurrency } from '../lib/format.js';
import './EventsHome.css';
import './LoginPage.css';

let savedScrollTop = 0;
let oldestFirst = false;

export function EventsHome({
  events,
  currentUser,
  onCreate,
  onSelect,
  onRenameEvent,
  onDeleteEvent,
  onLeaveEvent,
  onFinishDeleteEvent,
}) {
  const scrollRef = useRef(null);
  const cardRefs = useRef(new Map());
  const removeTimersRef = useRef(new Map());
  const [ascending, setAscending] = useState(oldestFirst);
  const [openMenuEventId, setOpenMenuEventId] = useState(null);
  const [detailsEventId, setDetailsEventId] = useState(null);
  const [removingIds, setRemovingIds] = useState(() => new Set());
  const [actionError, setActionError] = useState('');
  const orderedEvents = ascending ? [...events].reverse() : events;
  const detailsEvent = detailsEventId ? events.find((item) => item.id === detailsEventId) || null : null;
  const [fade, setFade] = useState({ top: false, bottom: false });
  const updateFade = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setFade({ top: el.scrollTop > 1, bottom: el.scrollTop + el.clientHeight < el.scrollHeight - 1 });
  }, []);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = savedScrollTop;
    const observer = new ResizeObserver(updateFade);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    updateFade();
    return () => observer.disconnect();
  }, [events, updateFade]);

  useEffect(() => () => {
    for (const timer of removeTimersRef.current.values()) clearTimeout(timer);
    removeTimersRef.current.clear();
  }, []);

  const getDetailsOriginRect = useCallback(() => {
    if (!detailsEventId) return null;
    const el = cardRefs.current.get(detailsEventId);
    return el ? el.getBoundingClientRect() : null;
  }, [detailsEventId]);

  const scheduleCardRemoval = useCallback((eventId) => {
    if (prefersReducedMotion()) {
      onFinishDeleteEvent?.(eventId);
      return;
    }
    setRemovingIds((prev) => {
      const next = new Set(prev);
      next.add(eventId);
      return next;
    });
    const timer = setTimeout(() => {
      removeTimersRef.current.delete(eventId);
      setRemovingIds((prev) => {
        if (!prev.has(eventId)) return prev;
        const next = new Set(prev);
        next.delete(eventId);
        return next;
      });
      onFinishDeleteEvent?.(eventId);
    }, 280);
    removeTimersRef.current.set(eventId, timer);
  }, [onFinishDeleteEvent]);

  const handleCardMenuAction = async (actionId, targetEvent) => {
    setActionError('');
    if (actionId === 'details') {
      setDetailsEventId(targetEvent.id);
      return;
    }
    if (actionId === 'rename') {
      onRenameEvent?.(targetEvent);
      return;
    }
    if (actionId === 'delete') {
      try {
        const deleted = await onDeleteEvent?.(targetEvent);
        if (deleted) {
          scheduleCardRemoval(targetEvent.id);
        }
      } catch (err) {
        setActionError(err.message || 'não foi possível excluir o evento.');
      }
      return;
    }
    if (actionId === 'leave') {
      try {
        const left = await onLeaveEvent?.(targetEvent);
        if (left) {
          scheduleCardRemoval(targetEvent.id);
        }
      } catch (err) {
        setActionError(err.message || 'não foi possível sair do evento.');
      }
    }
  };

  return (
    <>
      <div className="events-home__list-heading"><h2>seus eventos</h2><span>{events.length}</span><button type="button" className="events-home__sort" aria-label={ascending ? 'mostrar atividade mais recente primeiro' : 'mostrar atividade mais antiga primeiro'} title={ascending ? 'mais antigos primeiro' : 'mais recentes primeiro'} onClick={() => { oldestFirst = !ascending; setAscending(oldestFirst); savedScrollTop = 0; if (scrollRef.current) scrollRef.current.scrollTop = 0; }}>{ascending ? <ArrowUpNarrowWide size={20} aria-hidden="true" /> : <ArrowDownWideNarrow size={20} aria-hidden="true" />}</button></div>
      {actionError && <p className="events-home__error" role="alert">{actionError}</p>}
      <div className={`events-home__viewport${fade.top ? ' events-home__viewport--top' : ''}${fade.bottom ? ' events-home__viewport--bottom' : ''}`} ref={scrollRef} onScroll={e => { savedScrollTop = e.currentTarget.scrollTop; updateFade(); }} tabIndex={0} aria-label="Lista de eventos">
       <div className="events-home__content">
        {events.length ? (
          <div className="events-home__list">
            {orderedEvents.map((event, index) => {
              const creator = isEventCreator(event, currentUser);
              const menuOpen = openMenuEventId === event.id;
              const isRemoving = removingIds.has(event.id);
              return (
                <div
                  key={event.id}
                  className="events-home__event-slot"
                  data-removing={isRemoving ? 'true' : undefined}
                >
                  <div className="events-home__event-slot-inner">
                    <article
                      ref={(node) => {
                        if (node) cardRefs.current.set(event.id, node);
                        else cardRefs.current.delete(event.id);
                      }}
                      className={`events-home__event${menuOpen ? ' events-home__event--menu-open' : ''}`}
                      style={{ '--reveal-delay': `${Math.min(index, 5) ** 1.3 * 70}ms` }}
                    >
                      <button
                        type="button"
                        className="events-home__event-open"
                        disabled={isRemoving}
                        onClick={() => onSelect(event)}
                      >
                        <span className="events-home__event-heading">
                          <span className="events-home__event-title">
                            <MorphTitle text={event.title} morphKey={`home-event:${event.id}`} as="strong" />
                          </span>
                        </span>
                        {event.participants?.length > 0 && <ParticipantAvatars participants={event.participants} />}
                        {typeof event.participant_count === 'number' && (
                          <span className="events-home__event-summary">
                            <span className={`events-home__event-total events-home__event-personal${event.user_balance < 0 ? ' events-home__event-personal--debit' : ''}`}><span>{event.user_balance > 0 ? 'você recebe' : 'você deve'}</span><strong>{event.user_balance == null ? '—' : formatCurrency(Math.abs(event.user_balance))}</strong></span>
                            <span className="events-home__event-total"><span>total gasto</span><strong>{formatCurrency(event.total_expenses || 0)}</strong></span>
                          </span>
                        )}
                        {typeof event.expense_count === 'number' && (
                          <span className="events-home__event-latest">
                            {event.latest_expense_description ? <><span className="events-home__event-caption">último lançamento</span><span className="events-home__event-latest-row"><span>{event.latest_expense_description}</span><strong>{formatCurrency(event.latest_expense_amount)}</strong></span></> : <span className="events-home__event-caption">nenhum lançamento ainda</span>}
                          </span>
                        )}
                      </button>
                      <EventCardMenu
                        event={event}
                        isCreator={creator}
                        onAction={handleCardMenuAction}
                        onOpenChange={(open) => setOpenMenuEventId((prev) => (open ? event.id : prev === event.id ? null : prev))}
                      />
                    </article>
                  </div>
                </div>
              );
            })}
          </div>
        ) : <div className="events-home__empty"><p>ainda não tem nenhum momento por aqui.</p><span>crie um evento para começar.</span></div>}
       </div>
      </div>
      <footer className="events-home__footer"><button className="events-home__create" onClick={onCreate}><Plus size={20} aria-hidden="true" /> criar evento</button></footer>
      <EventDetailsModal
        isOpen={Boolean(detailsEvent)}
        event={detailsEvent}
        getOriginRect={getDetailsOriginRect}
        currentUser={currentUser}
        onClose={() => setDetailsEventId(null)}
        onOpenEvent={(target) => {
          setDetailsEventId(null);
          onSelect(target);
        }}
      />
    </>
  );
}
