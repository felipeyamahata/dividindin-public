import { EventsHome } from './components/EventsHome';
import { EventShell } from './components/EventShell.jsx';
import { AppHeader } from './components/AppHeader.jsx';
import { LoginPage } from './components/LoginPage';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { api, setMaintenanceListener } from './lib/api.js';
import { captureExpenseBubbleSnapshot, prefersReducedMotion } from './lib/morph.js';
import { useEventAutoSync } from './lib/useEventAutoSync.js';
import { formatDocumentTitle } from '../domain/pageTitle.js';
import {
  computeScreenStack,
  parseEventCodeFromPath,
} from '../domain/navigationHistory.js';
import {
  computeRemainingLoadingMs,
  EVENT_LOADING_ENTRY_FLIGHT_MS,
  MIN_EVENT_LOADING_MS,
} from '../domain/loadingTransition.js';
import { useBackLayer, useHistoryNavigation } from './lib/useHistoryNavigation.js';
import { EventLoadingOverlay } from './components/EventLoadingOverlay.jsx';
import { ExpenseFeed } from './components/ExpenseFeed.jsx';
import {
  ExpenseDetails,
  ExpenseDetailActions,
  SettlementDetails,
  SettlementDetailActions,
} from './components/ExpenseDetails.jsx';
import { SettlementView } from './components/SettlementView.jsx';
import { GroupView } from './components/GroupView.jsx';
import { ProfileView } from './components/ProfileView.jsx';
import { DonateView } from './components/DonateView.jsx';
import { ExpenseFormView } from './components/ExpenseFormView.jsx';
import { ClaimSheet } from './components/ClaimSheet.jsx';
import { AuthModal } from './components/AuthModal.jsx';
import { NewEventModal } from './components/NewEventModal.jsx';
import { EditEventModal } from './components/EditEventModal.jsx';
import { PostLoginInstallModal } from './components/PostLoginInstallModal.jsx';
import { requestConfirmation } from './components/ConfirmDialog.jsx';
import { MaintenanceScreen } from './components/MaintenanceScreen.jsx';
import {
  evaluatePostLoginInstallPrompt,
  promptAppInstall,
} from './lib/installPrompt.js';
import { AlertCircle } from 'lucide-react';

