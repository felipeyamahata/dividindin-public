import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Camera, ChevronRight, Download, Eye, EyeOff, LogOut, Pencil, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { setCachedAvatar } from '../lib/avatarCache.js';
import { formatCurrency } from '../lib/format.js';
import { getInstallState, promptAppInstall, subscribeInstallState } from '../lib/installPrompt.js';
import { captureAvatarSnapshot, launchAvatarFlight, prefersReducedMotion } from '../lib/morph.js';
import { useKeyboardFocusAnchor } from '../lib/useKeyboardFocusAnchor.js';
import { useBackLayer } from '../lib/useHistoryNavigation.js';
import { InstallGuideModal } from './InstallGuideModal.jsx';
import { ParticipantAvatar } from './ParticipantAvatars.jsx';
import { SmoothTextSwap } from './SmoothTextSwap.jsx';
import './ProfileView.css';
import { requestConfirmation } from './ConfirmDialog.jsx';

async function compressPhoto(file) {
  if (!file.type.startsWith('image/') || file.size > 20 * 1024 * 1024) throw new Error('escolha uma imagem de até 20 mb.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256;
    const size = Math.min(image.naturalWidth, image.naturalHeight);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, (image.naturalWidth - size) / 2, (image.naturalHeight - size) / 2, size, size, 0, 0, 256, 256);
    return canvas.toDataURL('image/jpeg', 0.78);
  } catch { throw new Error('não foi possível abrir essa imagem. escolha outra foto.'); }
  finally { URL.revokeObjectURL(url); }
}

