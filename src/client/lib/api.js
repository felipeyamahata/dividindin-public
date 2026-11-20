import { createSseParser } from '../../domain/eventSync.js';

const RAW_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

let maintenanceListener = null;

export function setMaintenanceListener(fn) {
  maintenanceListener = fn;
}

export function getApiUrl(endpoint) {
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  if (RAW_BASE) {
    return `${RAW_BASE}/api${cleanEndpoint}`;
  }
  const isDividePrefix = typeof window !== 'undefined' && window.location.pathname.startsWith('/divide');
  const prefix = isDividePrefix ? '/divide/api' : '/api';
  return `${prefix}${cleanEndpoint}`;
}

export function getClientMode() {
  if (typeof window === 'undefined') return null;
  if (window.matchMedia?.('(display-mode: standalone)')?.matches) return 'pwa';
  if (window.navigator?.standalone === true) return 'pwa';
  if (typeof document !== 'undefined' && document.referrer.startsWith('android-app://')) return 'pwa';
  return 'browser';
}

function buildAuthHeaders(extraHeaders = {}) {
  const clientMode = getClientMode();
  const headers = {
    'Content-Type': 'application/json',
    ...(clientMode ? { 'X-Client-Mode': clientMode } : {}),
    ...extraHeaders,
  };

  const storedToken = typeof localStorage !== 'undefined' ? localStorage.getItem('divide_token') : null;
  if (storedToken && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${storedToken}`;
  }

  return headers;
}

function sendPresenceSignal(endpoint, { keepalive = false } = {}) {
  return fetch(getApiUrl(endpoint), {
    method: 'POST',
    headers: buildAuthHeaders(),
    body: '{}',
    credentials: 'include',
    keepalive,
  }).catch(() => null);
}

export async function apiRequest(endpoint, options = {}) {
  const url = getApiUrl(endpoint);
  const headers = buildAuthHeaders(options.headers);

  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers,
      credentials: 'include',
    });
  } catch (err) {
    // Network failure (offline, tunnel unreachable, DNS error)
    if (maintenanceListener) {
      maintenanceListener(true);
    }
    throw new Error('Servidor temporariamente indisponível. Estamos em manutenção.');
  }

  // 502 Bad Gateway / 504 Gateway Timeout always indicate upstream/tunnel unavailability.
  if (response.status === 502 || response.status === 504) {
    if (maintenanceListener) {
      maintenanceListener(true);
    }
    throw new Error('Servidor temporariamente indisponível. Estamos em manutenção.');
  }

  const contentType = response.headers?.get?.('content-type') || '';
  if (response.status === 503 && !contentType.includes('application/json')) {
    if (maintenanceListener) {
      maintenanceListener(true);
    }
    throw new Error('Servidor temporariamente indisponível. Estamos em manutenção.');
  }

  // If request succeeded with valid HTTP response, clear maintenance flag
  if (maintenanceListener) {
    maintenanceListener(false);
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || 'Ocorreu um erro na requisição');
  }

  return data;
}

export const api = {
  // Auth
  getMe: () => apiRequest('/auth/me'),
  getProfile: () => apiRequest('/auth/profile'),
  updateProfile: (name) => apiRequest('/auth/profile', { method: 'PUT', body: JSON.stringify({ name }) }),
  updatePassword: (currentPassword, newPassword) => apiRequest('/auth/password', { method: 'PUT', body: JSON.stringify({ currentPassword, newPassword }) }),
  getAvatar: () => apiRequest('/auth/avatar'),
  getParticipantAvatar: (userId, version = null) => apiRequest(
    `/auth/avatar/${encodeURIComponent(userId)}${version ? `?v=${encodeURIComponent(version)}` : ''}`,
  ),
  updateAvatar: (image) => apiRequest('/auth/avatar', { method: 'PUT', body: JSON.stringify({ image }) }),
  login: async (username, password) => {
    const data = await apiRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    if (data.token && typeof localStorage !== 'undefined') {
      localStorage.setItem('divide_token', data.token);
    }
    return data;
  },
  loginWithGoogle: async (credential) => {
    const data = await apiRequest('/auth/google', {
      method: 'POST',
      body: JSON.stringify({ credential }),
    });
    if (data.token && typeof localStorage !== 'undefined') {
      localStorage.setItem('divide_token', data.token);
    }
    return data;
  },
  register: async (username, password, name) => {
    const data = await apiRequest('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, name }),
    });
    if (data.token && typeof localStorage !== 'undefined') {
      localStorage.setItem('divide_token', data.token);
    }
    return data;
  },
  logout: async () => {
    try {
      await apiRequest('/auth/logout', { method: 'POST' });
    } finally {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('divide_token');
      }
    }
  },

  // Events
  listEvents: () => apiRequest('/events'),
  createEvent: (title, description) => apiRequest('/events', { method: 'POST', body: JSON.stringify({ title, description }) }),
  updateEvent: (id, title, description) => apiRequest(`/events/${id}`, { method: 'PUT', body: JSON.stringify({ title, description }) }),
  getEvent: (code) => apiRequest(`/events/${code}`),
  deleteEvent: (id) => apiRequest(`/events/${id}`, { method: 'DELETE' }),
  addParticipant: (eventId, name) => apiRequest(`/events/${eventId}/participants`, { method: 'POST', body: JSON.stringify({ name }) }),
  getRemovalPreview: (eventId, participantId) => apiRequest(`/events/${eventId}/participants/${participantId}/removal-preview`),
  removeParticipant: (eventId, participantId, replacementPayerId = null) => apiRequest(`/events/${eventId}/participants/${participantId}`, {
    method: 'DELETE',
    body: JSON.stringify({ replacementPayerId }),
  }),
  claimParticipant: (eventId, participantId) => apiRequest(`/events/${eventId}/claim`, { method: 'POST', body: JSON.stringify({ participantId }) }),
  joinEvent: (eventId) => apiRequest(`/events/${eventId}/join`, { method: 'POST' }),
  leaveEvent: (eventId) => apiRequest(`/events/${eventId}/leave`, { method: 'POST' }),

  // Expenses
  getExpenses: (eventId) => apiRequest(`/events/${eventId}/expenses`),
  createExpense: (eventId, data) => apiRequest(`/events/${eventId}/expenses`, { method: 'POST', body: JSON.stringify(data) }),
  updateExpense: (id, data) => apiRequest(`/expenses/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteExpense: (id) => apiRequest(`/expenses/${id}`, { method: 'DELETE' }),

  // Settlements & Balances
  getBalances: (eventId) => apiRequest(`/events/${eventId}/balances`),
  createSettlement: (eventId, data) => apiRequest(`/events/${eventId}/settlements`, { method: 'POST', body: JSON.stringify(data) }),
  updateSettlement: (id, data) => apiRequest(`/settlements/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteSettlement: (id) => apiRequest(`/settlements/${id}`, { method: 'DELETE' }),

  // Self-sustainability & Pix donations
  getSustainability: () => apiRequest('/sustainability'),
  createSustainabilityPix: (amountCents) => apiRequest('/sustainability/pix', {
    method: 'POST',
    body: JSON.stringify({ amountCents }),
  }),
  getSustainabilityPixStatus: (paymentId) => apiRequest(`/sustainability/pix/${encodeURIComponent(paymentId)}/status`),

  // Lightweight product telemetry & presence lifecycle
  pingPresence: () => sendPresenceSignal('/auth/ping'),
  leavePresence: () => sendPresenceSignal('/auth/leave', { keepalive: true }),
  reportPwaInstalled: (source = 'appinstalled') => apiRequest('/auth/telemetry/pwa-installed', {
    method: 'POST',
    body: JSON.stringify({ source }),
  }).catch(() => null),

  openEventStream: async (endpoint, { signal, onReady, onEvent, onClose } = {}) => {
    const url = getApiUrl(endpoint);
    const headers = buildAuthHeaders({ Accept: 'text/event-stream' });
    delete headers['Content-Type'];

    let fatal = false;
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers,
        credentials: 'include',
        signal,
      });

      if (response.status === 401 || response.status === 403 || response.status === 404) {
        fatal = true;
        return;
      }

      if (!response.ok || !response.body) {
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const parser = createSseParser();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        const events = parser.feed(text);
        for (const evt of events) {
          if (evt.event === 'ready') {
            onReady?.(evt);
          } else {
            onEvent?.(evt);
          }
        }
      }
    } catch {
      // Aborted or transient network disconnect handled by caller reconnect loop.
    } finally {
      if (!signal?.aborted) {
        onClose?.({ fatal });
      }
    }
  },
};
