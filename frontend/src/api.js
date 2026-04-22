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
    }

    return Promise.reject(error);
  }
);

export const apiBaseUrl = api.defaults.baseURL;

export default api;
