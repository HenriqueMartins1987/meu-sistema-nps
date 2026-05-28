import React, { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import AuthenticatedLayout from './AuthenticatedLayout';
import { hasPermission, isMasterAdmin, readUser } from './constants';
import {
  clearSession,
  getRemainingSessionMs,
  hasActiveSession,
  touchSessionActivity,
  SESSION_IDLE_LIMIT_MS
} from './session';

function formatRemainingTime(remainingMs) {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function ProtectedRoute() {
  const location = useLocation();
  const [sessionActive, setSessionActive] = useState(() => hasActiveSession());
  const [timedOut, setTimedOut] = useState(false);
  const [remainingMs, setRemainingMs] = useState(() => getRemainingSessionMs());

  useEffect(() => {
    if (!sessionActive) {
      return undefined;
    }

    const markActivity = () => {
      touchSessionActivity();
      setRemainingMs(SESSION_IDLE_LIMIT_MS);
    };

    const validateSession = () => {
      const nextRemainingMs = getRemainingSessionMs();
      setRemainingMs(nextRemainingMs);
      const stillActive = hasActiveSession();

      if (!stillActive || nextRemainingMs <= 0) {
        clearSession();
        setTimedOut(true);
        setSessionActive(false);
      }
    };

    const handleStorage = () => {
      const stillActive = hasActiveSession();
      setSessionActive(stillActive);
      setRemainingMs(getRemainingSessionMs());
    };

    const activityEvents = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click'];

    activityEvents.forEach((eventName) => {
      window.addEventListener(eventName, markActivity, { passive: true });
    });
    window.addEventListener('storage', handleStorage);
    window.addEventListener('nps:auth-expired', handleStorage);
    window.addEventListener('nps:maintenance-mode', handleStorage);

    touchSessionActivity();
    setRemainingMs(SESSION_IDLE_LIMIT_MS);
    const intervalId = window.setInterval(validateSession, 1000);

    return () => {
      activityEvents.forEach((eventName) => {
        window.removeEventListener(eventName, markActivity);
      });
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('nps:auth-expired', handleStorage);
      window.removeEventListener('nps:maintenance-mode', handleStorage);
      window.clearInterval(intervalId);
    };
  }, [sessionActive]);

  useEffect(() => {
    const stillActive = hasActiveSession();
    setSessionActive(stillActive);
    setRemainingMs(getRemainingSessionMs());

    if (stillActive) {
      setTimedOut(false);
    }
  }, [location.pathname, location.search]);

  if (!sessionActive) {
    return (
      <Navigate
        to="/"
        replace
        state={{
          from: location.pathname + location.search,
          reason: timedOut ? 'idle_timeout' : undefined
        }}
      />
    );
  }

  return (
    <AuthenticatedLayout
      remainingMsLabel={formatRemainingTime(remainingMs)}
      remainingWarning={remainingMs <= 5 * 60 * 1000}
    />
  );
}

export function PermissionRoute({ permission = '', masterOnly = false }) {
  const location = useLocation();
  const user = readUser();
  const allowed = masterOnly ? isMasterAdmin(user) : hasPermission(user, permission);

  if (!allowed) {
    return <Navigate to="/home" replace state={{ from: location.pathname + location.search, reason: 'forbidden' }} />;
  }

  return <Outlet />;
}

export function PublicOnlyRoute() {
  if (hasActiveSession()) {
    return <Navigate to="/home" replace />;
  }

  return <Outlet />;
}
