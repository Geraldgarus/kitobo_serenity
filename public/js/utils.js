// Utility Functions - NO TIMEZONE CONVERSION

function formatDateForAPI(date) {
  if (!date) return null;
  // If it's already a string in YYYY-MM-DD format, return as is
  if (typeof date === 'string' && date.match(/^\d{4}-\d{2}-\d{2}$/)) {
    return date;
  }
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function fmtDate(d) {
  if (!d) return '—';
  // Handle YYYY-MM-DD string directly
  let dateStr = d;
  if (typeof d === 'object') {
    dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  // Parse as local date
  const [year, month, day] = dateStr.split('-');
  return `${day}/${month}/${year}`;
}

function fmtDateShort(d) {
  if (!d) return '—';
  let dateStr = d;
  if (typeof d === 'object') {
    dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  const [year, month, day] = dateStr.split('-');
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${parseInt(day)} ${monthNames[parseInt(month) - 1]} ${year}`;
}

function fmtTSH(n) { 
  return 'TSH ' + Number(n).toLocaleString(); 
}

function daysBetween(a, b) {
  // Parse dates as local
  const aStr = typeof a === 'string' ? a : formatDateForAPI(a);
  const bStr = typeof b === 'string' ? b : formatDateForAPI(b);
  const aDate = new Date(aStr + 'T12:00:00');
  const bDate = new Date(bStr + 'T12:00:00');
  const diffTime = Math.abs(bDate - aDate);
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

function addDays(date, n) { 
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d; 
}

function isoDate(d) {
  const date = new Date(d);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isWeekend(date) { 
  const d = new Date(date);
  const day = d.getDay();
  return day === 0 || day === 6; 
}

function isToday(date) { 
  const today = new Date();
  const d = new Date(date);
  return d.getDate() === today.getDate() && 
         d.getMonth() === today.getMonth() && 
         d.getFullYear() === today.getFullYear();
}

function getApt(id) { 
  return APARTMENTS.find(a => a.id === id); 
}

function showToast(msg, icon = '<i class="fas fa-check-circle"></i>') {
  let tc = document.getElementById('toast-container');
  if (!tc) {
    tc = document.createElement('div');
    tc.id = 'toast-container';
    tc.className = 'toast-container';
    document.body.appendChild(tc);
  }
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = `<span>${icon}</span><span>${msg}</span>`;
  tc.appendChild(t);
  setTimeout(() => t.remove(), 3100);
}

function setLoading(containerId, isLoading) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (isLoading) {
    el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--gray-300)"><i class="fas fa-spinner fa-spin"></i> Loading…</div>';
  }
}
