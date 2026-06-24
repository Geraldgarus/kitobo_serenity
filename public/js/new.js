
// Dashboard specific functions (without apartment list)
async function loadAndRenderDashboard() {
  try {
    [APARTMENTS, reservations] = await Promise.all([
      apiGet('/apartments'),
      apiGet('/reservations'),
    ]);
    
    console.log('=== Dashboard Loaded ===');
    console.log('Today (formatted):', formatDateForAPI(new Date()));
    console.log('Active Reservations:', reservations.filter(r => r.checkout > formatDateForAPI(new Date())).length);
    
    renderStats();
    renderGantt(); // Remove renderAptList() call
  } catch (err) {
    showToast('Failed to load dashboard: ' + err.message, '<i class="fas fa-times-circle"></i>');
  }
}

function renderStats() {
  const today = formatDateForAPI(new Date());
  
  // Only count active reservations (checkout > today)
  const occupied = reservations.filter(r => {
    const checkout = formatDateForAPI(r.checkout);
    return checkout > today;
  }).length;
  
  document.getElementById('stat-occupied').textContent = occupied;
  document.getElementById('stat-available').textContent = APARTMENTS.length - occupied;
  
  // Checkouts today (checkout equals today)
  const checkoutsToday = reservations.filter(r => {
    const checkout = formatDateForAPI(r.checkout);
    return checkout === today;
  }).length;
  document.getElementById('stat-checkouts').textContent = checkoutsToday;
  
  const revenue = reservations.reduce((s, r) => s + r.total, 0);
  document.getElementById('stat-revenue').textContent = 'TSH ' + (revenue / 1000000).toFixed(1) + 'M';
}

// renderAptList removed - no longer needed

// filterGanttByApt removed - no filtering

function renderGantt() {
  const wrap = document.getElementById('gantt-body');
  if (!wrap) return;
  
  const today = formatDateForAPI(new Date());
  // Show all apartments (no filtering)
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
  html += '</tr></thead><tbody>';

  // Each apartment row - only show active reservations
  apts.forEach(apt => {
    // Filter to only active reservations (checkout > today)
    const aptReservations = reservations.filter(r => 
      r.aptId === apt.id && 
      formatDateForAPI(r.checkout) > today
    );
    
    html += `<tr>
      <td style="padding:0 12px; min-width:100px; border-right:2px solid ${apt.color}; background:#fafafa;">
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-size:20px;">${apt.emoji || '<i class="fas fa-home"></i>'}</span>
          <span style="font-weight:600;">${escapeHtml(apt.name)}</span>
        </div>
        </td>`;
    
    // For each day, check if there's a reservation
    let i = 0;
    while (i < days.length) {
      const currentDate = days[i];
      const currentDateStr = formatDateForAPI(currentDate);
      
      // Find reservation that covers this day
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
        // Calculate span
        let span = 0;
        let startIndex = i;
        
        // Find start index
        for (let j = 0; j < days.length; j++) {
          const dayStr = formatDateForAPI(days[j]);
          if (dayStr === reservationStartDate) {
            startIndex = j;
            break;
          }
        }
        
        // Calculate span
        for (let j = startIndex; j < days.length; j++) {
          const dayStr = formatDateForAPI(days[j]);
          if (dayStr < reservationEndDate) {
            span++;
          } else {
            break;
          }
        }
        
        // Skip to start if needed
        if (i !== startIndex) {
          html += `<td colspan="${startIndex - i}" style="background:#fafafa;"> </td>`;
          i = startIndex;
        }
        
        const endIndex = startIndex + span;
        const wkndClass = isWeekend(days[startIndex]) ? 'weekend' : '';
        html += `<td colspan="${span}" class="${wkndClass}" style="padding:4px; background:#fff;">
          <div class="reservation-bar" onclick="openDetail(${reservationForDay.id})" title="${escapeHtml(reservationForDay.guest)} - ${reservationForDay.checkin} to ${reservationForDay.checkout}" style="background:${apt.color}20; border-left:3px solid ${apt.color};">
            <div class="guest-icon"><i class="fas fa-user"></i></div>
            <div class="guest-info">
              <div class="guest-name">${escapeHtml(reservationForDay.guest)}</div>
              <div class="guest-dates">
                ${fmtDateShort(reservationForDay.checkin)} – ${fmtDateShort(reservationForDay.checkout)}
              </div>
            </div>
          </div>
          </td>`;
        i = endIndex;
      } else {
        const wknd = isWeekend(currentDate);
        html += `<td class="${wknd ? 'weekend' : ''}" style="background:#fafafa;"> </td>`;
        i++;
      }
    }
    html += '</tr>';
  });
  
  html += '</tbody></table></div>';
  wrap.innerHTML = html;

  // Update date range display
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
  // Center on today
  currentGanttStart = addDays(new Date(), -Math.floor(GANTT_DAYS / 2));
  renderGantt(); 
}

