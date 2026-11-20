import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BRAND_NAME } from '../../domain/pageTitle.js';
import { SEO_FOOTER_LINE_1, SEO_FOOTER_LINE_2 } from '../../domain/seo.js';
import { prefersReducedMotion } from '../lib/morph.js';
import { useKeyboardFocusAnchor } from '../lib/useKeyboardFocusAnchor.js';
import { GoogleSignInButton } from './GoogleSignInButton.jsx';
import './LoginPage.css';

const MORPH_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

export function LoginPage({ onAuthSuccess }) {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastError, setLastError] = useState('');

  const cardFrameRef = useRef(null);
  const pendingOriginTopRef = useRef(null);
  const activeFlipRef = useRef(null);

  const captureCardTop = useCallback(() => {
    if (prefersReducedMotion() || !cardFrameRef.current) return;
    pendingOriginTopRef.current = cardFrameRef.current.getBoundingClientRect().top;
  }, []);

  const {
    isAnchored: isFormFocused,
    visibleHeight,
    containerProps,
  } = useKeyboardFocusAnchor({ onBeforeAnchorChange: captureCardTop });

  useEffect(() => {
    if (error) setLastError(error);
  }, [error]);

  useEffect(() => () => {
    activeFlipRef.current?.cancel();
  }, []);

  useLayoutEffect(() => {
    const originTop = pendingOriginTopRef.current;
    pendingOriginTopRef.current = null;
    const frameEl = cardFrameRef.current;
    if (originTop == null || !frameEl || prefersReducedMotion()) return;

    activeFlipRef.current?.cancel();
    activeFlipRef.current = null;

    const nextTop = frameEl.getBoundingClientRect().top;
    const deltaY = originTop - nextTop;
    if (Math.abs(deltaY) < 1) return;

    const animation = frameEl.animate(
      [{ transform: `translateY(${deltaY}px)` }, { transform: 'translateY(0)' }],
      { duration: 360, easing: MORPH_EASING }
    );
    activeFlipRef.current = animation;
    animation.onfinish = () => {
      if (activeFlipRef.current === animation) activeFlipRef.current = null;
    };
  }, [isRegister, isFormFocused, Boolean(error)]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (error) captureCardTop();
    setError('');
    if (!username.trim() || !password || (isRegister && !name.trim())) {
      captureCardTop();
      setError('preencha todos os campos para continuar.');
      return;
    }
    setLoading(true);
    try {
      await onAuthSuccess(isRegister ? 'register' : 'login', {
        username: username.trim(), password, ...(isRegister ? { name: name.trim() } : {}),
      });
    } catch (err) {
      captureCardTop();
      setError(err.message || 'não foi possível entrar. tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  const toggleMode = () => {
    captureCardTop();
    setIsRegister(prev => !prev);
    setError('');
  };

  const handleGoogleCredential = async (credential) => {
    if (error) captureCardTop();
    setError('');
    setLoading(true);
    try {
      await onAuthSuccess('google', { credential });
    } catch (err) {
      captureCardTop();
      setError(err.message || 'não foi possível entrar com google.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleError = (message) => {
    captureCardTop();
    setError(message);
  };

  const hideHeadline = isRegister || isFormFocused;

  return (
    <div
      className={`login-page${isFormFocused ? ' login-page--focused' : ''}`}
      style={visibleHeight ? { '--login-visible-height': `${visibleHeight}px` } : undefined}
    >
      <main className="login-card-frame" ref={cardFrameRef}>
        <section className={`login-card${isRegister ? ' login-card--register' : ''}`} aria-labelledby="login-brand-title" {...containerProps}>
          <div className="login-brand">
            <svg className="login-brand__mark" viewBox="0 0 90 29" fill="none" aria-hidden="true">
              <path d="M2 27V17C2 8.72 8.72 2 17 2s15 6.72 15 15v10H2ZM30 27V17C30 8.72 36.72 2 45 2s15 6.72 15 15v10H30ZM58 27V17C58 8.72 64.72 2 73 2s15 6.72 15 15v10H58Z" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" />
            </svg>
            <h1 id="login-brand-title" className="login-brand__name">{BRAND_NAME}</h1>
          </div>
          <div className={`login-card__headline${hideHeadline ? ' login-card__headline--collapsed' : ''}`} aria-hidden={hideHeadline}>
            <div>
              <h2 id="login-title" className="login-card__title">curta o momento,<br /><span>a conta a gente faz!</span></h2>
            </div>
          </div>
          <form onSubmit={handleSubmit} className="login-form">
            <div className={`login-form__name${isRegister ? ' login-form__name--visible' : ''}`} inert={isRegister ? undefined : ''} aria-hidden={!isRegister}>
              <div><label>nome ou apelido<input value={name} onChange={e => setName(e.target.value)} autoComplete="name" required={isRegister} tabIndex={isRegister ? undefined : -1} /></label></div>
            </div>
            <label>usuário<input value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" required /></label>
            <label>senha<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete={isRegister ? 'new-password' : 'current-password'} minLength={isRegister ? 8 : undefined} maxLength={256} required /></label>
            <div className={`login-form__error-wrap${error ? ' login-form__error-wrap--visible' : ''}`} aria-hidden={!error}>
              <div><p className="login-form__error" role={error ? 'alert' : undefined}>{error || lastError}</p></div>
            </div>
            <button className="login-form__submit" disabled={loading} type="submit">{loading ? 'aguarde...' : isRegister ? 'criar conta' : 'entrar'} <span aria-hidden="true">↗</span></button>
          </form>
          <GoogleSignInButton
            onCredential={handleGoogleCredential}
            onError={handleGoogleError}
            disabled={loading}
          />
          <p className="login-card__switch">{isRegister ? 'já tem conta?' : 'primeira vez por aqui?'} <button type="button" onClick={toggleMode}>{isRegister ? 'entrar' : 'criar conta'}</button></p>
        </section>
      </main>
      <footer className="login-page__footer">
        <p>{SEO_FOOTER_LINE_1}</p>
        <p className="login-page__footer-brand"><strong>{SEO_FOOTER_LINE_2}</strong></p>
      </footer>
    </div>
  );
}
