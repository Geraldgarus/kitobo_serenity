// Rooms/Apartments specific functions
async function loadAndRenderRooms() {
  const grid = document.getElementById('rooms-grid');
  if (grid) {
    grid.innerHTML = '<div style="text-align:center;padding:60px;color:var(--gray-300);grid-column:1/-1"><i class="fas fa-spinner fa-spin"></i> Loading rooms…</div>';
  }

  try {
    [APARTMENTS, reservations] = await Promise.all([
      apiGet('/apartments'),
      apiGet('/reservations'),
    ]);
    renderRooms();
  } catch (err) {
    showToast('Failed to load rooms: ' + err.message, '<i class="fas fa-times-circle"></i>');
    if (grid) {
      grid.innerHTML = `<div style="text-align:center;padding:60px;color:var(--gray-300);grid-column:1/-1"><i class="fas fa-times-circle"></i> Could not load rooms.<br><small>${err.message}</small></div>`;
    }
  }
}

function renderRooms() {
  const today = isoDate(new Date());
  const grid = document.getElementById('rooms-grid');
  if (!grid) return;

  if (!APARTMENTS.length) {
    grid.innerHTML = '<div style="text-align:center;padding:60px;color:var(--gray-300);grid-column:1/-1">No rooms found.</div>';
    return;
  }

  grid.innerHTML = APARTMENTS.map(apt => {
    const activeRes = reservations.find(r =>
      r.aptId === apt.id && r.checkin <= today && r.checkout > today
    );
    const upcomingRes = !activeRes ? reservations
      .filter(r => r.aptId === apt.id && r.checkin > today)
      .sort((a, b) => new Date(a.checkin) - new Date(b.checkin))[0] : null;

    const isOccupied = !!activeRes;
    const nights = activeRes ? daysBetween(activeRes.checkin, activeRes.checkout) : 0;
    const nightsLeft = activeRes ? daysBetween(today, activeRes.checkout) : 0;

    const occupiedInfo = activeRes ? `
      <div class="room-guest-block" onclick="event.stopPropagation();openDetail(${activeRes.id})" style="cursor:pointer;">
        <div class="room-guest-avatar"><i class="fas fa-user"></i></div>
        <div class="room-guest-details">
          <div class="room-guest-name">${escapeHtml(activeRes.guest)}</div>
          <div class="room-guest-sub">${escapeHtml(activeRes.country || '')}${activeRes.city ? ' · ' + escapeHtml(activeRes.city) : ''}</div>
        </div>
      </div>
      <div class="room-res-grid">
        <div class="room-res-item"><div class="room-res-label">Check-in</div><div class="room-res-value">${fmtDate(activeRes.checkin)}</div></div>
        <div class="room-res-item"><div class="room-res-label">Check-out</div><div class="room-res-value">${fmtDate(activeRes.checkout)}</div></div>
        <div class="room-res-item"><div class="room-res-label">Stay</div><div class="room-res-value">${nights} night${nights !== 1 ? 's' : ''}</div></div>
        <div class="room-res-item"><div class="room-res-label">Nights Left</div><div class="room-res-value">${nightsLeft} night${nightsLeft !== 1 ? 's' : ''}</div></div>
        <div class="room-res-item"><div class="room-res-label">Guests</div><div class="room-res-value">${activeRes.adults}A ${activeRes.children > 0 ? activeRes.children + 'C' : ''}</div></div>
        <div class="room-res-item"><div class="room-res-label">Rate Type</div><div class="room-res-value">${activeRes.rateType}</div></div>
      </div>
      <div class="room-total-bar">
        <span>Total</span>
        <strong>${fmtTSH(activeRes.total)}</strong>
      </div>
      <button class="btn btn-outline" style="width:100%;margin-top:10px;font-size:12px;padding:8px" 
        onclick="event.stopPropagation();openDetail(${activeRes.id})">
        <i class="fas fa-clipboard-list"></i> View Full Details
      </button>
    ` : '';

    const availableInfo = !activeRes ? `
      <div class="room-available-block">
        <div class="room-available-icon"><i class="fas fa-check-circle"></i></div>
        <div class="room-available-text">Available Now</div>
      </div>
      ${upcomingRes ? `
        <div class="room-upcoming-block">
          <div class="room-upcoming-label">Next Booking</div>
          <div class="room-upcoming-guest">${escapeHtml(upcomingRes.guest)}</div>
          <div class="room-upcoming-dates"><i class="fas fa-calendar-alt"></i> ${fmtDate(upcomingRes.checkin)} → ${fmtDate(upcomingRes.checkout)}</div>
        </div>
      ` : `
        <div class="room-upcoming-block" style="text-align:center;color:var(--gray-300)">
          <div style="font-size:13px">No upcoming bookings</div>
        </div>
      `}
      <button class="btn btn-gold" style="width:100%;margin-top:12px;padding:12px;font-size:14px;font-weight:600" 

        
      </button>
    ` : '';

    return `
      <div class="room-card" data-apt-id="${apt.id}">
        <div class="room-card-img" style="background:linear-gradient(135deg,${apt.color}22,${apt.color}55)">
          <span style="font-size:48px">${apt.emoji && apt.emoji.startsWith('fa-') ? '<i class="fas ' + apt.emoji + '"></i>' : (apt.emoji || '<i class="fas fa-home"></i>')}</span>
          <div class="room-card-badge ${isOccupied ? 'chip-red' : 'chip-green'}">
            ${isOccupied ? '<i class="fas fa-circle" style="color:#ef4444"></i> Occupied' : '<i class="fas fa-circle" style="color:#22c55e"></i> Available'}
          </div>
        </div>
        <div class="room-card-body">
          <div class="room-card-header-row">
            <div>
              <div class="room-card-name">${escapeHtml(apt.name)}</div>
              <div class="room-card-meta">
                <span><i class="fas fa-user"></i> Max ${apt.maxAdults} Adults</span>
                <span><i class="fas fa-money-bill-wave"></i> ${fmtTSH(apt.ratePerNight)}/night</span>
              </div>
            </div>
            <div class="room-color-dot" style="background:${apt.color}"></div>
          </div>
          <div class="room-divider"></div>
          ${occupiedInfo}
          ${availableInfo}
        </div>
      </div>
    `;
  }).join('');
}

