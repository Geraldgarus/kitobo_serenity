// Reservations table specific functions
async function loadAndRenderReservations() {
  setLoading('res-table-body', true);
  try {
    [APARTMENTS, reservations] = await Promise.all([
      apiGet('/apartments'),
      apiGet('/reservations'),
    ]);
    renderReservationsTable();
  } catch (err) {
    showToast('Failed to load reservations: ' + err.message, '❌');
  }
}

function renderReservationsTable() {
  const tbody = document.getElementById('res-table-body');
  const today = isoDate(new Date());
  if (!reservations.length) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state"><div class="empty-icon">📋</div><p>No reservations yet</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = reservations.map(res => {
    const aptName = getApt(res.aptId)?.name || res.aptName || '—';
    const nights = daysBetween(res.checkin, res.checkout);
    const status = res.checkout <= today ? 'Checked Out' : res.checkin <= today ? 'Active' : 'Upcoming';
    const chipClass = status === 'Active' ? 'chip-green' : status === 'Upcoming' ? 'chip-blue' : 'chip-gray';
    return `<tr>
      <td><strong>${res.guest}</strong><br><small style="color:var(--gray-400)">${res.email}</small></td>
      <td>${aptName}</td>
      <td>${fmtDate(res.checkin)}</td>
      <td>${fmtDate(res.checkout)}</td>
      <td>${nights}n</td>
      <td>${res.adults}A ${res.children}C</td>
      <td><strong style="color:var(--navy)">${fmtTSH(res.total)}</strong></td>
      <td><span class="chip ${chipClass}">${status}</span></td>
      <td><button class="btn btn-outline" style="padding:6px 12px;font-size:12px" onclick="openDetail(${res.id})">View</button></td>
    </tr>`;
  }).join('');
}

async function openDetail(resId) {
  try {
    const res = await apiGet(`/reservations/${resId}`);
    selectedReservation = res;
    const apt = getApt(res.aptId) || { name: res.aptName || '—' };

    document.getElementById('detail-body').innerHTML = [
      { icon: '👤', label: 'Guest Name', value: res.guest },
      { icon: '📧', label: 'Email', value: res.email },
      { icon: '📱', label: 'Mobile', value: res.mobile },
      { icon: '🌍', label: 'Country', value: res.country },
      { icon: '🏙️', label: 'City', value: res.city },
      { icon: '🏠', label: 'Apartment', value: apt.name },
      { icon: '💳', label: 'Rate Type', value: res.rateType },
      { icon: '📅', label: 'Check-in', value: fmtDate(res.checkin) },
      { icon: '📅', label: 'Check-out', value: fmtDate(res.checkout) },
      { icon: '🌙', label: 'Nights', value: daysBetween(res.checkin, res.checkout) + ' nights' },
      { icon: '👨‍👩‍👧', label: 'Adults / Children', value: `${res.adults} Adults, ${res.children} Children` },
    ].map(r => `<div class="detail-row"><div class="detail-icon">${r.icon}</div><div><div class="detail-label">${r.label}</div><div class="detail-value">${r.value}</div></div></div>`).join('') +
    `<div class="detail-total"><span>Total Rate</span><span>${fmtTSH(res.total)}</span></div>`;

    document.getElementById('panel-overlay').classList.add('open');
    document.getElementById('detail-panel').classList.add('open');
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
    loadAndRenderReservations();
    showToast('Reservation deleted', '🗑️');
  } catch (err) {
    showToast('Delete failed: ' + err.message, '❌');
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    APARTMENTS = await apiGet('/apartments');
  } catch (err) {
    showToast('⚠️ Cannot reach API server', '❌');
  }
  loadAndRenderReservations();
});

window.openDetail = openDetail;
window.closeDetailPanel = closeDetailPanel;
window.deleteSelectedReservation = deleteSelectedReservation;