async function openDetail(resId) {
  try {
    const detailBody = document.getElementById('detail-body');
    if (detailBody) {
      detailBody.innerHTML = `
        <div style="text-align:center;padding:40px;">
          <div style="font-size:24px;margin-bottom:10px;"><i class="fas fa-spinner fa-spin"></i></div>
          <div>Loading reservation details...</div>
        </div>
      `;
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
    if (checkoutBtn) {
      checkoutBtn.style.display = isActive ? 'flex' : 'none';
    }
    
    if (detailBody) {
      detailBody.innerHTML = `
        <div class="detail-row"><div class="detail-icon"><i class="fas fa-user"></i></div><div><div class="detail-label">Guest Name</div><div class="detail-value">${escapeHtml(res.guest)}</div></div></div>
        <div class="detail-row"><div class="detail-icon"><i class="fas fa-envelope"></i></div><div><div class="detail-label">Email</div><div class="detail-value">${escapeHtml(res.email)}</div></div></div>
        <div class="detail-row"><div class="detail-icon"><i class="fas fa-mobile-alt"></i></div><div><div class="detail-label">Mobile</div><div class="detail-value">${escapeHtml(res.mobile || '—')}</div></div></div>
        <div class="detail-row"><div class="detail-icon"><i class="fas fa-globe-africa"></i></div><div><div class="detail-label">Country</div><div class="detail-value">${escapeHtml(res.country || '—')}</div></div></div>
        <div class="detail-row"><div class="detail-icon"><i class="fas fa-city"></i></div><div><div class="detail-label">City</div><div class="detail-value">${escapeHtml(res.city || '—')}</div></div></div>
        <div class="detail-row"><div class="detail-icon"><i class="fas fa-home"></i></div><div><div class="detail-label">Apartment</div><div class="detail-value">${escapeHtml(apt.name)}</div></div></div>
        <div class="detail-row"><div class="detail-icon"><i class="fas fa-credit-card"></i></div><div><div class="detail-label">Rate Type</div><div class="detail-value">${escapeHtml(res.rateType)}</div></div></div>
        <div class="detail-row"><div class="detail-icon"><i class="fas fa-calendar-alt"></i></div><div><div class="detail-label">Check-in</div><div class="detail-value">${fmtDate(res.checkin)}</div></div></div>
        <div class="detail-row"><div class="detail-icon"><i class="fas fa-calendar-alt"></i></div><div><div class="detail-label">Check-out</div><div class="detail-value">${fmtDate(res.checkout)}</div></div></div>
        <div class="detail-row"><div class="detail-icon"><i class="fas fa-moon"></i></div><div><div class="detail-label">Nights</div><div class="detail-value">${nights} night${nights !== 1 ? 's' : ''}</div></div></div>
        <div class="detail-row"><div class="detail-icon"><i class="fas fa-users"></i></div><div><div class="detail-label">Adults / Children</div><div class="detail-value">${res.adults} Adults, ${res.children} Children</div></div></div>
        <div class="detail-total"><span>Total Rate</span><span>${fmtTSH(res.total)}</span></div>
        ${isActive ? `
          <div style="margin-top:16px;padding:12px;background:#e8f5e9;border-radius:8px;text-align:center;">
            <span style="font-size:12px;"><i class="fas fa-circle" style="color:#22c55e"></i> Currently staying - Click Checkout to make room available</span>
          </div>
        ` : `
          <div style="margin-top:16px;padding:12px;background:#f5f5f5;border-radius:8px;text-align:center;">
            <span style="font-size:12px;"><i class="fas fa-check-circle"></i> Reservation completed - Guest checked out</span>
          </div>
        `}
      `;
    }
  } catch (err) {
    showToast('Could not load reservation: ' + err.message, '<i class="fas fa-times-circle"></i>');
    if (detailBody) {
      detailBody.innerHTML = `
        <div style="text-align:center;padding:40px;color:var(--red);">
          <div style="font-size:48px;margin-bottom:10px;"><i class="fas fa-exclamation-triangle"></i></div>
          <div>Failed to load reservation details</div>
          <div style="font-size:12px;margin-top:10px;">${err.message}</div>
        </div>
      `;
    }
  }
}

function closeDetailPanel() {
  const detailPanel = document.getElementById('detail-panel');
  const panelOverlay = document.getElementById('panel-overlay');
  if (detailPanel) detailPanel.classList.remove('open');
  if (panelOverlay) panelOverlay.classList.remove('open');
  selectedReservation = null;
}

async function deleteSelectedReservation() {
  if (!selectedReservation) {
    showToast('No reservation selected', '<i class="fas fa-exclamation-triangle"></i>');
    return;
  }
  
  if (!confirm(`Delete reservation for ${selectedReservation.guest}?`)) return;
  
  try {
    await apiDelete(`/reservations/${selectedReservation.id}`);
    closeDetailPanel();
    await loadAndRenderDashboard();
    showToast('Reservation deleted successfully', '<i class="fas fa-trash-alt"></i>');
  } catch (err) {
    showToast('Delete failed: ' + err.message, '<i class="fas fa-times-circle"></i>');
  }
}

// Checkout Function
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
  const priceDifference = selectedReservation.total - newTotal;
  
  if (!confirm(`<i class="fas fa-door-open"></i> CHECKOUT GUEST\n\n` +
    `Guest: ${selectedReservation.guest}\n` +
    `Apartment: ${getApt(selectedReservation.aptId)?.name || 'Unknown'}\n` +
    `Original checkout: ${fmtDate(selectedReservation.checkout)}\n` +
    `New checkout: ${fmtDate(today)}\n` +
    `Original nights: ${nightsOriginal}\n` +
    `New nights: ${nightsNew}\n` +
    `Original total: ${fmtTSH(selectedReservation.total)}\n` +
    `New total: ${fmtTSH(newTotal)}\n` +
    `Adjustment: -${fmtTSH(Math.round(priceDifference))}\n\n` +
    `This will remove the guest from the dashboard and make the room available.`)) {
    return;
  }
  
  try {
    const checkoutBtn = document.getElementById('checkout-btn');
    const originalText = checkoutBtn.textContent;
    checkoutBtn.textContent = '<i class="fas fa-spinner fa-spin"></i> Processing checkout...';
    checkoutBtn.disabled = true;
    
    const payload = {
      aptId: selectedReservation.aptId,
      guest: selectedReservation.guest,
      email: selectedReservation.email,
      mobile: selectedReservation.mobile,
      country: selectedReservation.country,
      city: selectedReservation.city,
      checkin: selectedReservation.checkin,
      checkout: today,
      adults: selectedReservation.adults,
      children: selectedReservation.children,
      rateType: selectedReservation.rateType,
      total: newTotal,
    };
    
    await apiPut(`/reservations/${selectedReservation.id}`, payload);
    showToast(`<i class="fas fa-check-circle"></i> ${selectedReservation.guest} checked out successfully!\nRoom is now available. New total: ${fmtTSH(newTotal)}`, '<i class="fas fa-door-open"></i>');
    
    closeDetailPanel();
    await loadAndRenderDashboard();
    
    checkoutBtn.textContent = originalText;
    checkoutBtn.disabled = false;
  } catch (err) {
    showToast('Checkout failed: ' + err.message, '<i class="fas fa-times-circle"></i>');
    const checkoutBtn = document.getElementById('checkout-btn');
    if (checkoutBtn) {
      checkoutBtn.textContent = '<i class="fas fa-door-open"></i> Checkout';
      checkoutBtn.disabled = false;
    }
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Initialize dashboard
document.addEventListener('DOMContentLoaded', async () => {
  const today = new Date();
  currentGanttStart = addDays(today, -Math.floor(GANTT_DAYS / 2));
  
  try {
    APARTMENTS = await apiGet('/apartments');
    await loadAndRenderDashboard();
  } catch (err) {
    showToast('<i class="fas fa-exclamation-triangle"></i> Cannot reach API server. Check that the backend is running.', '<i class="fas fa-times-circle"></i>');
  }
});

// Make functions global
window.openDetail = openDetail;
window.closeDetailPanel = closeDetailPanel;
window.deleteSelectedReservation = deleteSelectedReservation;
window.ganttPrev = ganttPrev;
window.ganttNext = ganttNext;
window.ganttToday = ganttToday;
window.checkoutReservation = checkoutReservation;