// Function to open booking modal with pre-selected apartment
function openBookModal(aptId, aptName, ratePerNight) {
  // Open the reservation modal
  if (typeof openReservationModal === 'function') {
    openReservationModal();
    
    // After modal opens, pre-select the apartment
    setTimeout(() => {
      const aptSelect = document.getElementById('modal-f-apt');
      if (aptSelect) {
        // Find and select the option with matching value
        for (let i = 0; i < aptSelect.options.length; i++) {
          if (parseInt(aptSelect.options[i].value) === aptId) {
            aptSelect.selectedIndex = i;
            break;
          }
        }
        // Trigger rate update
        if (typeof modalUpdateRate === 'function') {
          modalUpdateRate();
        }
      }
      
      // Show a small notification
      showToast(`Booking ${aptName} - ${fmtTSH(ratePerNight)}/night`, '<i class="fas fa-home"></i>');
    }, 300);
  } else {
    showToast('Reservation system not ready', '<i class="fas fa-exclamation-triangle"></i>');
  }
}

// Open detail panel for reservation
async function openDetail(resId) {
  try {
    // Show loading state
    const detailBody = document.getElementById('detail-body');
    if (detailBody) {
      detailBody.innerHTML = `
        <div style="text-align:center;padding:40px;">
          <div style="font-size:24px;margin-bottom:10px;"><i class="fas fa-spinner fa-spin"></i></div>
          <div>Loading reservation details...</div>
        </div>
      `;
    }
    
    // Open panel
    const panelOverlay = document.getElementById('panel-overlay');
    const detailPanel = document.getElementById('detail-panel');
    if (panelOverlay) panelOverlay.classList.add('open');
    if (detailPanel) detailPanel.classList.add('open');
    
    // Fetch fresh data from API
    const res = await apiGet(`/reservations/${resId}`);
    selectedReservation = res;
    
    // Get apartment info
    const apt = getApt(res.aptId) || { name: res.aptName || '—' };
    const nights = daysBetween(res.checkin, res.checkout);
    
    // Build detail view
    if (detailBody) {
      detailBody.innerHTML = `
        <div class="detail-row">
          <div class="detail-icon"><i class="fas fa-user"></i></div>
          <div>
            <div class="detail-label">Guest Name</div>
            <div class="detail-value">${escapeHtml(res.guest)}</div>
          </div>
        </div>
        <div class="detail-row">
          <div class="detail-icon"><i class="fas fa-envelope"></i></div>
          <div>
            <div class="detail-label">Email</div>
            <div class="detail-value">${escapeHtml(res.email)}</div>
          </div>
        </div>
        <div class="detail-row">
          <div class="detail-icon"><i class="fas fa-mobile-alt"></i></div>
          <div>
            <div class="detail-label">Mobile</div>
            <div class="detail-value">${escapeHtml(res.mobile || '—')}</div>
          </div>
        </div>
        <div class="detail-row">
          <div class="detail-icon"><i class="fas fa-globe-africa"></i></div>
          <div>
            <div class="detail-label">Country</div>
            <div class="detail-value">${escapeHtml(res.country || '—')}</div>
          </div>
        </div>
        <div class="detail-row">
          <div class="detail-icon"><i class="fas fa-city"></i></div>
          <div>
            <div class="detail-label">City</div>
            <div class="detail-value">${escapeHtml(res.city || '—')}</div>
          </div>
        </div>
        <div class="detail-row">
          <div class="detail-icon"><i class="fas fa-home"></i></div>
          <div>
            <div class="detail-label">Room</div>
            <div class="detail-value">${escapeHtml(apt.name)}</div>
          </div>
        </div>
        <div class="detail-row">
          <div class="detail-icon"><i class="fas fa-credit-card"></i></div>
          <div>
            <div class="detail-label">Rate Type</div>
            <div class="detail-value">${escapeHtml(res.rateType)}</div>
          </div>
        </div>
        <div class="detail-row">
          <div class="detail-icon"><i class="fas fa-calendar-alt"></i></div>
          <div>
            <div class="detail-label">Check-in</div>
            <div class="detail-value">${fmtDate(res.checkin)}</div>
          </div>
        </div>
        <div class="detail-row">
          <div class="detail-icon"><i class="fas fa-calendar-alt"></i></div>
          <div>
            <div class="detail-label">Check-out</div>
            <div class="detail-value">${fmtDate(res.checkout)}</div>
          </div>
        </div>
        <div class="detail-row">
          <div class="detail-icon"><i class="fas fa-moon"></i></div>
          <div>
            <div class="detail-label">Nights</div>
            <div class="detail-value">${nights} night${nights !== 1 ? 's' : ''}</div>
          </div>
        </div>
        <div class="detail-row">
          <div class="detail-icon"><i class="fas fa-users"></i></div>
          <div>
            <div class="detail-label">Adults / Children</div>
            <div class="detail-value">${res.adults} Adults, ${res.children} Children</div>
          </div>
        </div>
        <div class="detail-total">
          <span>Total Rate</span>
          <span>${fmtTSH(res.total)}</span>
        </div>
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
    await loadAndRenderRooms();
    showToast('Reservation deleted successfully', '<i class="fas fa-trash-alt"></i>');
  } catch (err) {
    showToast('Delete failed: ' + err.message, '<i class="fas fa-times-circle"></i>');
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

// Initialize
document.addEventListener('DOMContentLoaded', loadAndRenderRooms);

// Make functions global
window.openDetail = openDetail;
window.closeDetailPanel = closeDetailPanel;
window.deleteSelectedReservation = deleteSelectedReservation;
window.openBookModal = openBookModal;