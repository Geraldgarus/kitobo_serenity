// Dashboard specific functions

// Distinct color palette for Gantt bars — one per reservation slot
const GANTT_COLORS = [
  { bg: '#dbeafe', border: '#2563eb', text: '#1e3a8a' }, // blue
  { bg: '#dcfce7', border: '#16a34a', text: '#14532d' }, // green
  { bg: '#fce7f3', border: '#db2777', text: '#831843' }, // pink
  { bg: '#fef3c7', border: '#d97706', text: '#78350f' }, // amber
  { bg: '#ede9fe', border: '#7c3aed', text: '#3b0764' }, // purple
  { bg: '#fee2e2', border: '#dc2626', text: '#7f1d1d' }, // red
  { bg: '#ccfbf1', border: '#0d9488', text: '#134e4a' }, // teal
  { bg: '#ffedd5', border: '#ea580c', text: '#7c2d12' }, // orange
  { bg: '#f0fdf4', border: '#15803d', text: '#052e16' }, // emerald
  { bg: '#e0e7ff', border: '#4338ca', text: '#1e1b4b' }, // indigo
  { bg: '#fdf4ff', border: '#a21caf', text: '#4a044e' }, // fuchsia
  { bg: '#f0f9ff', border: '#0284c7', text: '#0c4a6e' }, // sky
];

function ganttColor(index) {
  return GANTT_COLORS[index % GANTT_COLORS.length];
}

function renderRoomIcon(emoji) {
  if (!emoji) return '<i class="fas fa-home"></i>';
  if (emoji.startsWith('fa-')) return `<i class="fas ${emoji}"></i>`;
  return emoji;
}

async function loadAndRenderDashboard() {
  try {
    [APARTMENTS, reservations] = await Promise.all([
      apiGet('/apartments'),
      apiGet('/reservations'),
    ]);
    
    console.log('=== Dashboard Loaded ===');
    renderStats();
    renderGantt();
  } catch (err) {
    showToast('Failed to load dashboard: ' + err.message, '<i class="fas fa-times-circle"></i>');
  }
}

function renderStats() {
  const now = new Date();
  const todayDate = new Date();
  todayDate.setHours(0, 0, 0, 0);
  const checkoutTimeToday = new Date(todayDate);
  checkoutTimeToday.setHours(11, 0, 0, 0);
  
  // Occupied: checkin <= now AND checkout+time > now (11:00 AM checkout)
  const occupied = reservations.filter(r => {
    const rCheckin = new Date(r.checkin);
    const rCheckout = new Date(r.checkout);
    rCheckout.setHours(11, 0, 0, 0);
    return rCheckin <= now && rCheckout > now;
  }).length;
  
  // Available: total apartments - occupied
  const available = APARTMENTS.length - occupied;
  
  // Checkouts today: checkout date is today AND current time is BEFORE 11:00 AM
  const checkoutsToday = reservations.filter(r => {
    const rCheckout = new Date(r.checkout);
    const isToday = rCheckout.toDateString() === todayDate.toDateString();
    return isToday && now < checkoutTimeToday;
  }).length;
  
  // Upcoming: checkin > today (future)
  const upcoming = reservations.filter(r => {
    const rCheckin = new Date(r.checkin);
    rCheckin.setHours(0, 0, 0, 0);
    return rCheckin > todayDate;
  }).length;
  
  document.getElementById('stat-occupied').textContent = occupied;
  document.getElementById('stat-available').textContent = available;
  document.getElementById('stat-checkouts').textContent = checkoutsToday;
  document.getElementById('stat-upcoming').textContent = upcoming;
  
  console.log(`<i class="fas fa-chart-bar"></i> Stats: Occupied=${occupied}, Checkouts=${checkoutsToday}, Time=${now.toLocaleTimeString()}`);
}

