// Dashboard specific functions
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
    showToast('Failed to load dashboard: ' + err.message, '❌');
  }
}

function renderStats() {
  const today = formatDateForAPI(new Date());
  
  // Occupied: checkin <= today < checkout
  const occupied = reservations.filter(r => {
    const checkin = formatDateForAPI(r.checkin);
    const checkout = formatDateForAPI(r.checkout);
    return checkin <= today && checkout > today;
  }).length;
  
  // Available: total apartments - occupied
  const available = APARTMENTS.length - occupied;
  
  // Checkouts today: checkout == today
  const checkoutsToday = reservations.filter(r => {
    const checkout = formatDateForAPI(r.checkout);
    return checkout === today;
  }).length;
  
  // Upcoming: checkin > today (future)
  const upcoming = reservations.filter(r => {
    const checkin = formatDateForAPI(r.checkin);
    return checkin > today;
  }).length;
  
  // Total Revenue: sum of all totals
  const totalRevenue = reservations.reduce((sum, r) => sum + (r.total || 0), 0);
  
  document.getElementById('stat-occupied').textContent = occupied;
  document.getElementById('stat-available').textContent = available;
  document.getElementById('stat-checkouts').textContent = checkoutsToday;
  document.getElementById('stat-upcoming').textContent = upcoming;
  document.getElementById('stat-revenue').textContent = fmtTSH(totalRevenue);
}

