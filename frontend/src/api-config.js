// Public backend URL only. Never put an API key in a VITE_ variable.
export const API_BASE=(import.meta.env?.VITE_API_URL||'http://localhost:5000/api').replace(/\/+$/,'');
