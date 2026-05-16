// API Configuration
const API_BASE = '/api';

// Get token from session storage
function getAuthToken() {
  return sessionStorage.getItem('token');
}

// Handle unauthorized responses - redirect to login
function handleUnauthorized(response) {
  if (response.status === 401 || response.status === 403) {
    sessionStorage.clear();
    window.location.href = '/login';
    throw new Error('Session expired. Please login again.');
  }
  return response;
}

async function apiFetch(path, opts = {}) {
  const token = getAuthToken();
  
  // Build headers with authentication
  const headers = {
    'Content-Type': 'application/json',
    ...(token && { 'Authorization': `Bearer ${token}` }),
    ...opts.headers
  };
  
  const res = await fetch(API_BASE + path, {
    headers,
    ...opts,
  });
  
  // Handle unauthorized before checking ok
  handleUnauthorized(res);
  
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'API error');
  return data;
}

async function apiGet(path) { 
  const data = await apiFetch(path);
  return data;
}

async function apiPost(path, body) { 
  // Create a clean copy and ensure dates are preserved as strings
  const cleanBody = { ...body };
  
  // CRITICAL: Keep dates exactly as they come from the input (YYYY-MM-DD)
  // Do NOT convert to Date objects or ISO strings
  if (cleanBody.checkin && typeof cleanBody.checkin === 'object') {
    cleanBody.checkin = `${cleanBody.checkin.getFullYear()}-${String(cleanBody.checkin.getMonth() + 1).padStart(2, '0')}-${String(cleanBody.checkin.getDate()).padStart(2, '0')}`;
  }
  if (cleanBody.checkout && typeof cleanBody.checkout === 'object') {
    cleanBody.checkout = `${cleanBody.checkout.getFullYear()}-${String(cleanBody.checkout.getMonth() + 1).padStart(2, '0')}-${String(cleanBody.checkout.getDate()).padStart(2, '0')}`;
  }
  
  console.log('📤 Sending to API:', { checkin: cleanBody.checkin, checkout: cleanBody.checkout });
  
  return apiFetch(path, { method: 'POST', body: JSON.stringify(cleanBody) }); 
}

async function apiPut(path, body) { 
  const cleanBody = { ...body };
  if (cleanBody.checkin && typeof cleanBody.checkin === 'object') {
    cleanBody.checkin = `${cleanBody.checkin.getFullYear()}-${String(cleanBody.checkin.getMonth() + 1).padStart(2, '0')}-${String(cleanBody.checkin.getDate()).padStart(2, '0')}`;
  }
  if (cleanBody.checkout && typeof cleanBody.checkout === 'object') {
    cleanBody.checkout = `${cleanBody.checkout.getFullYear()}-${String(cleanBody.checkout.getMonth() + 1).padStart(2, '0')}-${String(cleanBody.checkout.getDate()).padStart(2, '0')}`;
  }
  return apiFetch(path, { method: 'PUT', body: JSON.stringify(cleanBody) }); 
}

async function apiDelete(path) { 
  return apiFetch(path, { method: 'DELETE' }); 
}

// Global state
let APARTMENTS = [];
let reservations = [];
let currentGanttStart = new Date();
const GANTT_DAYS = 15;
let selectedReservation = null;
let hkTasks = {};
let filteredAptId = null;