import axios from 'axios';

const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || 'https://meu-sistema-nps-git-main-henriquemartins1987s-projects.vercel.app/'
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
