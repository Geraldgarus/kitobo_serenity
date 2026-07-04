// Reports specific functions
async function loadAndRenderReports() {
  const fromEl = document.getElementById('rpt-from');
  const toEl = document.getElementById('rpt-to');
  if (fromEl && !fromEl.value) fromEl.value = isoDate(new Date());
  if (toEl && !toEl.value) toEl.value = isoDate(new Date());
  await applyReportFilter();
}

async function applyReportFilter() {
  const from = document.getElementById('rpt-from')?.value;
  const to = document.getElementById('rpt-to')?.value;
  const params = new URLSearchParams();
  if (from) params.append('from', from);
  if (to) params.append('to', to);

  try {
    const [summary, allRes, resRevenue] = await Promise.all([
      apiGet(`/reports/summary?${params}`),
      apiGet(`/reservations?${params}`),
      apiGet(`/reports/reservations?${params}`),
    ]);
    reservations = await apiGet('/reservations');
    await loadApartments();
    renderReportData(summary, allRes, from, to);
    renderReservationRevenue(resRevenue);
  } catch (err) {
    showToast('Failed to load reports: ' + err.message, '<i class="fas fa-times-circle"></i>');
  }
}

async function loadApartments() {
  try {
    if (!APARTMENTS.length) {
      APARTMENTS = await apiGet('/apartments');
    }
  } catch (err) {
    console.error('Failed to load apartments', err);
  }
}

function clearReportFilter() {
  const n = new Date();
  document.getElementById('rpt-from').value = n.getFullYear() + '-' + String(n.getMonth()+1).padStart(2,'0') + '-01';
  document.getElementById('rpt-to').value = isoDate(new Date());
  applyReportFilter();
}

function renderReportData(summary, filteredRes, fromVal, toVal) {
  const { totalReservations, totalRevenue, avgStayNights, totalNights } = summary.summary;
  const byApt = summary.byApartment;

  const maxRev = Math.max(...byApt.map(a => a.revenue), 1);
  document.getElementById('revenue-chart').innerHTML = byApt.map(a =>
    `<div class="mini-bar-row"><div class="mini-bar-label">${a.name}</div><div class="mini-bar-track"><div class="mini-bar-fill" style="width:${(a.revenue / maxRev * 100).toFixed(1)}%;background:${a.color}"></div></div><div class="mini-bar-val">${a.revenue > 0 ? (a.revenue / 1000).toFixed(0) + 'K' : '—'}</div></div>`
  ).join('');

  const periodDays = fromVal && toVal ? Math.max(1, daysBetween(fromVal, toVal)) : 30;
  const totalOccDays = byApt.reduce((s, a) => s + a.nights, 0);
  const aptCount = byApt.length || 6;
  const occ = Math.min(100, Math.round(totalOccDays / (aptCount * periodDays) * 100));
  document.getElementById('occ-rate').textContent = occ + '%';
  document.getElementById('occ-bar').style.width = occ + '%';

  document.getElementById('rpt-total-res').textContent = totalReservations;
  document.getElementById('rpt-total-rev').textContent = fmtTSH(totalRevenue);
  document.getElementById('rpt-avg-stay').textContent = avgStayNights ? avgStayNights.toFixed(1) + ' nights' : '—';

  const today = isoDate(new Date());
  const currentlyOcc = reservations.filter(r => r.checkin <= today && r.checkout > today).length;
  document.getElementById('rpt-occupied').textContent = `${currentlyOcc} / ${aptCount}`;

  const tbody = document.getElementById('rpt-apt-table');
  if (tbody) {
    tbody.innerHTML = byApt.map(a => `<tr>
      <td><span style="display:inline-flex;align-items:center;gap:8px"><span style="width:10px;height:10px;border-radius:50%;background:${a.color};display:inline-block"></span><strong>${a.name}</strong></span></td>
      <td>${a.bookings}</td>
      <td>${a.nights}</td>
      <td><strong>${a.revenue > 0 ? fmtTSH(a.revenue) : '—'}</strong></td>
    </tr>`).join('');
  }

  const badge = document.getElementById('rpt-filter-badge');
  if (badge) {
    badge.textContent = fromVal && toVal ? `${fmtDate(fromVal)} → ${fmtDate(toVal)} · ${totalReservations} reservation${totalReservations !== 1 ? 's' : ''}` : `All time · ${totalReservations} reservations`;
  }
}