function renderGantt() {
  const wrap = document.getElementById('gantt-body');
  if (!wrap) return;
  
  const apts = APARTMENTS;
  
  // Generate days for Gantt chart
  const days = [];
  for (let i = 0; i < GANTT_DAYS; i++) {
    const d = addDays(currentGanttStart, i);
    days.push(d);
  }

  let html = `<div class="gantt-scroll-wrap"><table class="gantt-table"><thead>`;
  html += `<tr><th style="min-width:100px;">Room</th>`;
  
  // Header row with dates
  days.forEach(d => {
    const wknd = isWeekend(d);
    const tdy = isToday(d);
    const dayNum = d.getDate();
    const monthName = d.toLocaleString('en', { month: 'short' });
    html += `<th class="${wknd ? 'weekend' : ''} ${tdy ? 'today' : ''}" data-date="${formatDateForAPI(d)}">
      <span class="day-num">${dayNum}</span>
      <span class="day-month">${monthName}</span>
    </th>`;
  });
  html += '</td></thead><tbody>';

  // Build a stable color map: each reservation gets a unique color by its position in sorted list
  const allResIds = [...reservations].sort((a, b) => a.id - b.id).map(r => r.id);
  const resColorMap = {};
  allResIds.forEach((id, idx) => { resColorMap[id] = ganttColor(idx); });

  apts.forEach(apt => {
    // ── MAINTENANCE ROW ──────────────────────────────────────────
    if (apt.underMaintenance) {
      html += `<tr>
        <td style="padding:0 12px; min-width:100px; border-right:2px solid #dc2626; background:#fff5f5;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:18px;">${renderRoomIcon(apt.emoji)}</span>
            <span style="font-weight:600; color:#dc2626;">${escapeHtml(apt.name)}</span>
          </div>
        </td>
        <td colspan="${days.length}" style="padding:4px; background:#fff5f5;">
          <div style="background:#fee2e2; border:1px solid #fca5a5; border-left:4px solid #dc2626;
                      border-radius:6px; padding:6px 14px; display:flex; align-items:center; gap:10px;
                      cursor:default; height:36px; box-sizing:border-box;">
            <i class="fas fa-tools" style="color:#dc2626; font-size:14px; flex-shrink:0;"></i>
            <span style="font-weight:700; color:#dc2626; font-size:13px;">Under Maintenance</span>
            <span style="color:#b91c1c; font-size:11px; margin-left:4px;">— Room blocked, not available for reservations</span>
            <a href="/housekeeping" style="margin-left:auto; font-size:11px; color:#dc2626; font-weight:600; text-decoration:none; white-space:nowrap;">
              <i class="fas fa-external-link-alt"></i> Manage
            </a>
          </div>
        </td>
      </tr>`;
      return;
    }

    // ── NORMAL RESERVATION ROW ───────────────────────────────────
    const aptReservations = reservations.filter(r => {
      if (r.aptId !== apt.id) return false;
      const rCheckout = new Date(r.checkout);
      rCheckout.setHours(11, 0, 0, 0);
      return rCheckout > new Date();
    });
    
    html += `<tr>
      <td style="padding:0 12px; min-width:100px; border-right:2px solid ${apt.color}; background:#fafafa;">
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-size:18px;">${renderRoomIcon(apt.emoji)}</span>
          <span style="font-weight:600;">${escapeHtml(apt.name)}</span>
        </div>
      </td>`;
    
    let i = 0;
    while (i < days.length) {
      const currentDate = days[i];
      const currentDateStr = formatDateForAPI(currentDate);
      
      let reservationForDay = null;
      let reservationEndDate = null;
      let reservationStartDate = null;
      
      for (const res of aptReservations) {
        const checkinDate = formatDateForAPI(res.checkin);
        const checkoutDate = formatDateForAPI(res.checkout);
        if (currentDateStr >= checkinDate && currentDateStr < checkoutDate) {
          reservationForDay = res;
          reservationStartDate = checkinDate;
          reservationEndDate = checkoutDate;
          break;
        }
      }
      
      if (reservationForDay && reservationEndDate) {
        let span = 0;
        let startIndex = i;
        for (let j = 0; j < days.length; j++) {
          const dayStr = formatDateForAPI(days[j]);
          if (dayStr === reservationStartDate) {
            startIndex = j;
            break;
          }
        }
        for (let j = startIndex; j < days.length; j++) {
          const dayStr = formatDateForAPI(days[j]);
          if (dayStr < reservationEndDate) span++;
          else break;
        }
        if (i !== startIndex) {
          html += `<td colspan="${startIndex - i}" style="background:#fafafa;"> </td>`;
          i = startIndex;
        }
        const wkndClass = isWeekend(days[startIndex]) ? 'weekend' : '';
        const rColor = resColorMap[reservationForDay.id] || ganttColor(0);
        html += `<td colspan="${span}" class="${wkndClass}" style="padding:4px; background:#fff;">
          <div class="reservation-bar" onclick="openDetail(${reservationForDay.id})"
               style="background:${rColor.bg}; border-left:4px solid ${rColor.border}; color:${rColor.text};">
            <div class="guest-icon"><i class="fas fa-user" style="color:${rColor.border};"></i></div>
            <div class="guest-info">
              <div class="guest-name" style="color:${rColor.text};">${escapeHtml(reservationForDay.guest)}</div>
              <div class="guest-dates" style="color:${rColor.border}; opacity:0.85;">
                ${fmtDateShort(reservationForDay.checkin)} – ${fmtDateShort(reservationForDay.checkout)}
              </div>
            </div>
          </div>
        </td>`;
        i += span;
      } else {
        const wknd = isWeekend(currentDate);
        html += `<td class="${wknd ? 'weekend' : ''}" style="background:#fafafa;"> </td>`;
        i++;
      }
    }
    html += '</tr>';
  });
  
  html += '</tbody></table></div>';
  wrap.innerHTML = html;
  
  const startDate = currentGanttStart;
  const endDate = addDays(currentGanttStart, GANTT_DAYS - 1);
  const dateRangeElem = document.getElementById('gantt-date-range');
  if (dateRangeElem) {
    dateRangeElem.textContent = 
      `${startDate.getDate()} ${startDate.toLocaleString('en', { month: 'short' })} – ${endDate.getDate()} ${endDate.toLocaleString('en', { month: 'short' })} ${endDate.getFullYear()}`;
  }
}

