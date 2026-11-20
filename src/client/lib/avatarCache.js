import { api } from './api.js';

const memoryCache = new Map();
const pending = new Map();
const listeners = new Map();

function storageKey(userId) {
  return `divide_avatar_${userId}`;
}

function readLocalStorage(userId) {
  if (typeof localStorage === 'undefined' || !userId) return null;
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.version === 'string' && typeof parsed.image === 'string') {
      return parsed;
    }
  } catch {
    // Cache is optional.
  }
  return null;
}

function writeLocalStorage(userId, entry) {
  if (typeof localStorage === 'undefined' || !userId || !entry) return;
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(entry));
  } catch {
    // Cache is optional.
  }
}

function notify(userId, entry) {
  const subs = listeners.get(userId);
  if (!subs) return;
  for (const fn of subs) {
    try {
      fn(entry);
    } catch {
      // Ignore subscriber failure.
    }
  }
}

export async function preloadAvatarImage(src) {
  if (!src || typeof Image === 'undefined') return;
  const img = new Image();
  img.src = src;
  if (typeof img.decode === 'function') {
    await img.decode().catch(() => {});
  }
}

export function getCachedAvatar(userId, version) {
  if (!userId || !version) return null;
  const inMemory = memoryCache.get(userId);
  if (inMemory?.version === version) {
    return inMemory.image;
  }
  const inStorage = readLocalStorage(userId);
  if (inStorage?.version === version) {
    memoryCache.set(userId, inStorage);
    return inStorage.image;
  }
  return null;
}

export function setCachedAvatar(userId, version, image) {
  if (!userId || !version || !image) return;
  const entry = { version, image };
  memoryCache.set(userId, entry);
  writeLocalStorage(userId, entry);
  notify(userId, entry);
}

export function subscribeAvatarCache(userId, listener) {
  if (!userId || typeof listener !== 'function') return () => {};
  let subs = listeners.get(userId);
  if (!subs) {
    subs = new Set();
    listeners.set(userId, subs);
  }
  subs.add(listener);
  return () => {
    subs.delete(listener);
    if (subs.size === 0) listeners.delete(userId);
  };
}

export function loadAndDecodeAvatar(userId, version, { useSelfEndpoint = false } = {}) {
  if (!userId || !version) return Promise.resolve(null);
  const existing = getCachedAvatar(userId, version);
  if (existing) {
    return preloadAvatarImage(existing).then(() => existing);
  }

  const key = `${userId}:${version}`;
  if (!pending.has(key)) {
    const request = (useSelfEndpoint ? api.getAvatar() : api.getParticipantAvatar(userId, version))
      .then(async ({ avatar }) => {
        if (!avatar || avatar.version !== version || !avatar.image) return null;
        await preloadAvatarImage(avatar.image);
        setCachedAvatar(userId, avatar.version, avatar.image);
        return avatar.image;
      })
      .finally(() => {
        pending.delete(key);
      });
    pending.set(key, request);
  }

  return pending.get(key);
}
