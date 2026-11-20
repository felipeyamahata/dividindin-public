import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useBackLayer } from '../lib/useHistoryNavigation.js';
import { useKeyboardFocusAnchor } from '../lib/useKeyboardFocusAnchor.js';
import './NewEventModal.css';

export function NewEventModal({ isOpen, onClose, onCreateEvent }) {
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const {
    isAnchored: isFocused,
    visibleHeight,
    containerProps,
  } = useKeyboardFocusAnchor({ isOpen });

  useEffect(() => {
    if (!isOpen) {
      setTitle('');
      setError('');
      setLoading(false);
    }
  }, [isOpen]);

  useBackLayer('new-event-modal', isOpen, () => {
    if (!loading) onClose();
  });

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('informe o título do evento');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await onCreateEvent(title.trim());
      setTitle('');
      onClose();
    } catch (err) {
      setError(err.message || 'erro ao criar evento');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className={`new-event-overlay${isFocused ? ' new-event-overlay--focused' : ''}`}
      style={visibleHeight ? { '--event-visible-height': `${visibleHeight}px` } : undefined}
    >
      <section className="new-event-modal" role="dialog" aria-modal="true" aria-labelledby="new-event-title" {...containerProps}>
        <header className="new-event-modal__header">
          <h2 id="new-event-title">novo evento</h2>
          <button type="button" onClick={onClose} className="new-event-modal__close" aria-label="Fechar"><X size={20} aria-hidden="true" /></button>
        </header>
        {error && <p className="new-event-modal__error" role="alert">{error}</p>}
        <form onSubmit={handleSubmit} className="new-event-modal__form">
          <label>nome do evento<input type="text" placeholder="ex: viagem, churrasco, apê" value={title} onChange={(e) => setTitle(e.target.value)} required /></label>
          <button type="submit" disabled={loading || !title.trim()}>{loading ? 'criando...' : 'criar evento'}</button>
        </form>
      </section>
    </div>
  );
}