function ganttPrev() { 
  currentGanttStart = addDays(currentGanttStart, -GANTT_DAYS); 
  renderGantt(); 
}

function ganttNext() { 
  currentGanttStart = addDays(currentGanttStart, GANTT_DAYS); 
  renderGantt(); 
}

function ganttToday() { 
  currentGanttStart = addDays(new Date(), -Math.floor(GANTT_DAYS / 2));
  renderGantt(); 
}

async function openDetail(resId) {
  try {
    const detailBody = document.getElementById('detail-body');
    if (detailBody) {
      detailBody.innerHTML = `<div style="text-align:center;padding:40px;"><i class="fas fa-spinner fa-spin"></i> Loading...</div>`;
    }
    document.getElementById('panel-overlay').classList.add('open');
    document.getElementById('detail-panel').classList.add('open');
    
    const res = await apiGet(`/reservations/${resId}`);
    selectedReservation = res;
    const apt = getApt(res.aptId) || { name: res.aptName || '—' };
    const nights = daysBetween(res.checkin, res.checkout);
    const now = new Date();
    const rCheckout = new Date(res.checkout);
    rCheckout.setHours(11, 0, 0, 0);
    const isActive = rCheckout > now;
    
    // Get payment status badge
    let paymentBadge = '';
    if (res.paymentStatus === 'paid') {
      paymentBadge = '<span style="background:#d1fae5; color:#065f46; padding:4px 12px; border-radius:20px; font-size:12px;"><i class="fas fa-check-circle"></i> Paid in Full</span>';
    } else if (res.paymentStatus === 'partial') {
      paymentBadge = `<span style="background:#fef3c7; color:#d97706; padding:4px 12px; border-radius:20px; font-size:12px;"><i class="fas fa-circle" style="color:#f59e0b"></i> Partial Payment (Due: ${fmtAmount(res.balance || 0, res.currency)})</span>`;
    } else {
      paymentBadge = '<span style="background:#fee2e2; color:#dc2626; padding:4px 12px; border-radius:20px; font-size:12px;"><i class="fas fa-times-circle"></i> Unpaid</span>';
    }
    
    const checkoutBtn = document.getElementById('checkout-btn');
    if (checkoutBtn) checkoutBtn.style.display = isActive ? 'flex' : 'none';
    
    if (detailBody) {
      detailBody.innerHTML = `
        <div class="detail-row"><div class="detail-icon"><i class="fas fa-user"></i></div><div><div class="detail-label">Guest Name</div><div class="detail-value">${escapeHtml(res.guest)}</div></div></div>
        <div class="detail-row"><div class="detail-icon"><i class="fas fa-envelope"></i></div><div><div class="detail-label">Email</div><div class="detail-value">${escapeHtml(res.email)}</div></div></div>
        <div class="detail-row"><div class="detail-icon"><i class="fas fa-mobile-alt"></i></div><div><div class="detail-label">Mobile</div><div class="detail-value">${escapeHtml(res.mobile || '—')}</div></div></div>
        <div class="detail-row"><div class="detail-icon"><i class="fas fa-id-card"></i></div><div><div class="detail-label">ID Type</div><div class="detail-value">${escapeHtml(res.idType || '—')}</div></div></div>
        <div class="detail-row"><div class="detail-icon"><i class="fas fa-clipboard-list"></i></div><div><div class="detail-label">ID Number</div><div class="detail-value">${escapeHtml(res.identification || '—')}</div></div></div>
        <div class="detail-row"><div class="detail-icon"><i class="fas fa-globe-africa"></i></div><div><div class="detail-label">Country</div><div class="detail-value">${escapeHtml(res.country || '—')}</div></div></div>
        <div class="detail-row"><div class="detail-icon"><i class="fas fa-city"></i></div><div><div class="detail-label">City</div><div class="detail-value">${escapeHtml(res.city || '—')}</div></div></div>
        <div class="detail-row"><div class="detail-icon"><i class="fas fa-home"></i></div><div><div class="detail-label">Room</div><div class="detail-value">${escapeHtml(apt.name)}</div></div></div>
        <div class="detail-row"><div class="detail-icon"><i class="fas fa-credit-card"></i></div><div><div class="detail-label">Rate Type</div><div class="detail-value">${escapeHtml(res.rateType)}</div></div></div>
        <div class="detail-row"><div class="detail-icon"><i class="fas fa-calendar-alt"></i></div><div><div class="detail-label">Check-in</div><div class="detail-value">${fmtDate(res.checkin)}</div></div></div>
        <div class="detail-row"><div class="detail-icon"><i class="fas fa-calendar-alt"></i></div><div><div class="detail-label">Check-out</div><div class="detail-value">${fmtDate(res.checkout)} at 11:00 AM</div></div></div>
        <div class="detail-row"><div class="detail-icon"><i class="fas fa-moon"></i></div><div><div class="detail-label">Nights</div><div class="detail-value">${nights} night${nights !== 1 ? 's' : ''}</div></div></div>
        <div class="detail-row"><div class="detail-icon"><i class="fas fa-users"></i></div><div><div class="detail-label">Adults / Children</div><div class="detail-value">${res.adults} Adults, ${res.children} Children</div></div></div>
        
        <!-- PAYMENT SECTION -->
        <div style="margin-top: 16px; border-top: 1px solid #e2e8f0; padding-top: 16px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <div class="detail-label" style="font-size: 13px;"><i class="fas fa-money-bill-wave"></i> Payment Status</div>
            <div>${paymentBadge}</div>
          </div>
          <div class="detail-row"><div class="detail-icon"><i class="fas fa-credit-card"></i></div><div><div class="detail-label">Payment Method</div><div class="detail-value">${escapeHtml(res.paymentMethod || '—')}</div></div></div>
          <div class="detail-row"><div class="detail-icon"><i class="fas fa-dollar-sign"></i></div><div><div class="detail-label">Amount Paid</div><div class="detail-value">${fmtAmount(res.amountPaid || 0, res.currency)}</div></div></div>
          <div class="detail-row"><div class="detail-icon"><i class="fas fa-balance-scale"></i></div><div><div class="detail-label">Balance Due</div><div class="detail-value">${fmtAmount(res.balance || 0, res.currency)}</div></div></div>
        </div>

        <div class="detail-total"><span>Total Rate</span><span>${fmtAmount(res.total, res.currency)}</span></div>
        ${isActive ? `<div style="margin-top:16px;padding:12px;background:#e8f5e9;border-radius:8px;text-align:center;"><i class="fas fa-circle" style="color:#22c55e"></i> Currently staying - Checkout at 11:00 AM</div>` : `<div style="margin-top:16px;padding:12px;background:#f5f5f5;border-radius:8px;text-align:center;"><i class="fas fa-check-circle"></i> Reservation completed</div>`}
      `;
    }
  } catch (err) {
    showToast('Could not load reservation: ' + err.message, '<i class="fas fa-times-circle"></i>');
  }
}

