import { readUser } from './constants';

export const SESSION_IDLE_LIMIT_MS = 20 * 60 * 1000;

const TOKEN_KEY = 'token';
const USER_KEY = 'user';
const LAST_ACTIVITY_KEY = 'session_last_activity_at';

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function readToken() {
  if (!canUseStorage()) return '';
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function touchSessionActivity() {
  if (!canUseStorage()) return;
  localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
}

export function readSessionLastActivityAt() {
  if (!canUseStorage()) return 0;

  const lastActivityAt = Number(localStorage.getItem(LAST_ACTIVITY_KEY) || 0);
  return Number.isFinite(lastActivityAt) && lastActivityAt > 0 ? lastActivityAt : 0;
}

export function saveSession(token, user) {
  if (!canUseStorage()) return;
  localStorage.setItem(TOKEN_KEY, token || '');
  localStorage.setItem(USER_KEY, JSON.stringify(user || null));
  touchSessionActivity();
}

export function updateStoredUser(user) {
  if (!canUseStorage()) return;
  localStorage.setItem(USER_KEY, JSON.stringify(user || null));
  touchSessionActivity();
}

export function clearSession() {
  if (!canUseStorage()) return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(LAST_ACTIVITY_KEY);
}

export function getRemainingSessionMs() {
  const token = readToken();
  const user = readUser();

  if (!token || !(user?.id || user?.email)) {
    return 0;
  }

  if (!canUseStorage()) {
    return SESSION_IDLE_LIMIT_MS;
  }

  const lastActivityAt = readSessionLastActivityAt();

  if (!lastActivityAt) {
    touchSessionActivity();
    return SESSION_IDLE_LIMIT_MS;
  }

  return Math.max(0, SESSION_IDLE_LIMIT_MS - (Date.now() - lastActivityAt));
}

export function hasActiveSession() {
  const token = readToken();
  const user = readUser();

  if (!token || !(user?.id || user?.email)) {
    return false;
  }

  if (!canUseStorage()) {
    return true;
  }

  const lastActivityAt = readSessionLastActivityAt();

  if (!lastActivityAt) {
    touchSessionActivity();
    return true;
  }

  if (Date.now() - lastActivityAt > SESSION_IDLE_LIMIT_MS) {
    clearSession();
    return false;
  }

  return true;
}
