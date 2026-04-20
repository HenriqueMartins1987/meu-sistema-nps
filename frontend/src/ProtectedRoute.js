import React, { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { clearSession, hasActiveSession, touchSessionActivity } from './session';

export function ProtectedRoute() {
  const location = useLocation();
  const [sessionActive, setSessionActive] = useState(() => hasActiveSession());
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (!sessionActive) {
      return undefined;
    }

    const markActivity = () => {
      touchSessionActivity();
    };

    const validateSession = () => {
      const stillActive = hasActiveSession();

      if (!stillActive) {
        clearSession();
        setTimedOut(true);
        setSessionActive(false);
      }
    };

    const handleStorage = () => {
      const stillActive = hasActiveSession();
      setSessionActive(stillActive);
    };

    const activityEvents = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'];

    activityEvents.forEach((eventName) => {
      window.addEventListener(eventName, markActivity, { passive: true });
    });
    window.addEventListener('storage', handleStorage);

    touchSessionActivity();
    const intervalId = window.setInterval(validateSession, 15000);

    return () => {
      activityEvents.forEach((eventName) => {
        window.removeEventListener(eventName, markActivity);
      });
      window.removeEventListener('storage', handleStorage);
      window.clearInterval(intervalId);
    };
  }, [sessionActive]);

  useEffect(() => {
    const stillActive = hasActiveSession();
    setSessionActive(stillActive);
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

  return <Outlet />;
}

export function PublicOnlyRoute() {
  if (hasActiveSession()) {
    return <Navigate to="/home" replace />;
  }

  return <Outlet />;
}
