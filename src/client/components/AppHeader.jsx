import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, Sprout, UserRound } from 'lucide-react';
import { BRAND_NAME } from '../../domain/pageTitle.js';
import { EVENT_LOADING_EXIT_FLIGHT_MS } from '../../domain/loadingTransition.js';
import { BrandMark } from './BrandMark.jsx';
import { ParticipantAvatar } from './ParticipantAvatars.jsx';
import {
  captureAvatarSnapshot,
  captureBrandMarkSnapshot,
  launchAvatarFlight,
  launchBrandMarkFlight,
} from '../lib/morph.js';
import './AppHeader.css';

export function AppHeader({
  mode,
  title,
  user,
  onProfile,
  onDonate,
  donateProgressPercent = 0,
  onBack,
  backLabel,
  pendingReturnAvatar,
  onReturnAvatarDone,
  onRegisterBrandCapture,
  brandFlightPhase = 'idle',
  pendingReturnBrand = null,
  onReturnBrandDone,
}) {
  const isBrandFlight = brandFlightPhase !== 'idle';
  const isBrandLoading = brandFlightPhase === 'loading';
  const avatarBtnRef = useRef(null);
  const brandMarkRef = useRef(null);
  const titleRef = useRef(null);
  const prevModeRef = useRef(mode);

  const isSubpage = mode === 'profile' || mode === 'expense' || mode === 'donate';
  const showHeaderTitle = mode === 'profile' || mode === 'expense';
  const isDonateCentered = mode === 'donate';
  const showBack = mode !== 'home';

  const [brandMode, setBrandMode] = useState(mode === 'event' ? 'event' : 'home');
  const [displayedTitle, setDisplayedTitle] = useState(title || '');
  const [brandSlide, setBrandSlide] = useState('');
  const effectiveBrandMode = mode === 'home' || mode === 'event' ? mode : brandMode;

  useEffect(() => {
    if (!onRegisterBrandCapture) return undefined;
    onRegisterBrandCapture(() => captureBrandMarkSnapshot(brandMarkRef.current));
    return () => onRegisterBrandCapture(null);
  }, [onRegisterBrandCapture]);

  useEffect(() => {
    const prevMode = prevModeRef.current;
    prevModeRef.current = mode;

    if (mode === 'home' || mode === 'event') {
      setBrandMode(mode);
      if (isBrandFlight || pendingReturnBrand) {
        setBrandSlide('');
      } else if (prevMode === 'home' && mode === 'event') {
        setBrandSlide('to-event');
      } else if (prevMode === 'event' && mode === 'home') {
        setBrandSlide('to-home');
      } else {
        setBrandSlide('');
      }
    } else {
      setBrandSlide('');
    }
  }, [mode, isBrandFlight, pendingReturnBrand]);

  useEffect(() => {
    if (title) setDisplayedTitle(title);
  }, [title]);

  useEffect(() => {
    if (!showHeaderTitle) return;
    // Focus heading on subpages unless an input (e.g. new expense amount) already took focus.
    const active = document.activeElement;
    if (!active || active === document.body || active.tagName === 'BUTTON') {
      titleRef.current?.focus({ preventScroll: true });
    }
  }, [showHeaderTitle, mode]);

  useLayoutEffect(() => {
    if (isSubpage || !pendingReturnAvatar) return undefined;
    const targetEl = avatarBtnRef.current;
    if (!targetEl) {
      onReturnAvatarDone?.();
      return undefined;
    }
    const toRect = targetEl.getBoundingClientRect();
    return launchAvatarFlight({
      cloneNode: pendingReturnAvatar.cloneNode,
      hideTargetEl: targetEl,
      fromRect: pendingReturnAvatar.rect,
      toRect,
      duration: 380,
      direction: 'reverse',
      onFinish: onReturnAvatarDone,
    });
  }, [isSubpage, pendingReturnAvatar, onReturnAvatarDone]);

  useLayoutEffect(() => {
    if (isSubpage || mode !== 'event' || !isBrandFlight) return undefined;
    const targetEl = brandMarkRef.current;
    if (!targetEl || !pendingReturnBrand?.rect || !pendingReturnBrand?.cloneNode) {
      onReturnBrandDone?.();
      return undefined;
    }
    const toRect = targetEl.getBoundingClientRect();
    return launchBrandMarkFlight({
      cloneNode: pendingReturnBrand.cloneNode,
      hideTargetEl: targetEl,
      fromRect: pendingReturnBrand.rect,
      toRect,
      duration: EVENT_LOADING_EXIT_FLIGHT_MS,
      onFinish: onReturnBrandDone,
    });
  }, [isSubpage, mode, isBrandFlight, pendingReturnBrand, onReturnBrandDone]);

  const handleProfileClick = () => {
    const snapshot = captureAvatarSnapshot(avatarBtnRef.current);
    onProfile?.(snapshot?.rect || null);
  };

  return (
    <header
      className={`app-header app-header--${mode} app-header--brand-${effectiveBrandMode}${brandSlide ? ` app-header--slide-${brandSlide}` : ''}${isBrandFlight ? ' app-header--brand-flight' : ''}${isBrandLoading ? ' app-header--brand-loading' : ''}`}
    >
      <button
        type="button"
        className={`app-header__back${showBack ? ' is-visible' : ''}`}
        onClick={showBack ? onBack : undefined}
        aria-label={backLabel || 'Voltar'}
        aria-hidden={!showBack}
        tabIndex={showBack ? 0 : -1}
        disabled={!showBack}
      >
        <ArrowLeft size={22} />
      </button>

      <div
        className={`app-header__brand${!isSubpage ? ' is-visible' : ''}`}
        aria-label={BRAND_NAME}
        aria-hidden={isSubpage}
      >
        <BrandMark ref={brandMarkRef} />
        {effectiveBrandMode === 'home' && <span className="app-header__wordmark">{BRAND_NAME}</span>}
      </div>

      <div className={`app-header__title${showHeaderTitle ? ' is-visible' : ''}`} aria-hidden={!showHeaderTitle}>
        <h1 ref={titleRef} tabIndex={-1}>{showHeaderTitle ? title : displayedTitle}</h1>
      </div>

      <div
        className={`app-header__donate-wrap${!isSubpage ? ' is-visible' : ''}${isDonateCentered ? ' is-centered' : ''}`}
      >
        <button
          type="button"
          className="app-header__donate"
          onClick={!isSubpage ? onDonate : undefined}
          aria-label={
            isDonateCentered
              ? 'Autossustentabilidade do site'
              : donateProgressPercent > 0
                ? `Autossustentabilidade do site (${Math.round(donateProgressPercent)}% da meta do mês)`
                : 'Autossustentabilidade do site'
          }
          aria-hidden={isSubpage && !isDonateCentered}
          tabIndex={isSubpage ? -1 : 0}
          disabled={isSubpage}
        >
          <Sprout size={20} strokeWidth={2} aria-hidden="true" />
        </button>
        <progress
          className="app-header__donate-ring"
          value={Math.min(100, Math.max(0, Number(donateProgressPercent || 0)))}
          max={100}
          aria-hidden="true"
          tabIndex={-1}
          style={{ '--value': Math.min(100, Math.max(0, Number(donateProgressPercent || 0))) }}
        />
      </div>

      <div
        className={`app-header__actions${!isSubpage ? ' is-visible' : ''}${mode === 'profile' ? ' is-morph-hidden' : ''}`}
      >
        <button
          ref={avatarBtnRef}
          type="button"
          className="events-home__profile"
          onClick={handleProfileClick}
          aria-label={user ? `Abrir perfil de ${user.name}` : 'entrar na conta'}
          aria-hidden={isSubpage}
          tabIndex={isSubpage ? -1 : 0}
          disabled={isSubpage}
        >
          {user?.avatar_version
            ? <ParticipantAvatar participant={{ user_id: user.id, avatar_version: user.avatar_version, name: user.name }} className="events-home__profile-avatar" />
            : <UserRound size={21} aria-hidden="true" />}
        </button>
      </div>
    </header>
  );
}