function pmInfo(raw) {
  const key = (raw || '').toString().trim().toLowerCase().replace(/[\s-]+/g, '_');
  const map = {
    cash:          { label: 'Cash',                   icon: 'money-bill-wave' },
    card:          { label: 'Card (Visa/Mastercard)', icon: 'credit-card' },
    bank_transfer: { label: 'Bank Transfer',           icon: 'university' },
    nbc:           { label: 'NBC',                     icon: 'university' },
    nmb:           { label: 'NMB',                     icon: 'university' },
    crdb:          { label: 'CRDB',                     icon: 'university' },
    mpesa:         { label: 'M-Pesa',                  icon: 'mobile-alt' },
    tigo_pesa:     { label: 'Tigo Pesa',                icon: 'mobile-alt' },
    tigopesa:      { label: 'Tigo Pesa',                icon: 'mobile-alt' },
    airtel_money:  { label: 'Airtel Money',             icon: 'mobile-alt' },
    airtelmoney:   { label: 'Airtel Money',             icon: 'mobile-alt' },
    halopesa:      { label: 'HaloPesa',                 icon: 'mobile-alt' },
    cheque:        { label: 'Cheque',                   icon: 'pen' },
    other:         { label: 'Other',                    icon: 'ellipsis-h' },
  };
  return map[key] || { label: raw ? String(raw) : 'Not specified', icon: 'question-circle' };
}

function renderPaymentsByMethod(data) {
  const tbody = document.getElementById('rpt-pm-body');
  if (!tbody) return;
  if (!data || !data.length) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:30px;color:#94a3b8;">No reservation bookings for selected date range</td></tr>';
    return;
  }
  const totals = {};
  data.forEach(r => {
    const key = (r.paymentMethod || '').toString().trim().toLowerCase().replace(/[\s-]+/g, '_') || '_none';
    if (!totals[key]) totals[key] = { raw: r.paymentMethod, count: 0, amount: 0 };
    totals[key].count += 1;
    totals[key].amount += (r.amountPaid || 0);
  });
  const rows = Object.values(totals).sort((a, b) => b.amount - a.amount);
  tbody.innerHTML = rows.map(row => {
    const info = pmInfo(row.raw);
    return `<tr>
      <td><i class="fas fa-${info.icon}" style="color:#c9933a;margin-right:6px;"></i>${info.label}</td>
      <td style="text-align:center;">${row.count}</td>
      <td style="font-weight:600;color:#10b981;">${fmtTSH(row.amount)}</td>
    </tr>`;
  }).join('');
}

function renderReservationRevenue(data) {
  const tbody   = document.getElementById('rpt-res-body');
  const elCount = document.getElementById('rpt-res-count');
  const elTotal = document.getElementById('rpt-res-total');
  const elPaid  = document.getElementById('rpt-res-paid');
  const elBal   = document.getElementById('rpt-res-balance');

  renderPaymentsByMethod(data);

  if (!data || !data.length) {
    if (tbody) tbody.innerHTML = '<tr><td colspan="12" style="text-align:center;padding:30px;color:#94a3b8;">No reservation bookings for selected date range</td></tr>';
    if (elCount) elCount.innerText = '0';
    if (elTotal) elTotal.innerText = fmtTSH(0);
    if (elPaid)  elPaid.innerText  = fmtTSH(0);
    if (elBal)   elBal.innerText   = fmtTSH(0);
    return;
  }

  const totalCharged = data.reduce((s, r) => s + r.total, 0);
  const totalPaid    = data.reduce((s, r) => s + r.amountPaid, 0);
  const totalBal     = data.reduce((s, r) => s + r.balance, 0);
  if (elCount) elCount.innerText = data.length;
  if (elTotal) elTotal.innerText = fmtTSH(totalCharged);
  if (elPaid)  elPaid.innerText  = fmtTSH(totalPaid);
  if (elBal)   elBal.innerText   = fmtTSH(totalBal);

  if (!tbody) return;
  tbody.innerHTML = data.map(r => {
    const statusBadge = r.paymentStatus === 'paid'
      ? '<span style="background:#dcfce7;color:#166534;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;">Paid</span>'
      : r.paymentStatus === 'partial'
        ? '<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;">Partial</span>'
        : '<span style="background:#fee2e2;color:#991b1b;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;">Unpaid</span>';
    const pm = pmInfo(r.paymentMethod);
    const esc = s => s ? String(s).replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[m])) : '—';
    return `<tr>
      <td style="white-space:nowrap;">${esc(r.bookedAt)}</td>
      <td><strong>${esc(r.guest)}</strong></td>
      <td>${esc(r.room)}</td>
      <td style="white-space:nowrap;">${esc(r.checkin)}</td>
      <td style="white-space:nowrap;">${esc(r.checkout)}</td>
      <td style="text-align:center;">${r.nights}</td>
      <td><i class="fas fa-${pm.icon}" style="margin-right:4px;"></i>${esc(pm.label)}</td>
      <td>${statusBadge}</td>
      <td style="font-weight:600;">${fmtTSH(r.total)}</td>
      <td style="color:#10b981;font-weight:600;">${fmtTSH(r.amountPaid)}</td>
      <td style="color:${r.balance > 0 ? '#ef4444' : '#64748b'};font-weight:600;">${fmtTSH(r.balance)}</td>
      <td>${esc(r.bookedBy)}</td>
    </tr>`;
  }).join('');
}

