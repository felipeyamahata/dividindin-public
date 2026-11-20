import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, LogOut, Pencil, Plus, ReceiptText, Scale, Trash2, UsersRound } from 'lucide-react';
import { FEED_TOP_SCROLL_THRESHOLD_PX, formatNewEntriesLabel } from '../../domain/eventSync.js';
import {
  EVENT_TABS,
  TAB_TRANSITION_TIMING,
  getTabSlideDirection,
} from '../../domain/tabTransition.js';
import { formatCurrency, getPaidSummaryDisplay } from '../lib/format.js';
import { captureExpenseBubbleSnapshot, launchReceiptMorph, prefersReducedMotion } from '../lib/morph.js';
import { MorphTitle } from './MorphTitle.jsx';
import './EventsHome.css';
import './LoginPage.css';
import './EventShell.css';

export function EventShell({
  event,
  balance,
  userSummary,
  activeTab,
  onTab,
  onAdd,
  isCreator = false,
  isParticipant = false,
  onEditEvent,
  onDeleteEvent,
  onLeaveEvent,
  children,
  detailTitle,
  detailFooter,
  detailReceipt = null,
  receiptEntryOrigin = null,
  onEntryMorphDone,
  pendingReturnReceipt = null,
  onReturnReceiptDone,
  onRegisterDetailExitCapture,
  feedScrollTopRef,
  feedScrollElRef,
  pendingNewFeedCount = 0,
  onClearPendingNewFeed,
  suppressFeedReveal = false,
}) {
  const viewportWrapRef = useRef(null);
  const viewportStageRef = useRef(null);
  const scrollRef = useRef(null);
  const swipeRef = useRef(null);
  const outgoingRef = useRef(null);
  const [slideDirection, setSlideDirection] = useState(0);
  useEffect(() => () => {
    outgoingRef.current?.remove();
  }, []);
  useEffect(() => {
    if (detailTitle) setSlideDirection(0);
  }, [detailTitle]);
  const [fade, setFade] = useState({ top: false, bottom: false });
  const updateFade = useCallback(() => {
    const el = scrollRef.current;
    if (el) setFade({ top: el.scrollTop > 1, bottom: el.scrollTop + el.clientHeight < el.scrollHeight - 1 });
  }, []);
  const handleScroll = useCallback(() => {
    updateFade();
    const el = scrollRef.current;
    if (el && !detailTitle && activeTab === 'expenses') {
      if (feedScrollTopRef) {
        feedScrollTopRef.current = el.scrollTop;
      }
      if (el.scrollTop <= FEED_TOP_SCROLL_THRESHOLD_PX) {
        onClearPendingNewFeed?.();
      }
    }
  }, [updateFade, detailTitle, activeTab, feedScrollTopRef, onClearPendingNewFeed]);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (feedScrollElRef) {
      feedScrollElRef.current = el;
    }
    if (!el) return;
    if (!detailTitle && activeTab === 'expenses' && feedScrollTopRef) {
      el.scrollTop = feedScrollTopRef.current || 0;
    } else {
      el.scrollTop = 0;
    }
    const observer = new ResizeObserver(updateFade);
    observer.observe(el); if (el.firstElementChild) observer.observe(el.firstElementChild);
    updateFade(); return () => observer.disconnect();
  }, [activeTab, detailTitle, feedScrollTopRef, feedScrollElRef, updateFade]);

  useEffect(() => {
    if (!onRegisterDetailExitCapture) return undefined;
    onRegisterDetailExitCapture(() => {
      const stageEl = viewportStageRef.current;
      const scrollEl = scrollRef.current;
      if (!detailReceipt || !stageEl || !scrollEl) return null;
      const fromRect = stageEl.getBoundingClientRect();
      if (!fromRect.width || !fromRect.height) return null;
      const detailEl = scrollEl.querySelector('.expense-detail');
      const receiptClone = detailEl ? detailEl.cloneNode(true) : null;
      if (receiptClone) {
        receiptClone.classList.remove('expense-detail--awaiting', 'expense-detail--revealing');
      }
      return {
        expenseId: detailReceipt.expenseId,
        isOwn: detailReceipt.isOwn,
        fromRect: { left: fromRect.left, top: fromRect.top, width: fromRect.width, height: fromRect.height },
        fromBackground: window.getComputedStyle(stageEl).backgroundColor,
        receiptScrollTop: scrollEl.scrollTop || 0,
        receiptContentNode: receiptClone,
      };
    });
    return () => onRegisterDetailExitCapture(null);
  }, [onRegisterDetailExitCapture, detailReceipt]);

  useLayoutEffect(() => {
    if (!detailReceipt || !receiptEntryOrigin || receiptEntryOrigin.expenseId !== detailReceipt.expenseId) {
      return undefined;
    }
    const wrapEl = viewportWrapRef.current;
    const stageEl = viewportStageRef.current;
    if (!wrapEl || !stageEl || prefersReducedMotion()) {
      onEntryMorphDone?.();
      return undefined;
    }
    const toRect = stageEl.getBoundingClientRect();
    const toBackground = window.getComputedStyle(stageEl).backgroundColor;
    return launchReceiptMorph({
      direction: 'forward',
      fromRect: receiptEntryOrigin.rect,
      toRect,
      fromRadius: receiptEntryOrigin.borderRadius,
      toRadius: '0px',
      fromBackground: receiptEntryOrigin.backgroundColor,
      toBackground,
      bubbleContentNode: receiptEntryOrigin.bubbleContentNode,
      hideTargetEl: wrapEl,
      duration: 380,
      onFinish: onEntryMorphDone,
    });
  }, [detailReceipt, receiptEntryOrigin, onEntryMorphDone]);

  useLayoutEffect(() => {
    if (detailTitle || activeTab !== 'expenses' || !pendingReturnReceipt) {
      return undefined;
    }
    const el = scrollRef.current;
    if (!el) {
      onReturnReceiptDone?.();
      return undefined;
    }
    if (feedScrollTopRef) {
      el.scrollTop = feedScrollTopRef.current || 0;
    }
    updateFade();

    if (prefersReducedMotion()) {
      onReturnReceiptDone?.();
      return undefined;
    }

    const targetBubble = el.querySelector(`[data-expense-id="${pendingReturnReceipt.expenseId}"]`);
    if (!targetBubble) {
      onReturnReceiptDone?.();
      return undefined;
    }

    const viewportRect = el.getBoundingClientRect();
    const toRect = targetBubble.getBoundingClientRect();
    const isVisible = toRect.width > 0 && toRect.height > 0 && toRect.bottom > viewportRect.top && toRect.top < viewportRect.bottom;
    if (!isVisible) {
      onReturnReceiptDone?.();
      return undefined;
    }

    const computed = window.getComputedStyle(targetBubble);
    const snapshot = captureExpenseBubbleSnapshot(targetBubble, {
      expenseId: pendingReturnReceipt.expenseId,
      isOwn: pendingReturnReceipt.isOwn,
    });

    return launchReceiptMorph({
      direction: 'reverse',
      fromRect: pendingReturnReceipt.fromRect,
      toRect,
      fromRadius: '0px',
      toRadius: computed.borderRadius || '18px',
      fromBackground: pendingReturnReceipt.fromBackground,
      toBackground: computed.backgroundColor,
      bubbleContentNode: snapshot?.bubbleContentNode || null,
      receiptContentNode: pendingReturnReceipt.receiptContentNode,
      receiptScrollTop: pendingReturnReceipt.receiptScrollTop || 0,
      hideTargetEl: targetBubble,
      duration: 380,
      onFinish: onReturnReceiptDone,
    });
  }, [detailTitle, activeTab, pendingReturnReceipt, feedScrollTopRef, updateFade, onReturnReceiptDone]);
  const changeTab = (next) => {
    if (next === activeTab && !detailTitle) return;
    const direction = getTabSlideDirection(EVENT_TABS, activeTab, next);
    const reducedMotion = prefersReducedMotion();
    const viewport = scrollRef.current;
    outgoingRef.current?.remove();
    outgoingRef.current = null;
    if (direction && !detailTitle && viewport && !reducedMotion) {
      const content = viewport.querySelector('.event-shell__content');
      if (content) {
        const rect = viewport.getBoundingClientRect();
        const computedViewport = window.getComputedStyle(viewport);
        const maskImage = computedViewport.webkitMaskImage && computedViewport.webkitMaskImage !== 'none'
          ? computedViewport.webkitMaskImage
          : computedViewport.maskImage;
        const layer = document.createElement('div');
        layer.className = 'event-shell__outgoing';
        layer.setAttribute('aria-hidden', 'true');
        layer.inert = true;
        Object.assign(layer.style, {
          position: 'fixed',
          left: `${rect.left}px`,
          top: `${rect.top}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
          overflow: 'hidden',
          pointerEvents: 'none',
          zIndex: '5',
        });
        const copy = content.cloneNode(true);
        copy.style.marginTop = `-${viewport.scrollTop}px`;
        if (viewport.classList.contains('event-shell__group-viewport')) {
          Object.assign(copy.style, {
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            minHeight: '0',
            paddingBottom: '0',
          });
        }
        if (maskImage && maskImage !== 'none') {
          const verticalLayer = document.createElement('div');
          Object.assign(verticalLayer.style, {
            width: '100%',
            height: '100%',
            overflow: 'hidden',
            boxSizing: 'border-box',
            paddingLeft: computedViewport.paddingLeft,
            paddingRight: computedViewport.paddingRight,
            webkitMaskImage: maskImage,
            maskImage,
          });
          verticalLayer.appendChild(copy);
          layer.appendChild(verticalLayer);
        } else {
          Object.assign(layer.style, {
            boxSizing: 'border-box',
            paddingLeft: computedViewport.paddingLeft,
            paddingRight: computedViewport.paddingRight,
          });
          layer.appendChild(copy);
        }
        (viewport.closest('.events-home__shell') || document.body).appendChild(layer);
        const origGroupViewport = content.querySelector('.group-view__viewport');
        const copyGroupViewport = copy.querySelector('.group-view__viewport');
        if (origGroupViewport && copyGroupViewport) {
          copyGroupViewport.scrollTop = origGroupViewport.scrollTop;
        }
        outgoingRef.current = layer;
        const animation = copy.animate(
          [
            { transform: 'translateX(0)', opacity: 1 },
            { transform: `translateX(${-direction * 35}%)`, opacity: 0 },
          ],
          {
            duration: TAB_TRANSITION_TIMING.exitSlideDurationMs,
            easing: 'cubic-bezier(.22, 1, .36, 1)',
            fill: 'forwards',
          }
        );
        animation.onfinish = () => { layer.remove(); if (outgoingRef.current === layer) outgoingRef.current = null; };
      }
    }
    setSlideDirection(direction);
    onTab(next);
  };
  const startSwipe = (e) => {
    swipeRef.current = null;
    if (detailTitle || e.touches.length !== 1 || e.target.closest('input, textarea, select, [contenteditable="true"], [role="slider"]')) return;
    const touch = e.touches[0];
    swipeRef.current = { id: touch.identifier, x: touch.clientX, y: touch.clientY };
  };
  const endSwipe = (e) => {
    const start = swipeRef.current;
    swipeRef.current = null;
    if (!start || e.touches.length) return;
    const touch = Array.from(e.changedTouches).find(item => item.identifier === start.id);
    if (!touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < 55 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
    const next = EVENT_TABS[EVENT_TABS.indexOf(activeTab) + (dx < 0 ? 1 : -1)];
    if (next) changeTab(next);
  };
  const receiptWrapClass = detailReceipt
    ? ` event-shell__viewport-wrap--receipt${detailReceipt.isOwn ? ' event-shell__viewport-wrap--own' : ''}`
    : '';
  const contentSlideClass = slideDirection && !detailTitle && !suppressFeedReveal
    ? (slideDirection > 0 ? ' event-shell__content--from-right' : ' event-shell__content--from-left')
    : '';
  const contentRevealClass = suppressFeedReveal && !detailTitle ? ' event-shell__content--no-reveal' : '';
  const paidDisplay = getPaidSummaryDisplay(userSummary, { own: true });
  const newFeedLabel = formatNewEntriesLabel(pendingNewFeedCount);
  const showNewFeedPill = !detailTitle && activeTab === 'expenses' && pendingNewFeedCount > 0 && Boolean(newFeedLabel);
  const handleJumpToLatestFeed = () => {
    const el = scrollRef.current;
    if (!el) return;
    const reduced = prefersReducedMotion();
    el.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
    if (reduced) {
      if (feedScrollTopRef) feedScrollTopRef.current = 0;
      onClearPendingNewFeed?.();
    }
  };

  return <>
    <div className="event-shell__header"><MorphTitle text={detailTitle || event.title} morphKey={detailTitle ? 'detail' : `event:${event.id}`} as="h1" title={detailTitle || event.title} />{!detailTitle && activeTab === 'group' && (isCreator || isParticipant) && <div className="event-shell__actions">{isCreator && <button type="button" className="event-shell__action-btn" onClick={onEditEvent}><Pencil size={14} aria-hidden="true"/> editar</button>}{isCreator ? <button type="button" className="event-shell__action-btn event-shell__action-btn--leave" onClick={onDeleteEvent}><Trash2 size={14} aria-hidden="true"/> remover evento</button> : (isParticipant && <button type="button" className="event-shell__action-btn event-shell__action-btn--leave" onClick={onLeaveEvent}><LogOut size={14} aria-hidden="true"/> sair do evento</button>)}</div>}{!detailTitle && activeTab === 'expenses' && userSummary && paidDisplay && <div className="event-shell__summary"><div className={paidDisplay.isNegativeNetPaid ? 'event-shell__summary-item--received' : undefined}><span>{paidDisplay.label}</span><strong>{formatCurrency(paidDisplay.amountCents)}</strong></div><div><span>você consumiu</span><strong>{formatCurrency(userSummary.totalConsumed)}</strong></div></div>}</div>
    <div ref={viewportWrapRef} className={`event-shell__viewport-wrap${receiptWrapClass}`}>
      {showNewFeedPill && (
        <button
          type="button"
          className="event-shell__new-feed-pill"
          onClick={handleJumpToLatestFeed}
          aria-label={`${newFeedLabel}, ir para o topo da lista`}
        >
          <ArrowUp size={13} strokeWidth={2.5} aria-hidden="true" />
          <span>{newFeedLabel}</span>
        </button>
      )}
      <div ref={viewportStageRef} className="event-shell__viewport-stage">
        <div ref={scrollRef} onTouchStart={startSwipe} onTouchEnd={endSwipe} onTouchCancel={() => { swipeRef.current = null; }} onScroll={handleScroll} tabIndex={0} aria-label="Conteúdo do evento" className={`events-home__viewport${activeTab === 'group' && !detailTitle ? ' event-shell__group-viewport' : ''}${activeTab !== 'group' && fade.top ? ' events-home__viewport--top' : ''}${activeTab !== 'group' && fade.bottom ? ' events-home__viewport--bottom' : ''}`}><div className={`event-shell__content${contentSlideClass}${contentRevealClass}`} key={`${activeTab}-${detailReceipt ? `detail-${detailReceipt.expenseId}` : "list"}`}>{children}</div></div>
      </div>
    </div>
    <footer className="event-shell__footer">{detailTitle ? detailFooter : <nav className="event-shell__dock" aria-label="Seções do evento"><div className={`event-shell__balance${balance < 0 ? ' event-shell__balance--debit' : ''}`}><span>{balance > 0 ? 'você recebe' : 'você deve'}</span><strong>{balance == null ? '—' : formatCurrency(Math.abs(balance))}</strong></div>{[['expenses', 'Lançamentos', ReceiptText], ['settlement', 'Divisão', Scale], ['group', 'Participantes', UsersRound]].map(([id, label, Icon]) => <button key={id} onClick={() => changeTab(id)} className={activeTab === id ? 'is-active' : ''} aria-label={label} title={label} aria-current={activeTab === id ? 'page' : undefined}><Icon size={22}/></button>)}<button className="event-shell__add" onClick={onAdd} aria-label="Adicionar lançamento" title="Adicionar lançamento"><Plus size={24}/></button></nav>}</footer>
  </>;
}