function renderGantt() {
  const wrap = document.getElementById('gantt-body');
  if (!wrap) return;
  
  const today = formatDateForAPI(new Date());
  const apts = APARTMENTS;
  
  // Generate days for Gantt chart
  const days = [];
  for (let i = 0; i < GANTT_DAYS; i++) {
    const d = addDays(currentGanttStart, i);
    days.push(d);
  }

  let html = `<div class="gantt-scroll-wrap"><table class="gantt-table"><thead>`;
  html += `<tr><th style="min-width:100px;">Apartment</th>`;
  
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

  apts.forEach(apt => {
    const aptReservations = reservations.filter(r => 
      r.aptId === apt.id && 
      formatDateForAPI(r.checkout) > today
    );
    
    html += `<tr>
      <td style="padding:0 12px; min-width:100px; border-right:2px solid ${apt.color}; background:#fafafa;">
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-size:20px;">${apt.emoji || '🏠'}</span>
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
          html += `<td colspan="${startIndex - i}" style="background:#fafafa;"> </td>`;
          i = startIndex;
        }
        const wkndClass = isWeekend(days[startIndex]) ? 'weekend' : '';
        html += `<td colspan="${span}" class="${wkndClass}" style="padding:4px; background:#fff;">
          <div class="reservation-bar" onclick="openDetail(${reservationForDay.id})" 
               style="background:${apt.color}20; border-left:3px solid ${apt.color};">
            <div class="guest-icon">👤</div>
            <div class="guest-info">
              <div class="guest-name">${escapeHtml(reservationForDay.guest)}</div>
              <div class="guest-dates">
                ${fmtDateShort(reservationForDay.checkin)} – ${fmtDateShort(reservationForDay.checkout)}
              </div>
            </div>
          </div>
        </td>`;
        i += span;
      } else {
        const wknd = isWeekend(currentDate);
        html += `<td class="${wknd ? 'weekend' : ''}" style="background:#fafafa;"> </td>`;
        i++;
      }
    }
    html += '<tr>';
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
      detailBody.innerHTML = `<div style="text-align:center;padding:40px;">⏳ Loading...</div>`;
    }
    document.getElementById('panel-overlay').classList.add('open');
    document.getElementById('detail-panel').classList.add('open');
    
    const res = await apiGet(`/reservations/${resId}`);
    selectedReservation = res;
    const apt = getApt(res.aptId) || { name: res.aptName || '—' };
    const nights = daysBetween(res.checkin, res.checkout);
    const today = formatDateForAPI(new Date());
    const isActive = formatDateForAPI(res.checkout) > today;
    
    const checkoutBtn = document.getElementById('checkout-btn');
    if (checkoutBtn) checkoutBtn.style.display = isActive ? 'flex' : 'none';
    
    if (detailBody) {
      detailBody.innerHTML = `
        <div class="detail-row"><div class="detail-icon">👤</div><div><div class="detail-label">Guest Name</div><div class="detail-value">${escapeHtml(res.guest)}</div></div></div>
        <div class="detail-row"><div class="detail-icon">📧</div><div><div class="detail-label">Email</div><div class="detail-value">${escapeHtml(res.email)}</div></div></div>
        <div class="detail-row"><div class="detail-icon">📱</div><div><div class="detail-label">Mobile</div><div class="detail-value">${escapeHtml(res.mobile || '—')}</div></div></div>
        <div class="detail-row"><div class="detail-icon">🌍</div><div><div class="detail-label">Country</div><div class="detail-value">${escapeHtml(res.country || '—')}</div></div></div>
        <div class="detail-row"><div class="detail-icon">🏙️</div><div><div class="detail-label">City</div><div class="detail-value">${escapeHtml(res.city || '—')}</div></div></div>
        <div class="detail-row"><div class="detail-icon">🏠</div><div><div class="detail-label">Apartment</div><div class="detail-value">${escapeHtml(apt.name)}</div></div></div>
        <div class="detail-row"><div class="detail-icon">💳</div><div><div class="detail-label">Rate Type</div><div class="detail-value">${escapeHtml(res.rateType)}</div></div></div>
        <div class="detail-row"><div class="detail-icon">📅</div><div><div class="detail-label">Check-in</div><div class="detail-value">${fmtDate(res.checkin)}</div></div></div>
        <div class="detail-row"><div class="detail-icon">📅</div><div><div class="detail-label">Check-out</div><div class="detail-value">${fmtDate(res.checkout)}</div></div></div>
        <div class="detail-row"><div class="detail-icon">🌙</div><div><div class="detail-label">Nights</div><div class="detail-value">${nights} night${nights !== 1 ? 's' : ''}</div></div></div>
        <div class="detail-row"><div class="detail-icon">👨‍👩‍👧</div><div><div class="detail-label">Adults / Children</div><div class="detail-value">${res.adults} Adults, ${res.children} Children</div></div></div>
        <div class="detail-total"><span>Total Rate</span><span>${fmtTSH(res.total)}</span></div>
        ${isActive ? `<div style="margin-top:16px;padding:12px;background:#e8f5e9;border-radius:8px;text-align:center;">🟢 Currently staying - Click Checkout to make room available</div>` : `<div style="margin-top:16px;padding:12px;background:#f5f5f5;border-radius:8px;text-align:center;">✅ Reservation completed</div>`}
      `;
    }
  } catch (err) {
    showToast('Could not load reservation: ' + err.message, '❌');
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
    showToast('Reservation deleted', '🗑️');
  } catch (err) {
    showToast('Delete failed: ' + err.message, '❌');
  }
}

async function checkoutReservation() {
  if (!selectedReservation) {
    showToast('No reservation selected', '⚠️');
    return;
  }
  const today = formatDateForAPI(new Date());
  const currentCheckout = formatDateForAPI(selectedReservation.checkout);
  if (currentCheckout <= today) {
    showToast('Guest is already checked out', 'ℹ️');
    closeDetailPanel();
    await loadAndRenderDashboard();
    return;
  }
  const nightsOriginal = daysBetween(selectedReservation.checkin, selectedReservation.checkout);
  const nightsNew = daysBetween(selectedReservation.checkin, today);
  const pricePerNight = selectedReservation.total / nightsOriginal;
  const newTotal = Math.round(pricePerNight * nightsNew);
  if (!confirm(`Checkout ${selectedReservation.guest} today?\nOriginal total: ${fmtTSH(selectedReservation.total)}\nNew total: ${fmtTSH(newTotal)}`)) return;
  try {
    const payload = { ...selectedReservation, checkout: today, total: newTotal };
    await apiPut(`/reservations/${selectedReservation.id}`, payload);
    showToast(`✅ ${selectedReservation.guest} checked out! New total: ${fmtTSH(newTotal)}`, '🚪');
    closeDetailPanel();
    await loadAndRenderDashboard();
  } catch (err) {
    showToast('Checkout failed: ' + err.message, '❌');
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
    showToast('⚠️ Cannot reach API server.', '❌');
  }
});

window.openDetail = openDetail;
window.closeDetailPanel = closeDetailPanel;
window.deleteSelectedReservation = deleteSelectedReservation;
window.ganttPrev = ganttPrev;
window.ganttNext = ganttNext;
window.ganttToday = ganttToday;
window.checkoutReservation = checkoutReservation;