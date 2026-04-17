import axios from 'axios';

const isBrowser = typeof window !== 'undefined';
const isLocalHost = isBrowser && ['localhost', '127.0.0.1'].includes(window.location.hostname);
const configuredApiUrl = process.env.REACT_APP_API_URL;
const fallbackProductionApiUrl = '/api';
const fallbackLocalApiUrl = 'http://localhost:3001';

const api = axios.create({
  baseURL: configuredApiUrl || (isLocalHost ? fallbackLocalApiUrl : fallbackProductionApiUrl),
  timeout: 30000
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

export const apiBaseUrl = api.defaults.baseURL;

export default api;
