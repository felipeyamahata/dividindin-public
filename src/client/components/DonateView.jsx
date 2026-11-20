import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, QrCode, RefreshCw, X } from 'lucide-react';
import { encode as encodeQr } from 'uqr';
import { DEFAULT_INTRO_TEXT } from '../../domain/sustainability.js';
import { api } from '../lib/api.js';
import { formatCurrency } from '../lib/format.js';
import './DonateView.css';

const PRESET_OPTIONS = [
  { cents: 500, label: 'R$ 5' },
  { cents: 1000, label: 'R$ 10' },
];

function renderIntroContent(text) {
  const normalized = String(text || DEFAULT_INTRO_TEXT);
  return normalized.split(/(DiviDinDin!|R\$\s*\d+(?:,\d{2})?)/gi).map((part, index) => {
    if (/^DiviDinDin!$/i.test(part)) {
      return <strong key={index}>{part}</strong>;
    }
    if (/^R\$\s*\d+(?:,\d{2})?$/i.test(part)) {
      return <strong key={index} className="donate-page__intro-accent">{part}</strong>;
    }
    return <React.Fragment key={index}>{part}</React.Fragment>;
  });
}

function parseCurrencyInputToCents(raw) {
  const cleaned = String(raw || '').trim().replace(/\s+/g, '').replace(',', '.');
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 100);
}

function legacyCopyText(text) {
  const field = Object.assign(document.createElement('textarea'), { value: text });
  field.setAttribute('readonly', '');
  field.style.cssText = 'position:fixed;inset-block-start:0;opacity:0';
  document.body.append(field);
  field.select();
  try {
    return document.execCommand('copy');
  } finally {
    field.remove();
  }
}

function QrCodeSvg({ value }) {
  const pathData = useMemo(() => {
    const qr = encodeQr(value, { border: 2 });
    const parts = [];
    for (let y = 0; y < qr.size; y += 1) {
      for (let x = 0; x < qr.size; x += 1) {
        if (qr.data[y][x]) {
          parts.push(`M${x},${y}h1v1h-1z`);
        }
      }
    }
    return { size: qr.size, d: parts.join('') };
  }, [value]);

  return (
    <svg
      className="donate-page__qr-svg"
      viewBox={`0 0 ${pathData.size} ${pathData.size}`}
      role="img"
      aria-label="QR Code Pix para doação"
      shapeRendering="crispEdges"
    >
      <rect width={pathData.size} height={pathData.size} fill="#ffffff" />
      <path d={pathData.d} fill="#0b0b0b" />
    </svg>
  );
}