export function App() {
  const [user, setUser] = useState(null);
  const [userEvents, setUserEvents] = useState([]);
  const [event, setEvent] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [currentParticipant, setCurrentParticipant] = useState(null);
  const [unclaimedParticipants, setUnclaimedParticipants] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [timelineEvents, setTimelineEvents] = useState([]);
  const [selectedExpenseId, setSelectedExpenseId] = useState(null);
  const [selectedSettlementId, setSelectedSettlementId] = useState(null);
  const [balancesData, setBalancesData] = useState({
    totalSpent: 0,
    balances: [],
    simplifiedTransactions: [],
    settlements: [],
    userSummary: null,
  });

  const [activeTab, setActiveTab] = useState('expenses'); // 'expenses' | 'settlement' | 'group'
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isDonateOpen, setIsDonateOpen] = useState(false);
  const [sustainabilitySnapshot, setSustainabilitySnapshot] = useState(null);
  const [avatarOriginRect, setAvatarOriginRect] = useState(null);
  const [pendingReturnAvatar, setPendingReturnAvatar] = useState(null);
  const [receiptEntryOrigin, setReceiptEntryOrigin] = useState(null);
  const [pendingReturnReceipt, setPendingReturnReceipt] = useState(null);
  const [detailRevealState, setDetailRevealState] = useState('idle');
  const [suppressFeedReveal, setSuppressFeedReveal] = useState(false);
  const captureProfileAvatarRef = useRef(null);
  const captureDetailExitRef = useRef(null);
  const captureBrandMarkRef = useRef(null);
  const captureLoadingCenterMarkRef = useRef(null);
  const selectEventTokenRef = useRef(0);
  const [eventLoading, setEventLoading] = useState({
    phase: 'idle',
    entrySnapshot: null,
    returnBrand: null,
  });
  const feedScrollTopRef = useRef(0);
  const feedScrollElRef = useRef(null);
  const [pendingNewFeedCount, setPendingNewFeedCount] = useState(0);
  const reportedActiveRef = useRef(false);
  const lastPingAtRef = useRef(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isMaintenance, setIsMaintenance] = useState(false);
  const [baseEntryKind, setBaseEntryKind] = useState(() => (
    typeof window !== 'undefined' && parseEventCodeFromPath(window.location.pathname) ? 'event' : 'home'
  ));

  // Modals / Drawers
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [isNewEventOpen, setIsNewEventOpen] = useState(false);
  const [editingEventTarget, setEditingEventTarget] = useState(null);
  const [isAddExpenseOpen, setIsAddExpenseOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState(null);
  const [editingSettlement, setEditingSettlement] = useState(null);
  const [initialEntry, setInitialEntry] = useState(null);
  const [showClaimSheet, setShowClaimSheet] = useState(false);
  const [postLoginInstallPrompt, setPostLoginInstallPrompt] = useState(null);
  const postLoginInstallTimerRef = useRef(null);
  const showClaimSheetRef = useRef(false);

  useEffect(() => {
    showClaimSheetRef.current = showClaimSheet;
  }, [showClaimSheet]);

  useEffect(() => {
    api.getSustainability().then(setSustainabilitySnapshot).catch(() => null);
    return () => {
      if (postLoginInstallTimerRef.current) {
        clearTimeout(postLoginInstallTimerRef.current);
      }
    };
  }, []);

  // Extract invite code from pathname: e.g. /divide/e/abc123 or /e/abc123
  const getInviteCodeFromUrl = () => parseEventCodeFromPath(window.location.pathname);

  const getBaseUrlPath = () => (window.location.pathname.startsWith('/divide') ? '/divide' : '');

  const loadUserData = async () => {
    try {
      const res = await api.getMe();
      setUser(res.user);
      if (res.user) {
        const eventsRes = await api.listEvents().catch(() => ({ events: [] }));
        setUserEvents(eventsRes.events || []);
      }
      return res.user;
    } catch {
      return null;
    }
  };

  const fetchEventBundle = useCallback(async (code) => {
    const data = await api.getEvent(code);
    const [expRes, balRes] = await Promise.all([
      api.getExpenses(data.event.id).catch(() => ({ expenses: [] })),
      api.getBalances(data.event.id).catch(() => ({})),
    ]);
    return { data, expRes, balRes };
  }, []);

  const applyEventBundle = useCallback(({ data, expRes, balRes }) => {
    setEvent(data.event);
    setParticipants(data.participants || []);
    setCurrentParticipant(data.currentParticipant);
    setUnclaimedParticipants(data.unclaimedParticipants || []);
    setShowClaimSheet(!data.currentParticipant && Boolean(data.unclaimedParticipants?.length));
    setExpenses(expRes.expenses || []);
    setTimelineEvents(expRes.timelineEvents || []);
    setBalancesData(balRes);
  }, []);

  const loadEvent = useCallback(async (code, silent = false) => {
    if (!code) return;
    if (!silent) setLoading(true);
    setError('');
    try {
      const bundle = await fetchEventBundle(code);
      applyEventBundle(bundle);
    } catch (err) {
      setError(err.message || 'Erro ao carregar evento');
    } finally {
      setLoading(false);
    }
  }, [fetchEventBundle, applyEventBundle]);

  // Initial load
  useEffect(() => {
    setMaintenanceListener((down) => {
      if (down) {
        selectEventTokenRef.current += 1;
        setEventLoading({ phase: 'idle', entrySnapshot: null, returnBrand: null });
      }
      setIsMaintenance(down);
    });

    async function init() {
      await loadUserData();
      const code = getInviteCodeFromUrl();
      if (code) {
        await loadEvent(code);
      } else {
        setLoading(false);
      }
    }
    init();
  }, [loadEvent]);

  // Fast presence enter/leave lifecycle on visibility and page exit transitions
  useEffect(() => {
    if (!user?.id) {
      reportedActiveRef.current = false;
      return undefined;
    }

    const isVisible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
    reportedActiveRef.current = isVisible;
    if (isVisible) {
      lastPingAtRef.current = Date.now();
    }

    const handleEnter = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      const now = Date.now();
      if (reportedActiveRef.current && now - lastPingAtRef.current < 15000) return;
      reportedActiveRef.current = true;
      lastPingAtRef.current = now;
      api.pingPresence();
    };

    const handleLeave = () => {
      if (!reportedActiveRef.current) return;
      reportedActiveRef.current = false;
      api.leavePresence();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        handleLeave();
      } else if (document.visibilityState === 'visible') {
        handleEnter();
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', handleLeave);
    window.addEventListener('online', handleEnter);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', handleLeave);
      window.removeEventListener('online', handleEnter);
    };
  }, [user?.id]);

  // Refresh event data
  const refreshEventData = useCallback(async () => {
    if (!event) return;
    try {
      const [evtData, expRes, balRes] = await Promise.all([
        api.getEvent(event.code),
        api.getExpenses(event.id),
        api.getBalances(event.id),
      ]);
      if (evtData?.event) setEvent(evtData.event);
      setParticipants(evtData.participants || []);
      setCurrentParticipant(evtData.currentParticipant);
      setUnclaimedParticipants(evtData.unclaimedParticipants || []);
      setExpenses(expRes.expenses || []);
      setTimelineEvents(expRes.timelineEvents || []);
      setBalancesData(balRes);
      const eventsRes = await api.listEvents().catch(() => null);
      if (eventsRes) setUserEvents(eventsRes.events || []);

      if (!evtData.currentParticipant && evtData.unclaimedParticipants?.length > 0) {
        setShowClaimSheet(true);
      } else {
        setShowClaimSheet(false);
      }
    } catch (err) {
      console.error('Refresh error:', err);
    }
  }, [event]);

  // Switch to an event
  const handleSelectEvent = async (evt) => {
    if (!evt?.code || eventLoading.phase === 'loading') return;

    const entrySnapshot = !prefersReducedMotion()
      ? (captureBrandMarkRef.current?.() || null)
      : null;

    setSelectedExpenseId(null);
    setSelectedSettlementId(null);
    setReceiptEntryOrigin(null);
    setPendingReturnReceipt(null);
    setDetailRevealState('idle');
    setSuppressFeedReveal(false);
    feedScrollTopRef.current = 0;
    setPendingNewFeedCount(0);
    setIsProfileOpen(false);
    setIsDonateOpen(false);
    setIsAddExpenseOpen(false);
    setEditingEventTarget(null);
    setEditingExpense(null);
    setEditingSettlement(null);
    setInitialEntry(null);
    setAvatarOriginRect(null);
    setPendingReturnAvatar(null);
    setActiveTab('expenses');
    setError('');
    setEventLoading({
      phase: 'loading',
      entrySnapshot,
      returnBrand: null,
    });

    const startedAt = Date.now();
    const token = ++selectEventTokenRef.current;

    try {
      const bundle = await fetchEventBundle(evt.code);
      if (selectEventTokenRef.current !== token) return;

      const minDurationMs = prefersReducedMotion()
        ? MIN_EVENT_LOADING_MS
        : Math.max(MIN_EVENT_LOADING_MS, EVENT_LOADING_ENTRY_FLIGHT_MS);
      const remainingMs = computeRemainingLoadingMs({
        startedAt,
        now: Date.now(),
        minDurationMs,
      });
      if (remainingMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, remainingMs));
      }
      if (selectEventTokenRef.current !== token) return;

      const returnBrand = !prefersReducedMotion()
        ? (captureLoadingCenterMarkRef.current?.() || null)
        : null;

      applyEventBundle(bundle);
      setEventLoading({
        phase: 'exiting',
        entrySnapshot: null,
        returnBrand,
      });
    } catch (err) {
      if (selectEventTokenRef.current !== token) return;
      setEventLoading({ phase: 'idle', entrySnapshot: null, returnBrand: null });
      setError(err.message || 'Erro ao carregar evento');
    }
  };

  // Auth actions
  const handleAuthSuccess = async (action, data) => {
    let res;
    if (action === 'register') {
      res = await api.register(data.username, data.password, data.name);
    } else if (action === 'google') {
      res = await api.loginWithGoogle(data.credential);
    } else {
      res = await api.login(data.username, data.password);
    }
    setUser(res.user);
    const eventsRes = await api.listEvents().catch(() => ({ events: [] }));
    setUserEvents(eventsRes.events || []);

    if (event) {
      await refreshEventData();
    }

    if (action === 'login' || (action === 'google' && !res?.isNewUser)) {
      if (postLoginInstallTimerRef.current) {
        clearTimeout(postLoginInstallTimerRef.current);
      }
      postLoginInstallTimerRef.current = setTimeout(() => {
        postLoginInstallTimerRef.current = null;
        if (showClaimSheetRef.current) return;
        const decision = evaluatePostLoginInstallPrompt('login');
        if (decision.show) {
          setPostLoginInstallPrompt({
            mode: decision.mode,
            browserGuide: decision.browserGuide,
          });
        }
      }, 280);
    }
  };

  const handleLogout = async () => {
    selectEventTokenRef.current += 1;
    setEventLoading({ phase: 'idle', entrySnapshot: null, returnBrand: null });
    if (postLoginInstallTimerRef.current) {
      clearTimeout(postLoginInstallTimerRef.current);
      postLoginInstallTimerRef.current = null;
    }
    setPostLoginInstallPrompt(null);
    await api.logout();
    setUser(null);
    setCurrentParticipant(null);
    setShowClaimSheet(false);
    setIsProfileOpen(false);
    setIsDonateOpen(false);
    setIsAddExpenseOpen(false);
    setEditingEventTarget(null);
    setEditingExpense(null);
    setEditingSettlement(null);
    setInitialEntry(null);
    setSelectedExpenseId(null);
    setSelectedSettlementId(null);
    setAvatarOriginRect(null);
    setPendingReturnAvatar(null);
    setReceiptEntryOrigin(null);
    setPendingReturnReceipt(null);
    setDetailRevealState('idle');
    setSuppressFeedReveal(false);
    feedScrollTopRef.current = 0;
    setPendingNewFeedCount(0);
    setActiveTab('expenses');
  };

  // Create event action
  const handleCreateEvent = async (title) => {
    const res = await api.createEvent(title);
    const newEvt = res.event;
    const eventsRes = await api.listEvents().catch(() => null);
    setUserEvents(eventsRes?.events || [newEvt, ...userEvents]);
    setIsProfileOpen(false);
    setIsAddExpenseOpen(false);
    setEditingEventTarget(null);
    setEditingExpense(null);
    setEditingSettlement(null);
    setInitialEntry(null);
    setSelectedExpenseId(null);
    setSelectedSettlementId(null);
    setAvatarOriginRect(null);
    setPendingReturnAvatar(null);
    setReceiptEntryOrigin(null);
    setPendingReturnReceipt(null);
    setDetailRevealState('idle');
    setSuppressFeedReveal(false);
    feedScrollTopRef.current = 0;
    setPendingNewFeedCount(0);
    setActiveTab('expenses');
    await loadEvent(newEvt.code);
  };

  const handleUpdateEvent = async (title) => {
    const target = editingEventTarget || event;
    if (!target) return;
    const res = await api.updateEvent(target.id, title, target.description || '');
    const updated = res.event;
    if (event?.id === updated.id) setEvent(updated);
    setUserEvents(prev => prev.map(item => (item.id === updated.id ? { ...item, ...updated } : item)));
  };

  const handleDeleteEventFromHome = async (targetEvent) => {
    if (!targetEvent) return false;
    const confirmed = await requestConfirmation(
      `Excluir “${targetEvent.title}”? Todos os lançamentos, pagamentos e participantes serão apagados permanentemente.`,
      'excluir',
    );
    if (!confirmed) return false;
    await api.deleteEvent(targetEvent.id);
    if (event?.id === targetEvent.id) setEvent(null);
    if (editingEventTarget?.id === targetEvent.id) setEditingEventTarget(null);
    return true;
  };

  const clearActiveEventView = useCallback(() => {
    setEvent(null);
    setParticipants([]);
    setCurrentParticipant(null);
    setUnclaimedParticipants([]);
    setShowClaimSheet(false);
    setExpenses([]);
    setTimelineEvents([]);
    setSelectedExpenseId(null);
    setSelectedSettlementId(null);
    setReceiptEntryOrigin(null);
    setPendingReturnReceipt(null);
    setDetailRevealState('idle');
    setSuppressFeedReveal(false);
    feedScrollTopRef.current = 0;
    setPendingNewFeedCount(0);
    setActiveTab('expenses');
    setBaseEntryKind('home');
  }, []);

  const handleFinishDeleteEventFromHome = useCallback((eventId) => {
    setUserEvents(prev => prev.filter(item => item.id !== eventId));
  }, []);

  const handleDeleteActiveEvent = async () => {
    const deleted = await handleDeleteEventFromHome(event);
    if (!deleted) return false;
    handleFinishDeleteEventFromHome(event.id);
    clearActiveEventView();
    return true;
  };

  // Claim participant action
  const handleClaim = async (participantId) => {
    if (!user) {
      setIsAuthOpen(true);
      return;
    }
    await api.claimParticipant(event.id, participantId);
    setShowClaimSheet(false);
    await refreshEventData();
  };

  // Join as new participant
  const handleJoinNew = async () => {
    if (!user) {
      setIsAuthOpen(true);
      return;
    }
    await api.joinEvent(event.id);
    setShowClaimSheet(false);
    await refreshEventData();
  };

  // Add placeholder participant
  const handleAddParticipant = async (name) => {
    await api.addParticipant(event.id, name);
    await refreshEventData();
  };

  // Remove participant and redistribute expenses (admin only)
  const handleRemoveParticipant = async (participantId, replacementPayerId) => {
    await api.removeParticipant(event.id, participantId, replacementPayerId);
    await refreshEventData();
  };

  // Leave event (guests only)
  const handleLeaveEvent = async (targetEvent = event) => {
    if (!targetEvent) return false;
    const confirmed = await requestConfirmation(
      `Sair de “${targetEvent.title}”? Seus lançamentos e divisões continuam salvos em um participante genérico.`,
      'sair do evento',
    );
    if (!confirmed) return false;
    await api.leaveEvent(targetEvent.id);
    if (event?.id === targetEvent.id) {
      clearActiveEventView();
      const eventsRes = await api.listEvents().catch(() => null);
      if (eventsRes) setUserEvents(eventsRes.events || []);
    }
    return true;
  };

  // Create or Update expense
  const handleSaveExpense = async (expenseData) => {
    if (expenseData.id) {
      await api.updateExpense(expenseData.id, expenseData);
    } else {
      await api.createExpense(event.id, expenseData);
    }
    setEditingExpense(null);
    setInitialEntry(null);
    await refreshEventData();
  };

  // Open Edit Expense
  const handleOpenEditExpense = (exp) => {
    setDetailRevealState('idle');
    setReceiptEntryOrigin(null);
    setInitialEntry(null);
    setEditingSettlement(null);
    setEditingExpense(exp);
    setIsAddExpenseOpen(true);
  };

  // Open Edit Settlement
  const handleOpenEditSettlement = (stl) => {
    setDetailRevealState('idle');
    setReceiptEntryOrigin(null);
    setInitialEntry(null);
    setEditingExpense(null);
    setEditingSettlement(stl);
    setIsAddExpenseOpen(true);
  };

  // Delete expense
  const handleDeleteExpense = async (id) => {
    await api.deleteExpense(id);
    await refreshEventData();
    setReceiptEntryOrigin(null);
    setPendingReturnReceipt(null);
    setDetailRevealState('idle');
    setSuppressFeedReveal(true);
    setSelectedExpenseId(null);
  };

  // Create or Update settlement
  const handleRecordPayment = async (data) => {
    if (data.id) {
      await api.updateSettlement(data.id, data);
    } else {
      await api.createSettlement(event.id, data);
    }
    setEditingSettlement(null);
    setInitialEntry(null);
    await refreshEventData();
  };

  // Delete settlement
  const handleDeleteSettlement = async (id) => {
    await api.deleteSettlement(id);
    await refreshEventData();
    if (selectedSettlementId === id) {
      setReceiptEntryOrigin(null);
      setPendingReturnReceipt(null);
      setDetailRevealState('idle');
      setSuppressFeedReveal(true);
      setSelectedSettlementId(null);
    }
  };

  const closeProfile = useCallback(() => {
    const snapshot = captureProfileAvatarRef.current?.() || null;
    setPendingReturnAvatar(snapshot);
    setAvatarOriginRect(null);
    setIsProfileOpen(false);
  }, []);

  const closeDonate = useCallback(() => {
    setIsDonateOpen(false);
  }, []);

  const closeExpenseForm = useCallback(() => {
    setIsAddExpenseOpen(false);
    setEditingExpense(null);
    setEditingSettlement(null);
    setInitialEntry(null);
  }, []);

  const closeDetail = useCallback(() => {
    const exitSnapshot = !prefersReducedMotion() ? (captureDetailExitRef.current?.() || null) : null;
    setReceiptEntryOrigin(null);
    setDetailRevealState('idle');
    setSuppressFeedReveal(true);
    setPendingReturnReceipt(exitSnapshot);
    setSelectedExpenseId(null);
    setSelectedSettlementId(null);
  }, []);

  const handleStepBack = useCallback((step) => {
    if (step.action === 'close-profile') {
      closeProfile();
      return;
    }
    if (step.action === 'close-donate') {
      closeDonate();
      return;
    }
    if (step.action === 'close-expense-form') {
      closeExpenseForm();
      return;
    }
    if (step.action === 'close-detail') {
      closeDetail();
      return;
    }
    if (step.action === 'leave-event') {
      clearActiveEventView();
    }
  }, [closeProfile, closeDonate, closeExpenseForm, closeDetail, clearActiveEventView]);

  const handleRestoreState = useCallback((rawState) => {
    setIsProfileOpen(rawState.screen === 'profile');
    setIsDonateOpen(rawState.screen === 'donate');
    const isForm = rawState.screen === 'expense-form';
    setIsAddExpenseOpen(isForm);
    if (!isForm) {
      setEditingExpense(null);
      setEditingSettlement(null);
      setInitialEntry(null);
    }

    if (rawState.screen === 'home') {
      clearActiveEventView();
      return;
    }

    if (rawState.eventCode && event?.code !== rawState.eventCode) {
      loadEvent(rawState.eventCode, true);
    }

    setReceiptEntryOrigin(null);
    setPendingReturnReceipt(null);
    setDetailRevealState('idle');
    setSuppressFeedReveal(false);

    if (rawState.detailKind === 'expense' && rawState.detailId != null) {
      setSelectedSettlementId(null);
      setSelectedExpenseId(rawState.detailId);
    } else if (rawState.detailKind === 'settlement' && rawState.detailId != null) {
      setSelectedExpenseId(null);
      setSelectedSettlementId(rawState.detailId);
    } else {
      setSelectedExpenseId(null);
      setSelectedSettlementId(null);
    }
  }, [clearActiveEventView, event?.code, loadEvent]);

  const handleExternalUrlChange = useCallback((pathname) => {
    setIsProfileOpen(false);
    setIsDonateOpen(false);
    closeExpenseForm();
    const code = parseEventCodeFromPath(pathname);
    if (code) {
      setBaseEntryKind('event');
      setSelectedExpenseId(null);
      setSelectedSettlementId(null);
      loadEvent(code, true);
    } else {
      clearActiveEventView();
    }
  }, [closeExpenseForm, clearActiveEventView, loadEvent]);

  const basePath = typeof window !== 'undefined' ? getBaseUrlPath() : '';
  const screenStack = useMemo(() => computeScreenStack({
    basePath,
    baseEntryKind,
    eventCode: event?.code || null,
    selectedExpenseId: selectedExpenseId ?? null,
    selectedSettlementId: selectedSettlementId ?? null,
    isAddExpenseOpen,
    isDonateOpen,
    isProfileOpen,
  }), [
    basePath,
    baseEntryKind,
    event?.code,
    selectedExpenseId,
    selectedSettlementId,
    isAddExpenseOpen,
    isDonateOpen,
    isProfileOpen,
  ]);

  const registerBrandCapture = useCallback((fn) => {
    captureBrandMarkRef.current = fn;
  }, []);

  const registerLoadingCenterCapture = useCallback((fn) => {
    captureLoadingCenterMarkRef.current = fn;
  }, []);

  const clearEventLoading = useCallback(() => {
    setEventLoading({ phase: 'idle', entrySnapshot: null, returnBrand: null });
  }, []);

  useBackLayer(
    'event-loading',
    eventLoading.phase === 'loading',
    () => {
      selectEventTokenRef.current += 1;
      setEventLoading({ phase: 'idle', entrySnapshot: null, returnBrand: null });
    },
    { priority: 90 }
  );

  useHistoryNavigation({
    enabled: !loading && !error && !isMaintenance,
    screenStack,
    onStepBack: handleStepBack,
    onRestoreState: handleRestoreState,
    onExternalUrlChange: handleExternalUrlChange,
  });

  const handleNewItemsWhileScrolled = useCallback((count) => {
    setPendingNewFeedCount((prev) => prev + count);
  }, []);

  const clearPendingNewFeedCount = useCallback(() => {
    setPendingNewFeedCount((prev) => (prev === 0 ? prev : 0));
  }, []);

  const resolvedSyncMode = isProfileOpen
    ? 'profile'
    : isDonateOpen
    ? 'donate'
    : isAddExpenseOpen
    ? 'expense'
    : event
    ? 'event'
    : 'home';

  const syncStreamEndpoint = resolvedSyncMode === 'event' && event?.id && currentParticipant
    ? `/events/${encodeURIComponent(event.id)}/stream`
    : resolvedSyncMode === 'home' && user?.id
      ? '/events/stream'
      : null;

  const handleAutoSync = useCallback(async (payload) => {
    if (resolvedSyncMode === 'event' && event?.id) {
      if (payload?.reason === 'event_deleted') {
        const eventsRes = await api.listEvents().catch(() => null);
        if (eventsRes) setUserEvents(eventsRes.events || []);
        clearActiveEventView();
        return;
      }
      await refreshEventData();
      if (payload?.reason?.startsWith('profile') && payload?.userId === user?.id) {
        const meRes = await api.getMe().catch(() => null);
        if (meRes?.user) setUser(meRes.user);
      }
      return;
    }

    if (resolvedSyncMode === 'home' && user?.id) {
      const eventsRes = await api.listEvents().catch(() => null);
      if (eventsRes) setUserEvents(eventsRes.events || []);
      if (payload?.reason?.startsWith('profile') && payload?.userId === user?.id) {
        const meRes = await api.getMe().catch(() => null);
        if (meRes?.user) setUser(meRes.user);
      }
    }
  }, [resolvedSyncMode, event?.id, user?.id, refreshEventData, clearActiveEventView]);

  useEventAutoSync({
    endpoint: syncStreamEndpoint,
    enabled: Boolean(syncStreamEndpoint) && !loading && !error && !isMaintenance,
    onSync: handleAutoSync,
  });

  if (isMaintenance) {
    return (
      <MaintenanceScreen
        onRetry={async () => {
          setIsMaintenance(false);
          setLoading(true);
          await loadUserData();
          const code = getInviteCodeFromUrl();
          if (code) await loadEvent(code);
          setLoading(false);
        }}
      />
    );
  }

  const registerReturnCapture = useCallback((fn) => {
    captureProfileAvatarRef.current = fn;
  }, []);

  const clearReturnAvatar = useCallback(() => {
    setPendingReturnAvatar(null);
  }, []);

  const registerDetailExitCapture = useCallback((fn) => {
    captureDetailExitRef.current = fn;
  }, []);

  const clearEntryMorph = useCallback(() => {
    setReceiptEntryOrigin(null);
    setDetailRevealState(current => (current === 'awaiting' ? 'revealing' : current));
  }, []);

  const clearReturnReceipt = useCallback(() => {
    setPendingReturnReceipt(null);
  }, []);

  const selectedExpense = expenses.find(item => item.id === selectedExpenseId);
  const selectedSettlement = (balancesData.settlements || []).find(item => item.id === selectedSettlementId);
  const selectedExpensePayer = selectedExpense
    ? participants.find(person => person.id === selectedExpense.payer_id)
    : null;
  const selectedSettlementSender = selectedSettlement
    ? participants.find(person => person.id === selectedSettlement.from_participant_id)
    : null;
  const selectedExpenseIsOwn = Boolean(user && selectedExpensePayer?.user_id === user.id);
  const selectedSettlementIsOwn = Boolean(user && selectedSettlementSender?.user_id === user.id);
  const detailReceipt = useMemo(() => (
    selectedExpense
      ? { expenseId: selectedExpense.id, isOwn: selectedExpenseIsOwn }
      : selectedSettlement
        ? { expenseId: selectedSettlement.id, isOwn: selectedSettlementIsOwn }
        : null
  ), [selectedExpense?.id, selectedExpenseIsOwn, selectedSettlement?.id, selectedSettlementIsOwn]);

  const screenMode = isProfileOpen
    ? 'profile'
    : isDonateOpen
    ? 'donate'
    : isAddExpenseOpen
    ? 'expense'
    : event
    ? 'event'
    : 'home';

  const isPublicLanding = !user && !event && !error && !getInviteCodeFromUrl() && !isMaintenance;

  useEffect(() => {
    document.title = formatDocumentTitle({
      eventTitle: event?.title,
      screenMode: isPublicLanding ? 'landing' : screenMode,
      isLoading: loading,
      isError: Boolean(error),
      isMaintenance,
    });
  }, [event?.title, screenMode, isPublicLanding, loading, error, isMaintenance]);

  if (!loading && !user && !event && !error && !getInviteCodeFromUrl()) {
    return <LoginPage onAuthSuccess={handleAuthSuccess} />;
  }

  const headerTitle = screenMode === 'profile'
    ? 'perfil'
    : screenMode === 'donate'
    ? 'apoie!'
    : screenMode === 'expense'
    ? (editingSettlement ? 'editar pagamento' : editingExpense ? 'editar despesa' : 'novo lançamento')
    : undefined;

  const headerBackLabel = screenMode === 'profile' || screenMode === 'expense' || screenMode === 'donate'
    ? 'Voltar'
    : (selectedExpense || selectedSettlement)
    ? 'voltar para lançamentos'
    : 'voltar para eventos';

  const handleOpenProfile = (originRect) => {
    if (!user) {
      setIsAuthOpen(true);
      return;
    }
    setPendingReturnAvatar(null);
    setAvatarOriginRect(originRect);
    setIsProfileOpen(true);
  };

  const handleSelectExpense = (expense, originInfo) => {
    const snapshot = originInfo?.element && !prefersReducedMotion()
      ? captureExpenseBubbleSnapshot(originInfo.element, {
          expenseId: expense.id,
          isOwn: originInfo.isOwn,
          scrollTop: feedScrollTopRef.current,
        })
      : null;
    setPendingReturnReceipt(null);
    setSuppressFeedReveal(false);
    setReceiptEntryOrigin(snapshot);
    setDetailRevealState(snapshot ? 'awaiting' : 'idle');
    setSelectedSettlementId(null);
    setSelectedExpenseId(expense.id);
  };

  const handleSelectSettlement = (settlement, originInfo) => {
    const snapshot = originInfo?.element && !prefersReducedMotion()
      ? captureExpenseBubbleSnapshot(originInfo.element, {
          expenseId: settlement.id,
          isOwn: originInfo.isOwn,
          scrollTop: feedScrollTopRef.current,
        })
      : null;
    setPendingReturnReceipt(null);
    setSuppressFeedReveal(false);
    setReceiptEntryOrigin(snapshot);
    setDetailRevealState(snapshot ? 'awaiting' : 'idle');
    setSelectedExpenseId(null);
    setSelectedSettlementId(settlement.id);
  };

  const handleHeaderBack = () => {
    if (screenMode === 'profile') {
      closeProfile();
      return;
    }
    if (screenMode === 'donate') {
      closeDonate();
      return;
    }
    if (screenMode === 'expense') {
      closeExpenseForm();
      return;
    }
    if (selectedExpense || selectedSettlement) {
      closeDetail();
      return;
    }
    clearActiveEventView();
  };

  const isEventFeed = screenMode === 'event' && activeTab === 'expenses' && !selectedExpense && !selectedSettlement;

  return (
    <div className="min-h-screen flex flex-col justify-between">
      {/* Main Content Area */}
      <main className="flex-1">
        {loading ? (
          <div className="app-status" role="status"><p>Carregando dividindin...</p></div>
        ) : error ? (
          <div className="app-status"><section className="app-status__card">
            <AlertCircle size={26} aria-hidden="true" />
            <h1>não foi possível abrir</h1><p role="alert">{error}</p>
            <button className="app-dialog__primary" onClick={() => { setError(''); clearActiveEventView(); }}>Voltar para meus eventos</button>
          </section></div>
        ) : (
          <div className={`events-home${screenMode === 'event' ? ' event-shell' : ''}`}>
            <div className={`events-home__shell${screenMode === 'event' ? ' event-shell__inner' : ''}${isEventFeed ? ' event-shell__inner--feed' : ''}`}>
              <AppHeader
                mode={screenMode}
                title={headerTitle}
                user={user}
                onProfile={handleOpenProfile}
                onDonate={() => setIsDonateOpen(true)}
                donateProgressPercent={sustainabilitySnapshot?.clampedPercent || 0}
                onBack={screenMode === 'home' ? undefined : handleHeaderBack}
                backLabel={headerBackLabel}
                pendingReturnAvatar={pendingReturnAvatar}
                onReturnAvatarDone={clearReturnAvatar}
                onRegisterBrandCapture={registerBrandCapture}
                brandFlightPhase={eventLoading.phase}
                pendingReturnBrand={eventLoading.phase === 'exiting' ? eventLoading.returnBrand : null}
                onReturnBrandDone={clearEventLoading}
              />

              {screenMode === 'profile' ? (
                <ProfileView
                  user={user}
                  userEvents={userEvents}
                  avatarOriginRect={avatarOriginRect}
                  onRegisterReturnCapture={registerReturnCapture}
                  onLogout={handleLogout}
                  onUserChange={updatedUser => {
                    setUser(updatedUser);
                    setUserEvents(current => current.map(item => ({ ...item, participants: item.participants?.map(person => person.user_id === updatedUser.id ? { ...person, name: updatedUser.name, avatar_version: updatedUser.avatar_version } : person) })));
                    setParticipants(current => current.map(person => person.user_id === updatedUser.id ? { ...person, name: updatedUser.name, avatar_version: updatedUser.avatar_version } : person));
                    setCurrentParticipant(current => (current && current.user_id === updatedUser.id ? { ...current, name: updatedUser.name, avatar_version: updatedUser.avatar_version } : current));
                  }}
                />
              ) : screenMode === 'donate' ? (
                <DonateView
                  initialSnapshot={sustainabilitySnapshot}
                  onSnapshotLoaded={setSustainabilitySnapshot}
                />
              ) : screenMode === 'expense' ? (
                <ExpenseFormView
                  participants={participants}
                  currentParticipant={currentParticipant}
                  editingExpense={editingExpense}
                  editingSettlement={editingSettlement}
                  simplifiedTransactions={balancesData.simplifiedTransactions}
                  initialEntry={initialEntry}
                  onBack={closeExpenseForm}
                  onSubmit={handleSaveExpense}
                  onSubmitPayment={handleRecordPayment}
                />
              ) : screenMode === 'home' ? (
                <EventsHome
                  events={userEvents}
                  currentUser={user}
                  onCreate={() => setIsNewEventOpen(true)}
                  onSelect={handleSelectEvent}
                  onRenameEvent={(targetEvent) => setEditingEventTarget(targetEvent)}
                  onDeleteEvent={handleDeleteEventFromHome}
                  onLeaveEvent={handleLeaveEvent}
                  onFinishDeleteEvent={handleFinishDeleteEventFromHome}
                />
              ) : (
                <EventShell
                  event={event}
                  balance={balancesData.userSummary?.netBalance}
                  userSummary={balancesData.userSummary}
                  activeTab={activeTab}
                  isCreator={Boolean(user?.id && event?.created_by && user.id === event.created_by)}
                  isParticipant={Boolean(currentParticipant)}
                  onEditEvent={() => setEditingEventTarget(event)}
                  onDeleteEvent={handleDeleteActiveEvent}
                  onLeaveEvent={() => handleLeaveEvent(event)}
                  detailTitle={selectedExpense?.description || (selectedSettlement ? 'pagamento' : undefined)}
                  detailFooter={selectedExpense && user && currentParticipant
                    ? <ExpenseDetailActions key={selectedExpense.id} expense={selectedExpense} onEdit={handleOpenEditExpense} onDelete={handleDeleteExpense} />
                    : selectedSettlement && user && currentParticipant
                      ? <SettlementDetailActions key={selectedSettlement.id} settlement={selectedSettlement} onEdit={handleOpenEditSettlement} onDelete={handleDeleteSettlement} />
                      : null}
                  detailReceipt={detailReceipt}
                  receiptEntryOrigin={receiptEntryOrigin}
                  onEntryMorphDone={clearEntryMorph}
                  pendingReturnReceipt={pendingReturnReceipt}
                  onReturnReceiptDone={clearReturnReceipt}
                  onRegisterDetailExitCapture={registerDetailExitCapture}
                  feedScrollTopRef={feedScrollTopRef}
                  feedScrollElRef={feedScrollElRef}
                  pendingNewFeedCount={pendingNewFeedCount}
                  onClearPendingNewFeed={clearPendingNewFeedCount}
                  suppressFeedReveal={suppressFeedReveal}
                  onTab={tab => {
                    setSelectedExpenseId(null);
                    setSelectedSettlementId(null);
                    setReceiptEntryOrigin(null);
                    setPendingReturnReceipt(null);
                    setDetailRevealState('idle');
                    setSuppressFeedReveal(false);
                    feedScrollTopRef.current = 0;
                    setPendingNewFeedCount(0);
                    setActiveTab(tab);
                  }}
                  onAdd={() => { if (!currentParticipant) { if (!user) setIsAuthOpen(true); else if (unclaimedParticipants.length) setShowClaimSheet(true); else handleJoinNew(); } else { setEditingExpense(null); setEditingSettlement(null); setInitialEntry(null); setIsAddExpenseOpen(true); } }}
                >
                  {/* Banner if user is not in this event yet */}
                  {!currentParticipant && (
                    <div className="event-shell__guest">
                      <div>
                        Você está visualizando como visitante deste evento.
                      </div>
                      <button
                        onClick={() => {
                          if (!user) setIsAuthOpen(true);
                          else if (unclaimedParticipants.length > 0) setShowClaimSheet(true);
                          else handleJoinNew();
                        }}
                      >
                        Entrar no Evento
                      </button>
                    </div>
                  )}

                  {selectedExpense ? <ExpenseDetails
                    key={selectedExpense.id}
                    expense={selectedExpense}
                    participants={participants}
                    user={user}
                    revealState={detailRevealState}
                  /> : selectedSettlement ? <SettlementDetails
                    key={selectedSettlement.id}
                    settlement={selectedSettlement}
                    participants={participants}
                    expenses={expenses}
                    settlements={balancesData.settlements}
                    user={user}
                    revealState={detailRevealState}
                  /> : activeTab === 'expenses' && (
                    <ExpenseFeed
                      eventId={event?.id || null}
                      expenses={expenses}
                      settlements={balancesData.settlements}
                      timelineEvents={timelineEvents}
                      participants={participants}
                      user={user}
                      feedScrollElRef={feedScrollElRef}
                      feedScrollTopRef={feedScrollTopRef}
                      onNewItemsWhileScrolled={handleNewItemsWhileScrolled}
                      onSelectExpense={handleSelectExpense}
                      onSelectSettlement={handleSelectSettlement}
                      onEditExpense={handleOpenEditExpense}
                      onDeleteExpense={handleDeleteExpense}
                      onOpenAddExpense={() => {
                        setEditingExpense(null);
                        setEditingSettlement(null);
                        setInitialEntry(null);
                        setIsAddExpenseOpen(true);
                      }}
                    />
                  )}

                  {activeTab === 'settlement' && (
                    <SettlementView
                      userSummary={balancesData.userSummary}
                      simplifiedTransactions={balancesData.simplifiedTransactions}
                      balances={balancesData.balances}
                      settlements={balancesData.settlements}
                      currentParticipant={currentParticipant}
                      onOpenRecordPayment={(tx) => {
                        setEditingExpense(null);
                        setEditingSettlement(null);
                        setInitialEntry(tx && tx.from && tx.to
                          ? { mode: 'payment', payerId: tx.from, recipientId: tx.to, amount: tx.amount }
                          : { mode: 'payment' });
                        setIsAddExpenseOpen(true);
                      }}
                      onDeleteSettlement={handleDeleteSettlement}
                      participants={participants}
                    />
                  )}

                  {activeTab === 'group' && (
                    <GroupView
                      event={event}
                      participants={participants}
                      balances={balancesData.balances}
                      currentParticipant={currentParticipant}
                      onAddParticipant={handleAddParticipant}
                      onRemoveParticipant={handleRemoveParticipant}
                    />
                  )}
                </EventShell>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Mobile Bottom Navigation (active if an event is selected OR on profile tab) */}

      {/* Drawers & Modals */}
      <ClaimSheet
        isOpen={showClaimSheet}
        unclaimedParticipants={unclaimedParticipants}
        user={user}
        onClaim={handleClaim}
        onJoinNew={handleJoinNew}
      />

      <AuthModal
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
        onAuthSuccess={handleAuthSuccess}
      />

      <NewEventModal
        isOpen={isNewEventOpen}
        onClose={() => setIsNewEventOpen(false)}
        onCreateEvent={handleCreateEvent}
      />

      <EditEventModal
        isOpen={Boolean(editingEventTarget)}
        event={editingEventTarget}
        onClose={() => setEditingEventTarget(null)}
        onSave={handleUpdateEvent}
      />

      <PostLoginInstallModal
        isOpen={Boolean(postLoginInstallPrompt)}
        mode={postLoginInstallPrompt?.mode}
        browserGuide={postLoginInstallPrompt?.browserGuide}
        onInstall={promptAppInstall}
        onClose={() => setPostLoginInstallPrompt(null)}
      />

      <EventLoadingOverlay
        phase={eventLoading.phase}
        entrySnapshot={eventLoading.entrySnapshot}
        onRegisterCenterCapture={registerLoadingCenterCapture}
      />

    </div>
  );
}