export function ProfileView({
  user,
  userEvents = [],
  avatarOriginRect = null,
  onRegisterReturnCapture,
  onLogout,
  onUserChange,
}) {
  const [summary, setSummary] = useState(null);
  const [mode, setMode] = useState(null);
  const [name, setName] = useState(user?.name || '');
  const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '' });
  const [visible, setVisible] = useState({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const {
    isAnchored: focused,
    visibleHeight: dialogVisibleHeight,
    containerProps: dialogFocusProps,
    releaseAnchor,
  } = useKeyboardFocusAnchor({ isOpen: Boolean(mode) });

  useBackLayer(
    'profile-dialog',
    Boolean(mode),
    () => {
      if (!busy) {
        setMode(null);
        releaseAnchor();
      }
    },
    { priority: 20 }
  );
  const [fade, setFade] = useState({ top: false, bottom: false });
  const [isFlying, setIsFlying] = useState(() => Boolean(avatarOriginRect && !prefersReducedMotion()));
  const [installState, setInstallState] = useState(() => getInstallState());
  const [installing, setInstalling] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(false);

  const fileRef = useRef(null);
  const scrollRef = useRef(null);
  const avatarCoreRef = useRef(null);
  const originRectRef = useRef(avatarOriginRect);
  const backdropPointerDownRef = useRef(false);

  const updateFade = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setFade({ top: el.scrollTop > 1, bottom: el.scrollTop + el.clientHeight < el.scrollHeight - 1 });
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(updateFade);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    updateFade();
    return () => observer.disconnect();
  }, [updateFade, summary, userEvents.length, message, error]);

  useEffect(() => {
    setInstallState(getInstallState());
    return subscribeInstallState(setInstallState);
  }, []);

  const showInstallButton = installState.status === 'prompt-ready' || installState.status === 'manual-guide';

  const handleInstallClick = async () => {
    if (installState.status === 'manual-guide') {
      setIsGuideOpen(true);
      return;
    }
    if (installing) return;
    setInstalling(true);
    setError('');
    try {
      const outcome = await promptAppInstall();
      if (outcome === 'accepted') {
        setMessage('aplicativo instalado.');
      } else if (outcome === 'unavailable') {
        setMessage('prévia de staging: a instalação automática ativa em https.');
      }
    } finally {
      setInstalling(false);
    }
  };

  useEffect(() => {
    if (!onRegisterReturnCapture) return undefined;
    onRegisterReturnCapture(() => captureAvatarSnapshot(avatarCoreRef.current));
    return () => onRegisterReturnCapture(null);
  }, [onRegisterReturnCapture]);

  useLayoutEffect(() => {
    const fromRect = originRectRef.current;
    const coreEl = avatarCoreRef.current;
    if (!fromRect || !coreEl || prefersReducedMotion()) {
      setIsFlying(false);
      return undefined;
    }
    const toRect = coreEl.getBoundingClientRect();
    return launchAvatarFlight({
      cloneNode: coreEl.cloneNode(true),
      hideTargetEl: coreEl,
      fromRect,
      toRect,
      duration: 420,
      direction: 'forward',
      onFinish: () => setIsFlying(false),
    });
  }, []);

  useEffect(() => { if (!user) return; let live = true; api.getProfile().then(data => { if (live) setSummary(data.summary); }).catch(() => {}); return () => { live = false; }; }, [user?.id]);

  if (!user) return null;

  const open = next => { backdropPointerDownRef.current = false; setError(''); setMessage(''); setName(user.name); setPasswords({ current: '', next: '', confirm: '' }); setMode(next); };
  const photoChange = async e => {
    const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
    setBusy(true); setError('');
    try {
      const image = await compressPhoto(file);
      const result = await api.updateAvatar(image);
      setCachedAvatar(user.id, result.user.avatar_version, image);
      onUserChange(result.user);
      setMessage('');
    }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const submit = async e => {
    e.preventDefault(); setError(''); setBusy(true);
    try {
      if (mode === 'name') { const result = await api.updateProfile(name); onUserChange(result.user); setMessage('nome atualizado.'); }
      else { if (passwords.next !== passwords.confirm) throw new Error('as novas senhas não coincidem.'); await api.updatePassword(passwords.current, passwords.next); setMessage('senha atualizada.'); }
      setMode(null); releaseAnchor();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <>
      <div
        ref={scrollRef}
        onScroll={updateFade}
        tabIndex={0}
        aria-label="Perfil do usuário"
        className={`profile-page__viewport${fade.top ? ' events-home__viewport--top' : ''}${fade.bottom ? ' events-home__viewport--bottom' : ''}`}
      >
        <div className="profile-page__body">
          <div className="profile-page__identity">
            <div className="profile-page__identity-info">
              <div className="profile-page__name-label">
                <span>nome de exibição</span>
                <button className="profile-page__edit" onClick={() => open('name')} aria-label="Editar nome de exibição">
                  <Pencil size={16} />
                </button>
              </div>
              <h2><SmoothTextSwap text={user.name} /></h2>
              <p>@{user.username}</p>
            </div>
            <button
              type="button"
              className={`profile-page__avatar${isFlying ? ' is-flying' : ''}`}
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              aria-label="Alterar foto de perfil"
            >
              <span ref={avatarCoreRef} className="profile-page__avatar-core">
                <ParticipantAvatar
                  participant={{ user_id: user.id, avatar_version: user.avatar_version, name: user.name }}
                  className="profile-page__avatar-inner"
                  useSelfEndpoint
                />
              </span>
              <span className="profile-page__avatar-ring" aria-hidden="true" />
              <span className="profile-page__camera" aria-hidden="true">
                <Camera size={16} />
              </span>
            </button>
            <input ref={fileRef} type="file" accept="image/*" onChange={photoChange} hidden />
          </div>
          {(error && !mode) && <p className="profile-page__feedback profile-page__feedback--error" role="alert">{error}</p>}
          {message && <p className="profile-page__feedback" role="status">{message}</p>}
          <h3>seu resumo</h3>
          <div className="profile-page__stats">
            <div><strong>{userEvents.length}</strong><span>eventos</span></div>
            <div><strong>{summary?.expense_count ?? '—'}</strong><span>lançamentos</span></div>
            <div className="profile-page__stats-total"><strong>{summary ? formatCurrency(summary.total_expenses) : '—'}</strong><span>total lançado</span></div>
          </div>
          <h3>conta</h3>
          <div className="profile-page__menu">
            {user.has_password !== false && (
              <button type="button" onClick={() => open('password')}><span>alterar senha</span><ChevronRight size={20} /></button>
            )}
            {showInstallButton && (
              <button
                type="button"
                onClick={handleInstallClick}
                aria-disabled={installing ? 'true' : undefined}
              >
                <span>{installing ? 'instalando...' : 'instalar app'}</span>
                <Download size={19} aria-hidden="true" />
              </button>
            )}
          </div>
          <button
            className="profile-page__logout"
            onClick={async () => { if (await requestConfirmation('deseja realmente sair da sua conta?', 'sair')) onLogout(); }}
          >
            <LogOut size={18} /> sair da conta
          </button>
        </div>
      </div>

      {mode && (
        <div
          className={`profile-dialog__overlay${focused ? ' profile-dialog__overlay--focused' : ''}`}
          style={dialogVisibleHeight ? { '--profile-visible-height': `${dialogVisibleHeight}px` } : undefined}
          onPointerDown={e => { backdropPointerDownRef.current = e.target === e.currentTarget; }}
          onClick={e => {
            const shouldClose = backdropPointerDownRef.current && e.target === e.currentTarget && !busy;
            backdropPointerDownRef.current = false;
            if (shouldClose) { setMode(null); releaseAnchor(); }
          }}
          onKeyDown={e => { if (e.key === 'Escape' && !busy) { setMode(null); releaseAnchor(); } }}
        >
          <section
            className="profile-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-dialog-title"
            onClick={e => e.stopPropagation()}
            {...dialogFocusProps}
          >
            <div className="profile-dialog__heading">
              <h2 id="profile-dialog-title">{mode === 'name' ? 'editar nome' : 'alterar senha'}</h2>
              <button type="button" onClick={() => { setMode(null); releaseAnchor(); }} aria-label="Fechar"><X size={22} /></button>
            </div>
            <form onSubmit={submit}>
              {mode === 'name' ? (
                <label>
                  nome exibido
                  <input value={name} onChange={e => setName(e.target.value)} maxLength={100} required autoComplete="name" />
                </label>
              ) : (
                <>
                  {[['current', 'senha atual', 'current-password'], ['next', 'nova senha', 'new-password'], ['confirm', 'confirmar nova senha', 'new-password']].map(([key, label, autocomplete]) => (
                    <label key={key}>
                      {label}
                      <span className="profile-dialog__password">
                        <input
                          type={visible[key] ? 'text' : 'password'}
                          value={passwords[key]}
                          onChange={e => setPasswords({ ...passwords, [key]: e.target.value })}
                          minLength={key === 'current' ? undefined : 8}
                          maxLength={256}
                          required
                          autoComplete={autocomplete}
                        />
                        <button
                          type="button"
                          onClick={() => setVisible({ ...visible, [key]: !visible[key] })}
                          aria-label={`${visible[key] ? 'Ocultar' : 'Mostrar'} ${label.toLowerCase()}`}
                        >
                          {visible[key] ? <EyeOff size={19} /> : <Eye size={19} />}
                        </button>
                      </span>
                    </label>
                  ))}
                </>
              )}
              {error && <p className="profile-dialog__error" role="alert">{error}</p>}
              <button className="profile-dialog__submit" disabled={busy}>{busy ? 'salvando...' : 'salvar'}</button>
            </form>
          </section>
        </div>
      )}
      <InstallGuideModal
        isOpen={isGuideOpen}
        browserGuide={installState.browserGuide}
        onClose={() => setIsGuideOpen(false)}
      />
    </>
  );
}