export function DonateView({ initialSnapshot = null, onSnapshotLoaded }) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [loading, setLoading] = useState(!initialSnapshot);
  const [loadError, setLoadError] = useState('');

  const [selectedPreset, setSelectedPreset] = useState(1000);
  const [isCustomMode, setIsCustomMode] = useState(false);
  const [customValue, setCustomValue] = useState('');
  const [amountError, setAmountError] = useState('');

  const [generating, setGenerating] = useState(false);
  const [pixError, setPixError] = useState('');
  const [pixResult, setPixResult] = useState(null);
  const [pixStatus, setPixStatus] = useState('idle'); // 'idle' | 'waiting' | 'confirmed' | 'cancelled'

  const [copyState, setCopyState] = useState('idle'); // 'idle' | 'copied' | 'failed'
  const [copyAnnouncement, setCopyAnnouncement] = useState('');
  const copyTimerRef = useRef(null);
  const lastAnnouncementRef = useRef('');

  const [fade, setFade] = useState({ top: false, bottom: false });
  const viewportRef = useRef(null);
  const customInputRef = useRef(null);
  const headingRef = useRef(null);
  const backdropPointerDownRef = useRef(false);

  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body || active.tagName === 'BUTTON') {
      headingRef.current?.focus({ preventScroll: true });
    }
  }, []);

  const updateFade = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    setFade({
      top: el.scrollTop > 1,
      bottom: el.scrollTop + el.clientHeight < el.scrollHeight - 1,
    });
  }, []);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(updateFade);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    updateFade();
    return () => observer.disconnect();
  }, [updateFade, snapshot, loading, loadError]);

  const fetchSnapshot = useCallback(async () => {
    setLoadError('');
    try {
      const data = await api.getSustainability();
      setSnapshot(data);
      onSnapshotLoaded?.(data);
    } catch (err) {
      setLoadError(err.message || 'Não foi possível carregar os dados do mês.');
    } finally {
      setLoading(false);
    }
  }, [onSnapshotLoaded]);

  useEffect(() => {
    fetchSnapshot();
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, [fetchSnapshot]);

  useEffect(() => {
    updateFade();
  }, [snapshot, pixResult, isCustomMode, updateFade]);

  const activeAmountCents = useMemo(() => {
    if (isCustomMode) {
      return parseCurrencyInputToCents(customValue);
    }
    return selectedPreset;
  }, [isCustomMode, customValue, selectedPreset]);


  const handleSelectPreset = (cents) => {
    setIsCustomMode(false);
    setSelectedPreset(cents);
    setAmountError('');
    setPixError('');
    setPixResult(null);
    setPixStatus('idle');
  };

  const handleSelectCustom = () => {
    setIsCustomMode(true);
    setAmountError('');
    setPixError('');
    setPixResult(null);
    setPixStatus('idle');
    requestAnimationFrame(() => customInputRef.current?.focus());
  };

  const handleCustomBlur = () => {
    if (!isCustomMode || !customValue.trim()) return;
    const cents = parseCurrencyInputToCents(customValue);
    if (!cents || cents < 100) {
      setAmountError('informe um valor a partir de R$ 1,00.');
    }
  };

  useEffect(() => {
    if (!pixResult || pixResult.mode !== 'mercadopago' || !pixResult.paymentId || pixStatus !== 'waiting') {
      return undefined;
    }

    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 150;

    const pollStatus = async () => {
      if (cancelled) return;
      attempts += 1;
      try {
        const res = await api.getSustainabilityPixStatus(pixResult.paymentId);
        if (cancelled) return;
        if (res.status === 'confirmed') {
          setPixStatus('confirmed');
          if (res.snapshot) {
            setSnapshot(res.snapshot);
            onSnapshotLoaded?.(res.snapshot);
          } else {
            fetchSnapshot();
          }
          return;
        }
        if (res.status === 'cancelled') {
          setPixStatus('cancelled');
          return;
        }
      } catch {
        // Keep polling quietly on transient network errors
      }
      if (!cancelled && attempts < maxAttempts) {
        timerId = window.setTimeout(pollStatus, 4000);
      }
    };

    let timerId = window.setTimeout(pollStatus, 4000);
    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  }, [pixResult, pixStatus, fetchSnapshot, onSnapshotLoaded]);

  const handleGeneratePix = async (event) => {
    event.preventDefault();
    setPixError('');
    setAmountError('');

    const cents = activeAmountCents;
    if (!cents || cents < 100 || cents > 100_000_000) {
      setAmountError('informe um valor entre R$ 1,00 e R$ 1.000.000,00.');
      customInputRef.current?.focus();
      return;
    }

    setGenerating(true);
    try {
      const result = await api.createSustainabilityPix(cents);
      setPixResult(result);
      setPixStatus(result.mode === 'mercadopago' && result.paymentId ? 'waiting' : 'idle');
      setCopyState('idle');
      setCopyAnnouncement('');
    } catch (err) {
      setPixError(err.message || 'Não foi possível gerar o código Pix.');
    } finally {
      setGenerating(false);
    }
  };

  const handleCopyPix = async () => {
    if (!pixResult?.payload) return;
    clearTimeout(copyTimerRef.current);

    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(pixResult.payload);
        ok = true;
      } else {
        ok = legacyCopyText(pixResult.payload);
      }
    } catch {
      try {
        ok = legacyCopyText(pixResult.payload);
      } catch {
        ok = false;
      }
    }

    let message = ok ? 'código pix copiado!' : 'não foi possível copiar.';
    if (message === lastAnnouncementRef.current) {
      message += '\u00A0';
    }
    lastAnnouncementRef.current = message;

    setCopyState(ok ? 'copied' : 'failed');
    setCopyAnnouncement('');
    requestAnimationFrame(() => setCopyAnnouncement(message));

    copyTimerRef.current = setTimeout(() => {
      setCopyState('idle');
      setCopyAnnouncement('');
    }, 2400);
  };

  const handleClosePixDialog = useCallback(() => {
    setPixResult(null);
    setPixStatus('idle');
    setCopyState('idle');
    setCopyAnnouncement('');
  }, []);

  const fadeClass = [
    'donate-page__viewport',
    fade.top ? 'donate-page__viewport--top' : '',
    fade.bottom ? 'donate-page__viewport--bottom' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className="donate-page">
      <div
        ref={viewportRef}
        className={fadeClass}
        onScroll={updateFade}
        tabIndex={0}
        aria-label="Meta do mês, sobre o projeto e custos"
      >
        <div className="donate-page__scroll-body">
          <h1 ref={headingRef} tabIndex={-1} className="donate-page__page-title">
            apoie!
          </h1>

          {loading ? (
            <div className="donate-page__card" role="status">
              <p className="donate-page__muted">carregando meta do mês...</p>
            </div>
          ) : loadError ? (
            <div className="donate-page__card">
              <p className="donate-page__error" role="alert">{loadError}</p>
              <button type="button" className="donate-page__retry" onClick={fetchSnapshot}>
                <RefreshCw size={16} aria-hidden="true" />
                tentar novamente
              </button>
            </div>
          ) : (
            <section className="donate-page__card donate-page__goal-card" aria-labelledby="donate-goal-heading">
              <div className="donate-page__goal-head">
                <span id="donate-goal-heading" className="donate-page__goal-label">
                  meta de {snapshot.monthLabel}
                </span>
                <strong className="donate-page__goal-total">
                  {formatCurrency(snapshot.goalCents)}
                </strong>
              </div>

              <progress
                className="donate-page__progress"
                value={snapshot.clampedPercent}
                max={100}
                aria-labelledby="donate-goal-heading"
                aria-valuetext={`${Math.round(snapshot.rawPercent)}% da meta (${formatCurrency(snapshot.confirmedCents)} de ${formatCurrency(snapshot.goalCents)})`}
              />

              <div className="donate-page__goal-foot">
                <span>
                  <strong>{formatCurrency(snapshot.confirmedCents)}</strong> arrecadado
                </span>
                {snapshot.goalCents === 0 ? (
                  <span className="donate-page__muted">custos ainda não definidos</span>
                ) : snapshot.isGoalCovered ? (
                  <span className="donate-page__covered">
                    meta coberta{snapshot.surplusCents > 0 ? ` (+${formatCurrency(snapshot.surplusCents)})` : '!'}
                  </span>
                ) : (
                  <span>
                    faltam <strong>{formatCurrency(snapshot.remainingCents)}</strong>
                  </span>
                )}
              </div>
            </section>
          )}

          <p className="donate-page__intro">
            {renderIntroContent(snapshot?.introText || DEFAULT_INTRO_TEXT)}
          </p>

          {!loading && !loadError && snapshot && (
            <section className="donate-page__section" aria-labelledby="donate-costs-heading">
              <div className="donate-page__section-head">
                <h2 id="donate-costs-heading">custos deste mês</h2>
              </div>

              {snapshot.costs.length === 0 ? (
                <div className="donate-page__card">
                  <p className="donate-page__muted">nenhum custo cadastrado neste mês ainda.</p>
                </div>
              ) : (
                <ul className="donate-page__costs">
                  {snapshot.costs.map((item) => {
                    const isUsd = item.currency === 'USD';
                    const formatUsd = (cents) => `US$ ${(cents / 100).toFixed(2).replace('.', ',')}`;
                    const annualNote =
                      item.billingCycle === 'annual'
                        ? `${isUsd ? formatUsd(item.amountCents) : formatCurrency(item.amountCents)} por ano`
                        : null;
                    const usdMonthlyCents = isUsd
                      ? item.billingCycle === 'annual'
                        ? Math.round(item.amountCents / 12)
                        : item.amountCents
                      : 0;
                    return (
                      <li key={item.id} className="donate-page__cost-row">
                        <div className="donate-page__cost-info">
                          <span className="donate-page__cost-name">{item.label}</span>
                          {annualNote && <span className="donate-page__cost-meta">{annualNote}</span>}
                        </div>
                        <div className="donate-page__cost-values">
                          <strong className="donate-page__cost-amount">
                            {formatCurrency(item.monthlyBrlCents)}
                          </strong>
                          {isUsd && (
                            <span className="donate-page__cost-meta">({formatUsd(usdMonthlyCents)})</span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}
        </div>
      </div>

      {!loading && !loadError && snapshot && (
        <footer className="donate-page__footer" aria-labelledby="donate-pix-heading">
          <div className="donate-page__section-head">
            <h2 id="donate-pix-heading">apoiar via pix</h2>
          </div>

          <form className="donate-page__card donate-page__form" onSubmit={handleGeneratePix} noValidate>
            <div className="donate-page__presets" role="group" aria-label="Valores sugeridos para doação">
              {PRESET_OPTIONS.map(({ cents, label }) => (
                <button
                  key={cents}
                  type="button"
                  className={`donate-page__preset${!isCustomMode && selectedPreset === cents ? ' is-selected' : ''}`}
                  onClick={() => handleSelectPreset(cents)}
                >
                  {label}
                </button>
              ))}
              <button
                type="button"
                className={`donate-page__preset${isCustomMode ? ' is-selected' : ''}`}
                onClick={handleSelectCustom}
              >
                outro
              </button>
            </div>

            {isCustomMode && (
              <div className="donate-page__custom-field">
                <label htmlFor="donate-custom-amount">valor em reais (R$)</label>
                <input
                  ref={customInputRef}
                  id="donate-custom-amount"
                  name="amount"
                  type="text"
                  inputMode="decimal"
                  enterKeyHint="done"
                  placeholder="15,00"
                  value={customValue}
                  aria-invalid={amountError ? 'true' : undefined}
                  aria-describedby={amountError ? 'donate-amount-error' : undefined}
                  onChange={(e) => {
                    setCustomValue(e.target.value);
                    if (amountError) setAmountError('');
                    if (pixResult) setPixResult(null);
                  }}
                  onBlur={handleCustomBlur}
                />
                {amountError && (
                  <p id="donate-amount-error" className="donate-page__error" role="alert">{amountError}</p>
                )}
              </div>
            )}

            {!snapshot.pixEnabled && (
              <p className="donate-page__muted">chave pix ainda em configuração neste ambiente.</p>
            )}

            {pixError && (
              <p className="donate-page__error" role="alert">{pixError}</p>
            )}

            <button
              type="submit"
              className="donate-page__submit"
              disabled={generating || !snapshot.pixEnabled}
            >
              <QrCode size={18} aria-hidden="true" />
              {generating
                ? 'gerando pix...'
                : activeAmountCents
                  ? `gerar pix de ${formatCurrency(activeAmountCents)}`
                  : 'gerar código pix'}
            </button>
          </form>
        </footer>
      )}

      {pixResult && (
        <div
          className="donate-dialog__overlay"
          onPointerDown={(e) => { backdropPointerDownRef.current = e.target === e.currentTarget; }}
          onClick={(e) => {
            const shouldClose = backdropPointerDownRef.current && e.target === e.currentTarget;
            backdropPointerDownRef.current = false;
            if (shouldClose) handleClosePixDialog();
          }}
          onKeyDown={(e) => { if (e.key === 'Escape') handleClosePixDialog(); }}
        >
          <section
            className="donate-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="donate-pix-dialog-title"
          >
            <div className="donate-dialog__heading">
              <h2 id="donate-pix-dialog-title">pix de apoio</h2>
              <button type="button" onClick={handleClosePixDialog} aria-label="Fechar">
                <X size={20} />
              </button>
            </div>

            {pixStatus === 'confirmed' ? (
              <div className="donate-dialog__confirmed">
                <div className="donate-page__pix-status donate-page__pix-status--confirmed" role="status">
                  <Check size={20} aria-hidden="true" />
                  <div>
                    <strong>doação de {formatCurrency(pixResult.amountCents)} confirmada!</strong>
                    <p>obrigado por ajudar a manter o divide no ar. o progresso do mês já foi atualizado.</p>
                  </div>
                </div>
                <button type="button" className="donate-page__submit" onClick={handleClosePixDialog}>
                  fechar
                </button>
              </div>
            ) : (
              <div className="donate-page__qr-card">
                <div className="donate-page__qr-box">
                  <QrCodeSvg value={pixResult.payload} />
                </div>
                <div className="donate-page__qr-meta">
                  <strong>{formatCurrency(pixResult.amountCents)}</strong>
                  <span>{pixResult.merchantName} · {pixResult.pixKeyMasked}</span>
                </div>
                {pixStatus === 'waiting' && (
                  <div className="donate-page__pix-status donate-page__pix-status--waiting" role="status">
                    <span className="donate-page__pulse" aria-hidden="true" />
                    <span>aguardando confirmação automática do pix...</span>
                  </div>
                )}
                {pixStatus === 'cancelled' && (
                  <div className="donate-page__pix-status donate-page__pix-status--cancelled" role="status">
                    <span>este código pix expirou ou foi cancelado. feche e gere um novo se quiser tentar novamente.</span>
                  </div>
                )}
                <code className="donate-page__pix-code" id="donate-pix-payload">
                  {pixResult.payload}
                </code>
                <div className="donate-page__copy-wrap">
                  <button
                    type="button"
                    className="donate-page__copy-btn"
                    data-copied={copyState === 'copied' ? '' : undefined}
                    data-failed={copyState === 'failed' ? '' : undefined}
                    onClick={handleCopyPix}
                  >
                    {copyState === 'copied'
                      ? <Check size={17} aria-hidden="true" />
                      : <Copy size={17} aria-hidden="true" />}
                    {copyState === 'copied' ? 'código pix copiado' : 'copiar código pix'}
                  </button>
                  <span className="donate-page__copy-status" role="status" aria-live="polite">
                    {copyAnnouncement}
                  </span>
                </div>
                <p className="donate-page__qr-note">
                  {pixResult.mode === 'mercadopago'
                    ? 'pague no app do seu banco com qr code ou pix copia e cola. a barra atualiza automaticamente em segundos.'
                    : 'pague no app do seu banco com qr code ou pix copia e cola. o total arrecadado é atualizado após conferência.'}
                </p>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
