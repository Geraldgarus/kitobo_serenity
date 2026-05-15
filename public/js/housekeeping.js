// Housekeeping specific functions
const HK_TASKS = ['Bed linen changed', 'Bathroom cleaned', 'Floors mopped', 'Trash emptied', 'Towels replaced', 'Minibar restocked'];

async function loadAndRenderHousekeeping() {
  try {
    [APARTMENTS, reservations] = await Promise.all([
      apiGet('/apartments'),
      apiGet('/reservations'),
    ]);
    renderHousekeeping();
  } catch (err) {
    showToast('Failed to load housekeeping: ' + err.message, '❌');
  }
}

function renderHousekeeping() {
  const today = isoDate(new Date());
  document.getElementById('hk-grid').innerHTML = APARTMENTS.map(apt => {
    const res = reservations.find(r => r.aptId === apt.id && r.checkin <= today && r.checkout > today);
    const checkout = reservations.find(r => r.aptId === apt.id && r.checkout === today);
    let statusClass = 'hk-status-available', statusLabel = 'Clean / Available';
    if (res) { statusClass = 'hk-status-dirty'; statusLabel = 'Occupied – Needs Service'; }
    if (checkout) { statusClass = 'hk-status-cleaning'; statusLabel = 'Checkout – Deep Clean'; }

    const tasks = HK_TASKS.map((task, idx) => {
      const key = `apt${apt.id}_${idx}`;
      if (!hkTasks[key]) hkTasks[key] = false;
      return { task, key, done: hkTasks[key] };
    });

    return `<div class="hk-card">
      <div class="hk-card-header ${statusClass}"><span>${apt.emoji} ${apt.name}</span></div>
      <div style="padding:8px 18px;background:#f8f6f2;font-size:12px;color:var(--gray-600)">${statusLabel}</div>
      <div class="hk-card-body">
        ${tasks.map(t => `<div class="hk-task"><div class="hk-check ${t.done ? 'done' : ''}" onclick="toggleHKTask('${t.key}')">${t.done ? '✓' : ''}</div><span style="${t.done ? 'text-decoration:line-through;color:var(--gray-300)' : ''}">${t.task}</span></div>`).join('')}
      </div>
    </div>`;
  }).join('');
}

function toggleHKTask(key) {
  hkTasks[key] = !hkTasks[key];
  renderHousekeeping();
}

document.addEventListener('DOMContentLoaded', loadAndRenderHousekeeping);

window.toggleHKTask = toggleHKTask;