function closeDetailPanel() {
  document.getElementById('detail-panel')?.classList.remove('open');
  document.getElementById('panel-overlay')?.classList.remove('open');
  selectedReservation = null;
}

async function deleteSelectedReservation() {
  if (!selectedReservation) return;
  if (!confirm(`Delete reservation for ${selectedReservation.guest}?`)) return;
  try {
    await apiDelete(`/reservations/${selectedReservation.id}`);
    closeDetailPanel();
    await loadAndRenderDashboard();
    showToast('Reservation deleted', '<i class="fas fa-trash-alt"></i>');
  } catch (err) {
    showToast('Delete failed: ' + err.message, '<i class="fas fa-times-circle"></i>');
  }
}

async function checkoutReservation() {
  if (!selectedReservation) {
    showToast('No reservation selected', '<i class="fas fa-exclamation-triangle"></i>');
    return;
  }
  const today = formatDateForAPI(new Date());
  const currentCheckout = formatDateForAPI(selectedReservation.checkout);
  if (currentCheckout <= today) {
    showToast('Guest is already checked out', '<i class="fas fa-info-circle"></i>');
    closeDetailPanel();
    await loadAndRenderDashboard();
    return;
  }
  const nightsOriginal = daysBetween(selectedReservation.checkin, selectedReservation.checkout);
  const nightsNew = daysBetween(selectedReservation.checkin, today);
  const pricePerNight = selectedReservation.total / nightsOriginal;
  const newTotal = Math.round(pricePerNight * nightsNew);
  if (!confirm(`Checkout ${selectedReservation.guest} today?\nOriginal total: ${fmtAmount(selectedReservation.total, selectedReservation.currency)}\nNew total: ${fmtAmount(newTotal, selectedReservation.currency)}`)) return;
  try {
    const payload = { ...selectedReservation, checkout: today, total: newTotal };
    await apiPut(`/reservations/${selectedReservation.id}`, payload);
    showToast(`<i class="fas fa-check-circle"></i> ${selectedReservation.guest} checked out! New total: ${fmtAmount(newTotal, selectedReservation.currency)}`, '<i class="fas fa-door-open"></i>');
    closeDetailPanel();
    await loadAndRenderDashboard();
  } catch (err) {
    showToast('Checkout failed: ' + err.message, '<i class="fas fa-times-circle"></i>');
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>]/g, function(m) {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    return m;
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  currentGanttStart = addDays(new Date(), -Math.floor(GANTT_DAYS / 2));
  try {
    APARTMENTS = await apiGet('/apartments');
    await loadAndRenderDashboard();
  } catch (err) {
    showToast('<i class="fas fa-exclamation-triangle"></i> Cannot reach API server.', '<i class="fas fa-times-circle"></i>');
  }
});

window.openDetail = openDetail;
window.closeDetailPanel = closeDetailPanel;
window.deleteSelectedReservation = deleteSelectedReservation;
window.ganttPrev = ganttPrev;
window.ganttNext = ganttNext;
window.ganttToday = ganttToday;
window.checkoutReservation = checkoutReservation;