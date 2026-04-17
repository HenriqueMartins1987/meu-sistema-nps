import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { readUser } from './constants';

function hasSession() {
  const token = localStorage.getItem('token');
  const user = readUser();
  return Boolean(token && (user?.id || user?.email));
}

export function ProtectedRoute() {
  const location = useLocation();

  if (!hasSession()) {
    return <Navigate to="/" replace state={{ from: location.pathname + location.search }} />;
  }

  return <Outlet />;
}

export function PublicOnlyRoute() {
  if (hasSession()) {
    return <Navigate to="/home" replace />;
  }

  return <Outlet />;
}
