import React, { useState } from 'react';
import { X } from 'lucide-react';
import { useBackLayer } from '../lib/useHistoryNavigation.js';
import { GoogleSignInButton } from './GoogleSignInButton.jsx';

export function AuthModal(props) { return props.isOpen ? <AuthModalContent {...props} /> : null; }

function AuthModalContent({ isOpen, onClose, onAuthSuccess }) {


  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useBackLayer('auth-modal', isOpen, () => {
    if (!loading) onClose();
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!username.trim() || !password) {
      setError('preencha usuário e senha');
      return;
    }

    if (isRegister && !name.trim()) {
      setError('informe seu nome ou apelido');
      return;
    }

    setLoading(true);
    try {
      if (isRegister) {
        await onAuthSuccess('register', {
          username: username.trim(),
          password,
          name: name.trim(),
        });
      } else {
        await onAuthSuccess('login', {
          username: username.trim(),
          password,
        });
      }
      onClose();
    } catch (err) {
      setError(err.message || 'erro de autenticação');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleCredential = async (credential) => {
    setError('');
    setLoading(true);
    try {
      await onAuthSuccess('google', { credential });
      onClose();
    } catch (err) {
      setError(err.message || 'erro ao entrar com google');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-dialog-overlay">
      <section className="app-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-dialog-title">
        <header className="app-dialog__header"><h2 id="auth-dialog-title">{isRegister ? 'criar conta' : 'entrar'}</h2><button type="button" onClick={onClose} aria-label="Fechar"><X size={20} /></button></header>
        <form onSubmit={handleSubmit} className="app-dialog__form">
          {isRegister && <label>nome ou apelido<input value={name} onChange={e => setName(e.target.value)} autoComplete="name" required autoFocus /></label>}
          <label>usuário<input value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" required autoFocus={!isRegister} /></label>
          <label>senha<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete={isRegister ? 'new-password' : 'current-password'} minLength={isRegister ? 8 : undefined} maxLength={256} required /></label>
          {error && <p className="app-dialog__error" role="alert">{error}</p>}
          <button className="app-dialog__primary" type="submit" disabled={loading}>{loading ? 'aguarde...' : isRegister ? 'criar conta' : 'entrar'}</button>
          <GoogleSignInButton
            onCredential={handleGoogleCredential}
            onError={setError}
            disabled={loading}
          />
          <button className="app-dialog__switch" type="button" onClick={() => { setIsRegister(!isRegister); setError(''); }}>{isRegister ? 'já tem conta? entrar' : 'primeira vez por aqui? criar conta'}</button>
        </form>
      </section>
    </div>
  );
}
