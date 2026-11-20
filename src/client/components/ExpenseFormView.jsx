import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { formatCurrency } from '../lib/format.js';
import { calculateSharesAllocation, deriveSharesFromAmounts } from '../../domain/shares.js';
import { getDirectPairBalances } from '../../domain/settlement.js';
import { ParticipantAvatar } from './ParticipantAvatars.jsx';
import { ParticipantName } from './ParticipantName.jsx';
import './ExpenseForm.css';
import './ExpenseFormView.css';

export function ExpenseFormView({
  participants = [],
  currentParticipant,
  editingExpense = null,
  editingSettlement = null,
  simplifiedTransactions = [],
  initialEntry = null,
  onBack,
  onSubmit,
  onSubmitPayment,
}) {
  const scrollRef = useRef(null);
  const [fade, setFade] = useState({ top: false, bottom: false });

  const [entryMode, setEntryMode] = useState('expense');
  const [description, setDescription] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [payerId, setPayerId] = useState('');
  const [recipientId, setRecipientId] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');

  // Split Strategy Steps:
  // Step 1: 'EQUAL' vs 'CUSTOM'
  const [splitKind, setSplitKind] = useState('EQUAL');
  // Step 2: 'ALL' vs 'SOME'
  const [scope, setScope] = useState('ALL');
  // Step 3 (if CUSTOM): 'SHARES' | 'EXACT' | 'PERCENT'
  const [customMode, setCustomMode] = useState('SHARES');

  // Participants included in the split
  const [selectedParticipants, setSelectedParticipants] = useState([]);

  // Split details
  const [exactAmounts, setExactAmounts] = useState({});
  const [percentages, setPercentages] = useState({});
  const [shares, setShares] = useState({});
  const [fallbackShare, setFallbackShare] = useState(1);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const updateFade = useCallback(() => {
    const el = scrollRef.current;
    if (el) {
      setFade({
        top: el.scrollTop > 1,
        bottom: el.scrollTop + el.clientHeight < el.scrollHeight - 1,
      });
    }
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(updateFade);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    updateFade();
    return () => observer.disconnect();
  }, [updateFade, entryMode, splitKind, scope, customMode]);

  // Initialize or pre-fill state
  useEffect(() => {
    if (editingExpense) {
      setEntryMode('expense');
      setDescription(editingExpense.description || '');
      setAmountStr(editingExpense.amount ? String(editingExpense.amount) : '');
      setPayerId(editingExpense.payer_id || '');

      const expSplits = editingExpense.splits || [];
      const splitMode = editingExpense.split_mode;

      if (splitMode === 'EQUAL_ALL') {
        setSplitKind('EQUAL');
        setScope('ALL');
        setSelectedParticipants(participants.map(p => p.id));
      } else if (splitMode === 'SUBSET_EQUAL') {
        setSplitKind('EQUAL');
        setScope('SOME');
        setSelectedParticipants(expSplits.map(s => s.participant_id));
      } else if (splitMode === 'EXACT_AMOUNTS') {
        setSplitKind('CUSTOM');
        setCustomMode('EXACT');
        const splitIds = expSplits.map(s => s.participant_id);
        setScope(splitIds.length === participants.length ? 'ALL' : 'SOME');
        setSelectedParticipants(splitIds);
        const map = {};
        const mapPct = {};
        const total = editingExpense.amount || 0;
        for (const s of expSplits) {
          map[s.participant_id] = String(s.allocated_amount);
          if (total > 0 && s.allocated_amount) {
            const pct = (s.allocated_amount / total) * 100;
            mapPct[s.participant_id] = pct % 1 === 0 ? String(pct) : pct.toFixed(2).replace('.', ',');
          }
        }
        setExactAmounts(map);
        setPercentages(mapPct);
      } else if (splitMode === 'PERCENTAGES') {
        setSplitKind('CUSTOM');
        setCustomMode('PERCENT');
        const splitIds = expSplits.map(s => s.participant_id);
        setScope(splitIds.length === participants.length ? 'ALL' : 'SOME');
        setSelectedParticipants(splitIds);
        const map = {};
        const mapExact = {};
        const total = editingExpense.amount || 0;
        for (const s of expSplits) {
          map[s.participant_id] = String(s.percentage || '');
          if (total > 0 && s.percentage) {
            mapExact[s.participant_id] = String(Math.round((total * s.percentage) / 100));
          }
        }
        setPercentages(map);
        setExactAmounts(mapExact);
      } else if (splitMode === 'SHARES') {
        setSplitKind('CUSTOM');
        setCustomMode('SHARES');
        const splitIds = expSplits.map(s => s.participant_id);
        setScope(splitIds.length === participants.length ? 'ALL' : 'SOME');
        setSelectedParticipants(splitIds);
        const map = {};
        for (const s of expSplits) {
          map[s.participant_id] = Number(s.shares) || 1;
        }
        setShares(map);
      }
    } else if (editingSettlement) {
      setEntryMode('payment');
      setDescription('');
      setAmountStr(editingSettlement.amount ? String(editingSettlement.amount) : '');
      setPayerId(editingSettlement.from_participant_id || '');
      setRecipientId(editingSettlement.to_participant_id || '');
      setPaymentNotes(editingSettlement.notes || '');
      setError('');
    } else {
      // New entry defaults
      const defaultPayer = initialEntry?.payerId || currentParticipant?.id || participants[0]?.id || '';
      setEntryMode(initialEntry?.mode === 'payment' ? 'payment' : 'expense');
      setDescription('');
      setAmountStr(initialEntry?.amount ? String(initialEntry.amount) : '');
      setPayerId(defaultPayer);
      setRecipientId(initialEntry?.recipientId && initialEntry.recipientId !== defaultPayer ? initialEntry.recipientId : '');
      setPaymentNotes(initialEntry?.notes || '');
      setSplitKind('EQUAL');
      setScope('ALL');
      setCustomMode('SHARES');
      setSelectedParticipants(participants.map(p => p.id));
      setShares({});
      setFallbackShare(1);
      setExactAmounts({});
      setPercentages({});
    }
  }, [editingExpense, editingSettlement, initialEntry, participants, currentParticipant]);

  const handleScopeChange = (nextScope) => {
    setScope(nextScope);
    if (nextScope === 'SOME') {
      setSelectedParticipants([]);
      setExactAmounts({});
      setPercentages({});
    } else if (nextScope === 'ALL') {
      setSelectedParticipants(participants.map(p => p.id));
      setExactAmounts({});
      setPercentages({});
    }
  };

  const isAllSelected = participants.length > 0 && selectedParticipants.length === participants.length;

  const handleToggleAll = () => {
    if (isAllSelected) {
      setSelectedParticipants([]);
      setExactAmounts({});
      setPercentages({});
    } else {
      setSelectedParticipants(participants.map(p => p.id));
    }
  };

  const handleToggleParticipant = (id) => {
    if (selectedParticipants.includes(id)) {
      setSelectedParticipants(selectedParticipants.filter(p => p !== id));
      setExactAmounts(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setPercentages(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } else {
      setSelectedParticipants([...selectedParticipants, id]);
    }
  };

  const activeParticipants = scope === 'ALL'
    ? participants
    : participants.filter(p => selectedParticipants.includes(p.id));

  const activeParticipantIds = useMemo(() => activeParticipants.map(p => p.id), [activeParticipants]);
  const currentTotalCents = Number(amountStr) || 0;

  // Fractional shares calculation and deterministic allocation
  const sharesAllocationMap = useMemo(() => {
    return calculateSharesAllocation(currentTotalCents, activeParticipantIds, shares, fallbackShare);
  }, [currentTotalCents, activeParticipantIds, shares, fallbackShare]);

  const totalShares = useMemo(() => {
    return activeParticipants.reduce((sum, p) => {
      const alloc = sharesAllocationMap[p.id];
      return sum + (alloc ? alloc.share : (fallbackShare || 1));
    }, 0);
  }, [activeParticipants, sharesAllocationMap, fallbackShare]);

  // Sync exactAmounts and percentages from shares ONLY for manual participants!
  const syncCustomFromShares = useCallback((sharesToUse, currentFbShare = 1) => {
    if (currentTotalCents <= 0 || activeParticipantIds.length === 0) return;
    const allocMap = calculateSharesAllocation(currentTotalCents, activeParticipantIds, sharesToUse, currentFbShare);
    const nextExact = {};
    const nextPct = {};
    for (const p of activeParticipants) {
      const alloc = allocMap[p.id];
      if (alloc && alloc.isManual) {
        nextExact[p.id] = String(alloc.cents);
        nextPct[p.id] = alloc.percentage % 1 === 0
          ? String(alloc.percentage)
          : alloc.percentage.toFixed(2).replace('.', ',');
      }
    }
    setExactAmounts(nextExact);
    setPercentages(nextPct);
  }, [currentTotalCents, activeParticipantIds, activeParticipants]);

  // Stepper & input handlers for fractional shares
  const handleShareStep = (personId, delta) => {
    const alloc = sharesAllocationMap[personId];
    const isManual = shares[personId] !== undefined && shares[personId] !== '';
    const current = isManual ? Math.max(1, Math.floor(Number(shares[personId])) || 1) : (alloc ? alloc.share : fallbackShare);
    const next = current + delta;
    if (next < 1 || (next <= fallbackShare && isManual && delta < 0)) {
      // Revert to fallback mode when stepping down below baseline
      setShares(prev => {
        const nextShares = { ...prev };
        delete nextShares[personId];
        syncCustomFromShares(nextShares, fallbackShare);
        return nextShares;
      });
      return;
    }
    const nextShares = { ...shares, [personId]: next };
    setShares(nextShares);
    syncCustomFromShares(nextShares, fallbackShare);
  };

  const handleShareInputChange = (personId, rawValue) => {
    const digits = rawValue.replace(/\D/g, '').slice(0, 3);
    if (digits === '') {
      // Deleting all digits returns participant to fallback mode!
      setShares(prev => {
        const nextShares = { ...prev };
        delete nextShares[personId];
        syncCustomFromShares(nextShares, fallbackShare);
        return nextShares;
      });
      return;
    }
    const next = Math.max(1, parseInt(digits, 10));
    const nextShares = { ...shares, [personId]: next };
    setShares(nextShares);
    syncCustomFromShares(nextShares, fallbackShare);
  };

  const handleShareBlur = (personId) => {
    if (shares[personId] !== undefined && shares[personId] !== '') {
      const num = Number(shares[personId]);
      if (!Number.isSafeInteger(num) || num < 1) {
        setShares(prev => {
          const nextShares = { ...prev };
          delete nextShares[personId];
          syncCustomFromShares(nextShares, fallbackShare);
          return nextShares;
        });
      }
    }
  };

  // Progressive currency & percentage sync handlers
  const handleExactChange = (id, rawValue) => {
    const digits = rawValue.replace(/\D/g, '').replace(/^0+/, '').slice(0, 10);
    if (!digits) {
      setExactAmounts(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setPercentages(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setShares(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      return;
    }
    const cents = Number(digits);
    setExactAmounts(prev => ({ ...prev, [id]: digits }));
    if (currentTotalCents > 0) {
      const pct = (cents / currentTotalCents) * 100;
      const pctStr = pct % 1 === 0 ? String(pct) : pct.toFixed(2).replace('.', ',');
      setPercentages(prev => ({ ...prev, [id]: pctStr }));
    }
  };

  const handlePercentageChange = (id, rawValue) => {
    const cleaned = rawValue.replace(/[^0-9.,]/g, '').replace('.', ',');
    if (!cleaned) {
      setPercentages(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setExactAmounts(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setShares(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      return;
    }
    setPercentages(prev => ({ ...prev, [id]: cleaned }));
    const pctNum = parseFloat(cleaned.replace(',', '.')) || 0;
    if (currentTotalCents > 0) {
      const cents = Math.round((currentTotalCents * pctNum) / 100);
      const centsDigits = cents > 0 ? String(cents) : '';
      setExactAmounts(prev => ({ ...prev, [id]: centsDigits }));
    }
  };

  // Participant allocation: manual vs fallback
  const manualParticipants = activeParticipants.filter(p => exactAmounts[p.id] !== undefined && exactAmounts[p.id] !== '');
  const fallbackParticipants = activeParticipants.filter(p => exactAmounts[p.id] === undefined || exactAmounts[p.id] === '');

  const manualSumCents = manualParticipants.reduce((sum, p) => sum + (Number(exactAmounts[p.id]) || 0), 0);
  const remainingCents = Math.max(0, currentTotalCents - manualSumCents);

  const fallbackCentsMap = {};
  const fallbackPctMap = {};
  if (fallbackParticipants.length > 0) {
    const count = fallbackParticipants.length;
    const baseCents = Math.floor(remainingCents / count);
    const remainder = remainingCents % count;
    fallbackParticipants.forEach((p, idx) => {
      const allocatedCents = baseCents + (idx < remainder ? 1 : 0);
      fallbackCentsMap[p.id] = allocatedCents;
      if (currentTotalCents > 0) {
        fallbackPctMap[p.id] = (allocatedCents / currentTotalCents) * 100;
      } else {
        fallbackPctMap[p.id] = 100 / (activeParticipants.length || 1);
      }
    });
  }

  // Display formatting helpers
  const formatCentsDigits = (cents) => {
    if (!cents || cents <= 0) return '0,00';
    return (cents / 100).toFixed(2).replace('.', ',');
  };

  const formatPctDigits = (pct) => {
    if (pct === undefined || pct === null || pct <= 0) return '0';
    return pct % 1 === 0 ? String(pct) : pct.toFixed(2).replace('.', ',');
  };

  // Mirror custom split modes when switching tabs
  const handleCustomModeChange = (nextMode) => {
    if (nextMode === customMode) return;

    if (nextMode === 'SHARES') {
      const effectiveCents = {};
      const manualIds = [];
      for (const p of activeParticipants) {
        if (exactAmounts[p.id] !== undefined && exactAmounts[p.id] !== '') {
          effectiveCents[p.id] = Number(exactAmounts[p.id]) || 0;
          manualIds.push(p.id);
        } else {
          effectiveCents[p.id] = fallbackCentsMap[p.id] || 0;
        }
      }
      const { shares: derivedShares, fallbackShare: derivedFallback } = deriveSharesFromAmounts(
        activeParticipantIds,
        effectiveCents,
        currentTotalCents,
        manualIds
      );
      setShares(derivedShares);
      setFallbackShare(derivedFallback);
    } else {
      // Switching to EXACT or PERCENT from SHARES (only sync manual participants)
      if (customMode === 'SHARES' && currentTotalCents > 0) {
        syncCustomFromShares(shares, fallbackShare);
      }
    }

    setCustomMode(nextMode);
  };

  // Keep mirrored values aligned when amount changes in shares mode (only for manual entries!)
  useEffect(() => {
    if (splitKind === 'CUSTOM' && customMode === 'SHARES' && currentTotalCents > 0) {
      syncCustomFromShares(shares, fallbackShare);
    }
  }, [currentTotalCents, splitKind, customMode, shares, fallbackShare, syncCustomFromShares]);

  // Real-time split balance check
  let isSplitWarning = false;
  let splitWarningMessage = '';

  if (splitKind === 'CUSTOM') {
    if (customMode === 'EXACT') {
      if (manualSumCents > currentTotalCents) {
        isSplitWarning = true;
        const diff = manualSumCents - currentTotalCents;
        splitWarningMessage = `ultrapassa em ${formatCurrency(diff)}`;
      } else if (fallbackParticipants.length === 0 && manualSumCents < currentTotalCents) {
        isSplitWarning = true;
        const diff = currentTotalCents - manualSumCents;
        splitWarningMessage = `falta ${formatCurrency(diff)}`;
      }
    } else if (customMode === 'PERCENT') {
      const manualSumPct = manualParticipants.reduce((sum, p) => {
        const val = parseFloat((percentages[p.id] || '0').replace(',', '.')) || 0;
        return sum + val;
      }, 0);
      const roundedManualPct = Math.round(manualSumPct * 100) / 100;
      if (roundedManualPct > 100) {
        isSplitWarning = true;
        const diff = (roundedManualPct - 100).toFixed(roundedManualPct % 1 === 0 ? 0 : 1).replace('.', ',');
        splitWarningMessage = `ultrapassa em ${diff}%`;
      } else if (fallbackParticipants.length === 0 && roundedManualPct < 100) {
        isSplitWarning = true;
        const diff = (100 - roundedManualPct).toFixed(roundedManualPct % 1 === 0 ? 0 : 1).replace('.', ',');
        splitWarningMessage = `falta ${diff}%`;
      }
    }
  }

  const pairBalances = useMemo(
    () => getDirectPairBalances(payerId, participants, simplifiedTransactions),
    [payerId, participants, simplifiedTransactions],
  );
  const recipientOptions = useMemo(
    () => participants.filter(person => person.id !== payerId),
    [participants, payerId],
  );
  const selectedRecipient = useMemo(
    () => recipientOptions.find(person => person.id === recipientId) || null,
    [recipientOptions, recipientId],
  );
  const selectedRecipientBalance = selectedRecipient ? pairBalances.get(selectedRecipient.id) : null;

  const isPaymentMode = Boolean(editingSettlement) || (!editingExpense && entryMode === 'payment');

  const isSubmitDisabled = loading ||
    currentTotalCents <= 0 ||
    (isPaymentMode
      ? !selectedRecipient
      : (scope === 'SOME' && selectedParticipants.length === 0) || isSplitWarning);

  const submitButtonText = loading
    ? 'salvando...'
    : editingSettlement
    ? 'salvar alterações'
    : isPaymentMode
    ? 'confirmar pagamento'
    : isSplitWarning
    ? splitWarningMessage
    : editingExpense
    ? 'salvar alterações'
    : 'confirmar despesa';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (currentTotalCents <= 0) {
      setError('informe um valor válido maior que zero');
      return;
    }

    if (isPaymentMode) {
      if (!payerId || !selectedRecipient || payerId === selectedRecipient.id) {
        setError('selecione participantes diferentes para pagar e receber');
        return;
      }
      setLoading(true);
      try {
        await onSubmitPayment?.({
          id: editingSettlement?.id,
          fromParticipantId: payerId,
          toParticipantId: selectedRecipient.id,
          amount: currentTotalCents,
          notes: paymentNotes.trim(),
        });
        onBack();
      } catch (err) {
        setError(err.message || 'erro ao registrar pagamento');
      } finally {
        setLoading(false);
      }
      return;
    }

    if (!description.trim()) {
      setError('informe a descrição do gasto');
      return;
    }

    if (!payerId) {
      setError('selecione quem pagou a conta');
      return;
    }

    if (scope === 'SOME' && activeParticipants.length === 0) {
      setError('selecione pelo menos um participante para a divisão');
      return;
    }

    let resolvedSplitMode = 'EQUAL_ALL';
    let resolvedSplits = [];

    if (splitKind === 'EQUAL') {
      if (scope === 'ALL') {
        resolvedSplitMode = 'EQUAL_ALL';
        resolvedSplits = [];
      } else {
        resolvedSplitMode = 'SUBSET_EQUAL';
        resolvedSplits = activeParticipants.map(p => ({ participant_id: p.id }));
      }
    } else {
      if (customMode === 'SHARES') {
        resolvedSplitMode = 'SHARES';
        resolvedSplits = activeParticipants.map(p => {
          const alloc = sharesAllocationMap[p.id];
          return {
            participant_id: p.id,
            shares: alloc ? alloc.share : (fallbackShare || 1),
          };
        });
      } else if (customMode === 'EXACT') {
        resolvedSplitMode = 'EXACT_AMOUNTS';
        let sum = 0;
        resolvedSplits = activeParticipants.map(p => {
          const isManual = exactAmounts[p.id] !== undefined && exactAmounts[p.id] !== '';
          const cents = isManual ? Number(exactAmounts[p.id]) || 0 : fallbackCentsMap[p.id] || 0;
          sum += cents;
          return { participant_id: p.id, allocated_amount: cents };
        }).filter(s => s.allocated_amount > 0);

        if (sum !== currentTotalCents) {
          setError(`A soma dos valores (${formatCurrency(sum)}) deve ser igual ao total (${formatCurrency(currentTotalCents)})`);
          return;
        }
      } else if (customMode === 'PERCENT') {
        resolvedSplitMode = 'PERCENTAGES';
        let sumPct = 0;
        const manualSumPct = manualParticipants.reduce((acc, p) => acc + (parseFloat((percentages[p.id] || '0').replace(',', '.')) || 0), 0);
        const remainingPct = Math.max(0, 100 - manualSumPct);
        const fallbackCount = fallbackParticipants.length;

        resolvedSplits = activeParticipants.map(p => {
          const isManual = percentages[p.id] !== undefined && percentages[p.id] !== '';
          let pct = 0;
          if (isManual) {
            pct = parseFloat((percentages[p.id] || '0').replace(',', '.')) || 0;
          } else {
            pct = fallbackCount > 0 ? remainingPct / fallbackCount : 0;
          }
          sumPct += pct;
          return { participant_id: p.id, percentage: pct };
        }).filter(s => s.percentage > 0);

        if (Math.abs(sumPct - 100) > 0.000001) {
          setError(`A soma das porcentagens deve ser exatamente 100%`);
          return;
        }
      }
    }

    setLoading(true);
    try {
      await onSubmit({
        id: editingExpense?.id,
        description: description.trim(),
        amount: currentTotalCents,
        payerId,
        splitMode: resolvedSplitMode,
        splits: resolvedSplits,
      });
      onBack();
    } catch (err) {
      setError(err.message || 'erro ao salvar gasto');
    } finally {
      setLoading(false);
    }
  };

  const payer = participants.find(person => person.id === payerId);
  const orderedParticipants = [...participants].sort((a, b) => Number(b.id === currentParticipant?.id) - Number(a.id === currentParticipant?.id));
  const segments = (options, value, onChange, label) => (
    <div
      className={`expense-form__segments${options.length === 3 ? ' expense-form__segments--three' : ''}`}
      data-index={options.findIndex(option => option.value === value)}
      role="group"
      aria-label={label}
    >
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );

  return (
    <form onSubmit={handleSubmit} className="expense-page__form expense-form">
          <div
            ref={scrollRef}
            onScroll={updateFade}
            className={`expense-page__viewport${fade.top ? ' expense-page__viewport--top' : ''}${fade.bottom ? ' expense-page__viewport--bottom' : ''}`}
            tabIndex={0}
            aria-label="Formulário de lançamento"
          >
            <div className="expense-page__content">
              {!editingExpense && !editingSettlement && (
                <div className="expense-field">
                  {segments(
                    [
                      { value: 'expense', label: 'despesa' },
                      { value: 'payment', label: 'pagamento' },
                    ],
                    entryMode,
                    (nextMode) => {
                      setEntryMode(nextMode);
                      setError('');
                    },
                    'tipo de lançamento',
                  )}
                </div>
              )}

              {/* Campo: valor */}
              <div className="expense-field">
                <label htmlFor="expense-amount" className="expense-field__label">
                  valor
                </label>
                <div className="expense-field__amount-box">
                  <input
                    id="expense-amount"
                    type="text"
                    inputMode="numeric"
                    placeholder="R$ 0,00"
                    className="expense-field__amount-input"
                    value={amountStr ? formatCurrency(currentTotalCents) : ''}
                    onChange={e => setAmountStr(e.target.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 12))}
                    autoFocus={!editingExpense && !editingSettlement && entryMode === 'expense'}
                  />
                </div>
                {!editingSettlement && isPaymentMode && selectedRecipientBalance?.direction === 'pay' && selectedRecipientBalance.amount > 0 && (
                  <button
                    type="button"
                    className="expense-form__settle-btn"
                    onClick={() => setAmountStr(String(selectedRecipientBalance.amount))}
                  >
                    quitar dívida atual · {formatCurrency(selectedRecipientBalance.amount)}
                  </button>
                )}
              </div>

              {isPaymentMode ? (
                <>
                  {/* Campo: quem pagou? */}
                  <div className="expense-field">
                    <span className="expense-field__label">quem pagou?</span>
                    <details
                      className="expense-form__payer-menu"
                      onBlur={e => {
                        if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.open = false;
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Escape') {
                          e.currentTarget.open = false;
                          e.currentTarget.querySelector('summary')?.focus();
                        }
                      }}
                    >
                      <summary className="expense-form__payer" aria-label="quem pagou?">
                        {payer && <ParticipantAvatar participant={payer} className="expense-form__payer-avatar" />}
                        <span className="expense-form__payer-name">
                          <ParticipantName
                            participant={payer}
                            name={payer?.name || 'selecione um participante'}
                            suffix={payerId === currentParticipant?.id ? ' (você)' : ''}
                          />
                        </span>
                        <ChevronDown size={18} aria-hidden="true" />
                      </summary>
                      <div className="expense-form__payer-options" aria-label="Participantes">
                        {orderedParticipants.map(person => (
                          <button
                            type="button"
                            key={person.id}
                            onClick={e => {
                              setPayerId(person.id);
                              if (recipientId === person.id) setRecipientId('');
                              const menu = e.currentTarget.closest('details');
                              if (menu) {
                                menu.open = false;
                                menu.querySelector('summary')?.focus();
                              }
                            }}
                          >
                            <ParticipantAvatar participant={person} className="expense-form__payer-avatar" />
                            <span className="expense-form__payer-name">
                              <ParticipantName
                                participant={person}
                                suffix={person.id === currentParticipant?.id ? ' (você)' : ''}
                              />
                            </span>
                            {person.id === payerId && <Check size={17} aria-label="Selecionado" />}
                          </button>
                        ))}
                      </div>
                    </details>
                  </div>

                  {/* Campo: creditar participante */}
                  <div className="expense-field">
                    <span className="expense-field__label">creditar participante</span>
                    <div className="expense-form__recipients" role="radiogroup" aria-label="Participante que recebeu o pagamento">
                      {recipientOptions.map(person => {
                        const pair = pairBalances.get(person.id) || { direction: 'none', amount: 0 };
                        const isSelected = recipientId === person.id;
                        const isSelfPayer = payerId === currentParticipant?.id;
                        const statusText = pair.direction === 'pay'
                          ? `${isSelfPayer ? 'você deve' : 'deve'} ${formatCurrency(pair.amount)}`
                          : pair.direction === 'receive'
                            ? `${isSelfPayer ? 'te deve' : 'deve a quem pagou'} ${formatCurrency(pair.amount)}`
                            : 'tudo certo';
                        return (
                          <button
                            type="button"
                            key={person.id}
                            role="radio"
                            aria-checked={isSelected}
                            className={`expense-form__recipient${isSelected ? ' is-selected' : ''}`}
                            onClick={() => setRecipientId(person.id)}
                          >
                            <ParticipantAvatar participant={person} className="expense-form__payer-avatar" />
                            <span className="expense-form__recipient-info">
                              <strong><ParticipantName participant={person} /></strong>
                              <small className={`expense-form__recipient-status expense-form__recipient-status--${pair.direction}`}>
                                {statusText}
                              </small>
                            </span>
                            {isSelected && <Check size={17} className="expense-form__recipient-check" aria-hidden="true" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Campo: observação (opcional) */}
                  <div className="expense-field">
                    <label htmlFor="payment-notes" className="expense-field__label">
                      observação (opcional)
                    </label>
                    <input
                      id="payment-notes"
                      className="expense-field__text-input"
                      value={paymentNotes}
                      onChange={e => setPaymentNotes(e.target.value)}
                      maxLength={500}
                      placeholder="ex: pix enviado"
                    />
                  </div>
                </>
              ) : (
                <>
              {/* Campo: descrição */}
              <div className="expense-field">
                <label htmlFor="expense-description" className="expense-field__label">
                  descrição
                </label>
                <input
                  id="expense-description"
                  className="expense-field__text-input"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="ex: mercado, combustível, pizza"
                />
              </div>

              {/* Campo: quem pagou? */}
              <div className="expense-field">
                <span className="expense-field__label">quem pagou?</span>
                <details
                  className="expense-form__payer-menu"
                  onBlur={e => {
                    if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.open = false;
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Escape') {
                      e.currentTarget.open = false;
                      e.currentTarget.querySelector('summary')?.focus();
                    }
                  }}
                >
                  <summary className="expense-form__payer" aria-label="quem pagou?">
                    {payer && <ParticipantAvatar participant={payer} className="expense-form__payer-avatar" />}
                    <span className="expense-form__payer-name">
                      <ParticipantName
                        participant={payer}
                        name={payer?.name || 'selecione um participante'}
                        suffix={payerId === currentParticipant?.id ? ' (você)' : ''}
                      />
                    </span>
                    <ChevronDown size={18} aria-hidden="true" />
                  </summary>
                  <div className="expense-form__payer-options" aria-label="Participantes">
                    {orderedParticipants.map(person => (
                      <button
                        type="button"
                        key={person.id}
                        onClick={e => {
                          setPayerId(person.id);
                          const menu = e.currentTarget.closest('details');
                          if (menu) {
                            menu.open = false;
                            menu.querySelector('summary')?.focus();
                          }
                        }}
                      >
                        <ParticipantAvatar participant={person} className="expense-form__payer-avatar" />
                        <span className="expense-form__payer-name">
                          <ParticipantName
                            participant={person}
                            suffix={person.id === currentParticipant?.id ? ' (você)' : ''}
                          />
                        </span>
                        {person.id === payerId && <Check size={17} aria-label="Selecionado" />}
                      </button>
                    ))}
                  </div>
                </details>
              </div>

              {/* Campo: quem participa da divisão? */}
              <div className="expense-field">
                <span className="expense-field__label">quem participa da divisão?</span>
                {segments(
                  [
                    { value: 'ALL', label: `todos (${participants.length})` },
                    { value: 'SOME', label: 'apenas alguns' },
                  ],
                  scope,
                  handleScopeChange,
                  'participantes da divisão'
                )}
                {scope === 'SOME' && (
                  <div className="expense-form__participants" role="group" aria-label="Participantes da divisão">
                    <label className="expense-form__participant-all">
                      <span className="expense-form__participant-name expense-form__participant-name--all">
                        Todos
                      </span>
                      <input
                        type="checkbox"
                        checked={isAllSelected}
                        onChange={handleToggleAll}
                        aria-label="Selecionar todos os participantes"
                      />
                    </label>
                    {participants.map(person => (
                      <label key={person.id}>
                        <ParticipantAvatar participant={person} className="expense-form__payer-avatar" />
                        <span className="expense-form__participant-name"><ParticipantName participant={person} /></span>
                        <input
                          type="checkbox"
                          checked={selectedParticipants.includes(person.id)}
                          onChange={() => handleToggleParticipant(person.id)}
                          aria-label={`Incluir ${person.name} na divisão`}
                        />
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* Campo: como dividir? */}
              <div className="expense-field">
                <span className="expense-field__label">como dividir?</span>
                {segments(
                  [
                    { value: 'EQUAL', label: 'dividir igualmente' },
                    { value: 'CUSTOM', label: 'personalizado' },
                  ],
                  splitKind,
                  setSplitKind,
                  'como dividir?'
                )}
              </div>

              {/* Campo: como personalizar? (quando divisão for personalizada) */}
              {splitKind === 'CUSTOM' && (
                <div className="expense-field">
                  <span className="expense-field__label">como personalizar?</span>
                  {segments(
                    [
                      { value: 'SHARES', label: 'partes' },
                      { value: 'EXACT', label: 'valor R$' },
                      { value: 'PERCENT', label: 'porcentagem' },
                    ],
                    customMode,
                    handleCustomModeChange,
                    'como personalizar?'
                  )}
                  <div className="expense-form__participants">
                    {activeParticipants.map(person => {
                      const alloc = sharesAllocationMap[person.id] || {
                        share: fallbackShare || 1,
                        isManual: false,
                        placeholderShare: fallbackShare || 1,
                        totalShares: totalShares || 1,
                        cents: 0,
                        percentage: 0,
                      };
                      const isManual = shares[person.id] !== undefined && shares[person.id] !== '';
                      const shareValue = isManual ? String(shares[person.id]) : '';
                      return (
                        <div
                          className={`expense-form__person${customMode === 'SHARES' ? ' expense-form__person--shares' : ''}`}
                          key={person.id}
                        >
                          <div className="expense-form__person-identity">
                            <ParticipantAvatar participant={person} className="expense-form__payer-avatar" />
                            <span className="expense-form__participant-name"><ParticipantName participant={person} /></span>
                          </div>
                          {customMode === 'SHARES' ? (
                            <>
                              <div className="expense-form__share-summary">
                                <span className="expense-form__share-fraction">
                                  {alloc.share}/{alloc.totalShares}
                                </span>
                                <strong className="expense-form__share-amount">
                                  {formatCurrency(alloc.cents)}
                                </strong>
                              </div>
                              <div className="expense-form__shares">
                                <button
                                  type="button"
                                  aria-label={`Diminuir partes de ${person.name}`}
                                  disabled={alloc.share <= 1 && !isManual}
                                  onClick={() => handleShareStep(person.id, -1)}
                                >
                                  −
                                </button>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  aria-label={`Partes de ${person.name}`}
                                  placeholder={String(alloc.placeholderShare || 1)}
                                  value={shareValue}
                                  onChange={e => handleShareInputChange(person.id, e.target.value)}
                                  onBlur={() => handleShareBlur(person.id)}
                                />
                                <button
                                  type="button"
                                  aria-label={`Aumentar partes de ${person.name}`}
                                  onClick={() => handleShareStep(person.id, 1)}
                                >
                                  +
                                </button>
                              </div>
                            </>
                          ) : customMode === 'EXACT' ? (
                            <div className="expense-form__adorned-input expense-form__adorned-input--exact">
                              <span className="expense-form__adornment" aria-hidden="true">R$</span>
                              <input
                                className="expense-form__allocation-input"
                                type="text"
                                inputMode="numeric"
                                aria-label={`Valor de ${person.name}`}
                                placeholder={formatCentsDigits(fallbackCentsMap[person.id])}
                                value={exactAmounts[person.id] ? formatCentsDigits(Number(exactAmounts[person.id])) : ''}
                                onChange={e => handleExactChange(person.id, e.target.value)}
                              />
                            </div>
                          ) : (
                            <div className="expense-form__adorned-input expense-form__adorned-input--percent">
                              <input
                                className="expense-form__allocation-input"
                                type="text"
                                inputMode="decimal"
                                aria-label={`Porcentagem de ${person.name}`}
                                placeholder={formatPctDigits(fallbackPctMap[person.id])}
                                value={percentages[person.id] || ''}
                                onChange={e => handlePercentageChange(person.id, e.target.value)}
                              />
                              <span className="expense-form__adornment" aria-hidden="true">%</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
                </>
              )}
            </div>
          </div>

          <footer className="expense-page__footer">
            {error && <p className="expense-page__error" role="alert">{error}</p>}
            <button
              className={`expense-page__submit${isSplitWarning ? ' expense-page__submit--warning' : ''}`}
              type="submit"
              disabled={isSubmitDisabled}
            >
              {submitButtonText}
            </button>
          </footer>
    </form>
  );
}
