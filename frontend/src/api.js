import axios from 'axios';
import { clearSession, readToken } from './session';

const isBrowser = typeof window !== 'undefined';
const isLocalHost = isBrowser && ['localhost', '127.0.0.1'].includes(window.location.hostname);
const configuredApiUrl = process.env.REACT_APP_API_URL;
const fallbackProductionApiUrl = isBrowser ? '/api' : 'https://meu-sistema-nps-backend.onrender.com';
const fallbackLocalApiUrl = 'http://localhost:3001';

const api = axios.create({
  baseURL: configuredApiUrl || (isLocalHost ? fallbackLocalApiUrl : fallbackProductionApiUrl),
  timeout: 60000
});

export function getApiErrorMessage(error, fallback = 'Não foi possível concluir a operação.') {
  if (error?.code === 'ECONNABORTED') {
    return 'A API demorou para responder. Tente novamente em alguns instantes.';
  }

  if (!error?.response) {
    return 'Não foi possível conectar à API. Verifique se o backend está ativo.';
  }

  if (error.response.status === 401) {
    return error.response.data?.error || 'Sua sessão expirou. Faça login novamente.';
  }

  if (error.response.status === 403) {
    return error.response.data?.error || 'Seu perfil não tem permissão para acessar esta rotina.';
  }

  if (error.response.status === 503 && error.response.data?.code === 'SYSTEM_MAINTENANCE') {
    return error.response.data?.error || 'Sistema em Manutenção';
  }

  if (error.response.status === 422 || error.response.status === 400) {
    return error.response.data?.error || error.response.data?.message || 'Revise os dados informados.';
  }

  if (error.response.status >= 500) {
    return error.response.data?.error || 'O servidor encontrou uma falha ao processar a solicitação.';
  }

  return error.response.data?.error || error.response.data?.message || fallback;
}

api.interceptors.request.use((config) => {
  const token = readToken();

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      clearSession();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('nps:auth-expired', {
          detail: {
            code: error.response?.data?.code || 'AUTH_UNAUTHORIZED',
            message: getApiErrorMessage(error)
          }
        }));
      }
    }

    if (error.response?.status === 503 && error.response?.data?.code === 'SYSTEM_MAINTENANCE') {
      clearSession();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('nps:maintenance-mode', {
          detail: {
            code: 'SYSTEM_MAINTENANCE',
            message: getApiErrorMessage(error)
          }
        }));
      }
    }

    error.userMessage = getApiErrorMessage(error);

    return Promise.reject(error);
  }
);

export const apiBaseUrl = api.defaults.baseURL;

export default api;
