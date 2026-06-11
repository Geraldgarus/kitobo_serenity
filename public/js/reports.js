// Reports specific functions
async function loadAndRenderReports() {
  const fromEl = document.getElementById('rpt-from');
  const toEl = document.getElementById('rpt-to');
  if (fromEl && !fromEl.value) fromEl.value = '2026-01-01';
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
    const [summary, allRes] = await Promise.all([
      apiGet(`/reports/summary?${params}`),
      apiGet(`/reservations?${params}`),
    ]);
    reservations = await apiGet('/reservations');
    await loadApartments();
    renderReportData(summary, allRes, from, to);
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
  document.getElementById('rpt-from').value = '2026-01-01';
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
      <td>${fmtTSH(a.ratePerNight)}</td>
    </table>`).join('');
  }

  const badge = document.getElementById('rpt-filter-badge');
  if (badge) {
    badge.textContent = fromVal && toVal ? `${fmtDate(fromVal)} → ${fmtDate(toVal)} · ${totalReservations} reservation${totalReservations !== 1 ? 's' : ''}` : `All time · ${totalReservations} reservations`;
  }
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
      apiGet(`/reservations?${params}`),
    ]);
    const s = summary.summary;
    const byApt = summary.byApartment;

    const aptRows = byApt.map(a => `<tr><td>${a.emoji} ${a.name}</td><td>${a.bookings}</td><td>${a.nights}</td><td><strong>${a.revenue > 0 ? fmtTSH(a.revenue) : '—'}</strong></td><td>${fmtTSH(a.ratePerNight)}/night</td></tr>`).join('');

    const resRows = filtered.map(r => {
      const apt = byApt.find(a => a.id === r.aptId);
      return `<tr><td>${r.guest}</td><td>${apt?.name || '—'}</td><td>${fmtDate(r.checkin)}</td><td>${fmtDate(r.checkout)}</td><td>${daysBetween(r.checkin, r.checkout)}n</td><td>${r.adults}A ${r.children}C</td><td>${r.rateType}</td><td><strong>${fmtTSH(r.total)}</strong></td></tr>`;
    }).join('');

    const periodLabel = fromVal && toVal ? `${fmtDate(fromVal)} to ${fmtDate(toVal)}` : 'All Time';

    const win = window.open('', '_blank');
    win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Kitobo Serenity Resort Report – ${periodLabel}</title>
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:Georgia,serif;color:#1a2340;background:#fff;padding:40px;font-size:13px}
      .header{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:32px;border-bottom:3px solid #1a2340;padding-bottom:20px}
      .logo-area h1{font-size:26px;font-weight:700;color:#1a2340}
      .logo-area p{font-size:12px;color:#9ca3af;margin-top:4px}
      .report-meta{text-align:right}
      .report-meta .period{font-size:16px;font-weight:700;color:#c9933a}
      .report-meta .generated{font-size:11px;color:#9ca3af;margin-top:4px}
      .summary-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:32px}
      .summary-box{background:#f8f9fa;border:1px solid #e5e7eb;border-radius:10px;padding:16px}
      .summary-box .label{font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px}
      .summary-box .value{font-size:22px;font-weight:700;color:#1a2340}
      h2{font-size:14px;font-weight:700;color:#1a2340;margin:24px 0 10px;border-left:4px solid #c9933a;padding-left:10px}
      table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:24px}
      th{background:#1a2340;color:#fff;padding:9px 12px;text-align:left;font-size:11px;font-weight:600}
      td{padding:8px 12px;border-bottom:1px solid #f0f0f0}
      tr:nth-child(even) td{background:#fafafa}
      .footer{margin-top:40px;border-top:1px solid #e5e7eb;padding-top:16px;font-size:11px;color:#9ca3af;display:flex;justify-content:space-between}
      @media print{body{padding:20px}}
    </style></head><body>
    <div class="header"><div class="logo-area"><h1><i class="fas fa-hotel"></i> Kitobo Serenity Resort</h1><p>Property Management System · Dar es Salaam, Tanzania</p></div><div class="report-meta"><div class="period">Period: ${periodLabel}</div><div class="generated">Generated: ${new Date().toLocaleString('en-GB')}</div></div></div>
    <div class="summary-grid"><div class="summary-box"><div class="label">Total Reservations</div><div class="value">${s.totalReservations}</div></div><div class="summary-box"><div class="label">Total Revenue</div><div class="value" style="font-size:15px">${fmtTSH(s.totalRevenue)}</div></div><div class="summary-box"><div class="label">Total Nights Sold</div><div class="value">${s.totalNights}</div></div><div class="summary-box"><div class="label">Avg. Stay</div><div class="value">${s.avgStayNights ? s.avgStayNights.toFixed(1) : '—'} nts</div></div></div>
    <h2>Revenue by Apartment</h2><table><thead><tr><th>Apartment</th><th>Bookings</th><th>Nights</th><th>Revenue</th><th>Rate/Night</th></tr></thead><tbody>${aptRows}</tbody></table>
    <h2>Reservation Detail (${filtered.length} records)</h2><table><thead><tr><th>Guest</th><th>Apartment</th><th>Check-in</th><th>Check-out</th><th>Nights</th><th>Guests</th><th>Rate</th><th>Total</th></tr></thead><tbody>${resRows || '<tr><td colspan="8" style="text-align:center;color:#9ca3af;padding:20px">No reservations in this period</td></tr>'}</tbody></table>
    <div class="footer"><span>Kitobo Serenity Resort · Confidential</span><span>Page 1</span></div>
    <script>window.onload=()=>window.print();<\/script>
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