async function generatePrintReport() {
  const fromVal = document.getElementById('rpt-from')?.value || '';
  const toVal = document.getElementById('rpt-to')?.value || '';
  const params = new URLSearchParams();
  if (fromVal) params.append('from', fromVal);
  if (toVal) params.append('to', toVal);

  try {
    const [summary, filtered] = await Promise.all([
      apiGet(`/reports/summary?${params}`),
      apiGet(`/reports/reservations?${params}`),
    ]);
    const s = summary.summary;
    const byApt = summary.byApartment;

    const aptRows = byApt.map(a => `<tr><td>${a.name}</td><td>${a.bookings}</td><td>${a.nights}</td><td><strong>${a.revenue > 0 ? fmtTSH(a.revenue) : '—'}</strong></td></tr>`).join('');

    const resRows = filtered.map((r, i) => {
      const statusColor = r.paymentStatus === 'paid' ? '#166534' : r.paymentStatus === 'partial' ? '#92400e' : '#991b1b';
      const statusBg    = r.paymentStatus === 'paid' ? '#dcfce7'  : r.paymentStatus === 'partial' ? '#fef3c7'  : '#fee2e2';
      const statusLabel = r.paymentStatus === 'paid' ? 'Paid'     : r.paymentStatus === 'partial' ? 'Partial'  : 'Unpaid';
      return `<tr>
        <td style="text-align:center;color:#9ca3af;font-size:11px;">${i + 1}</td>
        <td><strong>${r.guest || '—'}</strong></td>
        <td>${r.room || '—'}</td>
        <td style="white-space:nowrap;">${fmtDate(r.checkin)}</td>
        <td style="white-space:nowrap;">${fmtDate(r.checkout)}</td>
        <td style="text-align:center;"><strong>${r.nights}</strong></td>
        <td style="text-align:right;">${fmtTSH(r.total)}</td>
        <td style="text-align:right;color:#10b981;">${fmtTSH(r.amountPaid || 0)}</td>
        <td style="text-align:right;color:${(r.balance||0) > 0 ? '#ef4444' : '#64748b'};">${fmtTSH(r.balance || 0)}</td>
        <td style="text-align:center;"><span style="background:${statusBg};color:${statusColor};padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;">${statusLabel}</span></td>
        <td>${r.bookedBy || '—'}</td>
      </tr>`;
    }).join('');

    const periodLabel = fromVal && toVal ? `${fmtDate(fromVal)} to ${fmtDate(toVal)}` : 'All Time';
    const logoSrc = window.location.origin + '/images/logo3.png';

    const win = window.open('', '_blank');
    win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Kitobo Serenity Resort Report – ${periodLabel}</title>
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:Georgia,serif;color:#1a2340;background:#fff;padding:40px;font-size:13px}
      .header{display:flex;align-items:center;justify-content:center;gap:14px;margin-bottom:32px;border-bottom:3px solid #1a2340;padding-bottom:20px}
      .header-logo{height:60px;width:auto;object-fit:contain}
      .header-center{text-align:center}
      .header-center h1{font-size:24px;font-weight:700;color:#1a2340;font-family:Georgia,serif;margin:0}
      .header-center p{font-size:12px;color:#9ca3af;margin:4px 0 0}
      .summary-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:32px}
      .summary-box{background:#f8f9fa;border:1px solid #e5e7eb;border-radius:10px;padding:16px}
      .summary-box .label{font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px}
      .summary-box .value{font-size:22px;font-weight:700;color:#1a2340}
      h2{font-size:14px;font-weight:700;color:#1a2340;margin:24px 0 10px;border-left:4px solid #c9933a;padding-left:10px}
      table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:24px}
      th{background:#1a2340;color:#fff;padding:11px 12px;text-align:left;font-size:12px;font-weight:700;letter-spacing:0.4px;white-space:nowrap}
      th.right{text-align:right}
      th.center{text-align:center}
      td{padding:9px 12px;border-bottom:1px solid #eef0f2;vertical-align:middle;font-size:12px}
      tr:nth-child(even) td{background:#f8fafc}
      tr:hover td{background:#f1f5f9}
      .footer{margin-top:40px;border-top:1px solid #e5e7eb;padding-top:16px;font-size:11px;color:#9ca3af;display:flex;justify-content:space-between}
      @media print{body{padding:20px}}
    </style></head><body>
    <div class="header">
      <img src="${logoSrc}" class="header-logo" alt="Logo">
      <div class="header-center"><h1>Kitobo Serenity Resort</h1><p>Reservations Report &middot; Dar es Salaam, Tanzania</p><p style="font-size:11px;color:#9ca3af;margin-top:2px;">Period: ${periodLabel} &nbsp;&middot;&nbsp; Generated: ${new Date().toLocaleString('en-GB')}</p></div>
    </div>
    <div class="summary-grid"><div class="summary-box"><div class="label">Total Reservations</div><div class="value">${s.totalReservations}</div></div><div class="summary-box"><div class="label">Total Revenue</div><div class="value" style="font-size:15px">${fmtTSH(s.totalRevenue)}</div></div><div class="summary-box"><div class="label">Total Nights Sold</div><div class="value">${s.totalNights}</div></div><div class="summary-box"><div class="label">Avg. Stay</div><div class="value">${s.avgStayNights ? s.avgStayNights.toFixed(1) : '—'} nts</div></div></div>
    <h2>Revenue by Room</h2><table><thead><tr><th>Room</th><th>Bookings</th><th>Nights</th><th>Revenue</th></tr></thead><tbody>${aptRows}</tbody></table>
    <h2>Reservation Detail (${filtered.length} records)</h2>
    <table>
      <thead>
        <tr>
          <th class="center" style="width:36px;">#</th>
          <th style="width:18%;">Guest Name</th>
          <th style="width:12%;">Room</th>
          <th class="center" style="width:10%;">Check-in</th>
          <th class="center" style="width:10%;">Check-out</th>
          <th class="center" style="width:6%;">Nights</th>
          <th class="right" style="width:13%;">Total (TSH)</th>
          <th class="right" style="width:13%;">Paid (TSH)</th>
          <th class="right" style="width:13%;">Balance (TSH)</th>
          <th class="center" style="width:9%;">Status</th>
          <th style="width:9%;">User</th>
        </tr>
      </thead>
      <tbody>${resRows || '<tr><td colspan="11" style="text-align:center;color:#9ca3af;padding:20px">No reservations in this period</td></tr>'}</tbody>
    </table>
    <div class="footer"><span>Kitobo Serenity Resort &middot; Confidential</span><span>Page 1</span></div>
    <script>window.onload=function(){setTimeout(function(){window.print();},400);};<\/script>
    </body></html>`);
    win.document.close();
  } catch (err) {
    showToast('Report generation failed: ' + err.message, '<i class="fas fa-times-circle"></i>');
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    APARTMENTS = await apiGet('/apartments');
  } catch (err) {
    showToast('<i class="fas fa-exclamation-triangle"></i> Cannot reach API server', '<i class="fas fa-times-circle"></i>');
  }
  loadAndRenderReports();
});

window.applyReportFilter = applyReportFilter;
window.clearReportFilter = clearReportFilter;
window.generatePrintReport = generatePrintReport;