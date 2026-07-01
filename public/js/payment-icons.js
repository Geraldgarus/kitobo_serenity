// Shared payment method icon select — used on all pages with payment method dropdowns
const PAYMENT_METHOD_OPTS = [
  { value: '',              icon: '<i class="fas fa-credit-card"      style="color:#94a3b8"></i>', label: 'Select Payment Method' },
  { value: 'cash',          icon: '<i class="fas fa-money-bill-wave"  style="color:#10b981"></i>', label: 'Cash' },
  { value: 'card',          icon: '<i class="fas fa-credit-card"      style="color:#3b82f6"></i>', label: 'Card (Visa/Mastercard)' },
  { value: 'bank_transfer', icon: '<i class="fas fa-university"       style="color:#6366f1"></i>', label: 'Bank Transfer' },
  { value: 'mpesa',         icon: '<i class="fas fa-mobile-alt"       style="color:#10b981"></i>', label: 'M-Pesa' },
  { value: 'tigo_pesa',     icon: '<i class="fas fa-mobile-alt"       style="color:#ef4444"></i>', label: 'Tigo Pesa' },
  { value: 'airtel_money',  icon: '<i class="fas fa-mobile-alt"       style="color:#ef4444"></i>', label: 'Airtel Money' },
  { value: 'halopesa',      icon: '<i class="fas fa-mobile-alt"       style="color:#f59e0b"></i>', label: 'HaloPesa' },
  { value: 'cheque',        icon: '<i class="fas fa-pen"              style="color:#6366f1"></i>', label: 'Cheque' },
  { value: 'other',         icon: '<i class="fas fa-ellipsis-h"       style="color:#94a3b8"></i>', label: 'Other' },
];

function initIconSelect(selectId, optionDefs) {
  const select = document.getElementById(selectId);
  if (!select) return;

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'position:relative;';
  select.parentNode.insertBefore(wrapper, select);
  wrapper.appendChild(select);
  select.style.display = 'none';

  const trigger = document.createElement('div');
  trigger.className = 'form-control';
  trigger.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none;';
  trigger.innerHTML = '<span class="isel-icon"></span><span class="isel-text" style="flex:1;color:#1e2a3e;font-size:0.9rem"></span><i class="fas fa-chevron-down" style="color:#94a3b8;font-size:11px;transition:transform 0.2s"></i>';

  const dropdown = document.createElement('div');
  dropdown.style.cssText = 'display:none;position:absolute;top:calc(100% + 2px);left:0;right:0;background:white;border:1px solid #c9933a;border-radius:12px;z-index:9999;box-shadow:0 6px 20px rgba(0,0,0,0.12);overflow:hidden;';

  optionDefs.forEach(opt => {
    const div = document.createElement('div');
    div.dataset.value = opt.value;
    div.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 14px;cursor:pointer;font-size:0.88rem;transition:background 0.15s;';
    div.innerHTML = opt.icon + '<span>' + opt.label + '</span>';
    div.addEventListener('mouseenter', () => { div.style.background = '#f5f3ef'; });
    div.addEventListener('mouseleave', () => { div.style.background = div._sel ? '#fef9f0' : ''; });
    dropdown.appendChild(div);
  });

  wrapper.appendChild(trigger);
  wrapper.appendChild(dropdown);

  function updateDisplay(value) {
    const opt = optionDefs.find(o => o.value === value) || optionDefs[0];
    if (!opt) return;
    trigger.querySelector('.isel-icon').innerHTML = opt.icon;
    trigger.querySelector('.isel-text').textContent = opt.label;
    dropdown.querySelectorAll('[data-value]').forEach(el => {
      const sel = el.dataset.value === value;
      el._sel = sel;
      el.style.background = sel ? '#fef9f0' : '';
      el.style.fontWeight = sel ? '600' : '';
    });
  }

  updateDisplay(select.value);

  trigger.addEventListener('click', e => {
    e.stopPropagation();
    const isOpen = dropdown.style.display === 'block';
    document.querySelectorAll('[data-isel-open]').forEach(d => {
      d.style.display = 'none';
      delete d.dataset.iselOpen;
      const t = d.previousElementSibling;
      if (t) { const ch = t.querySelector('.fa-chevron-down'); if (ch) ch.style.transform = ''; }
    });
    if (!isOpen) {
      dropdown.style.display = 'block';
      dropdown.dataset.iselOpen = '1';
      trigger.querySelector('.fa-chevron-down').style.transform = 'rotate(180deg)';
    }
  });

  document.addEventListener('click', () => {
    if (dropdown.style.display === 'block') {
      dropdown.style.display = 'none';
      delete dropdown.dataset.iselOpen;
      const ch = trigger.querySelector('.fa-chevron-down');
      if (ch) ch.style.transform = '';
    }
  });

  dropdown.addEventListener('click', e => {
    const optEl = e.target.closest('[data-value]');
    if (!optEl) return;
    e.stopPropagation();
    const val = optEl.dataset.value;
    nativeSet.call(select, val);
    select.dispatchEvent(new Event('change', { bubbles: true }));
    updateDisplay(val);
    dropdown.style.display = 'none';
    delete dropdown.dataset.iselOpen;
    const ch = trigger.querySelector('.fa-chevron-down');
    if (ch) ch.style.transform = '';
  });

  const nativeDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  const nativeSet = nativeDesc.set;
  Object.defineProperty(select, 'value', {
    get: () => nativeDesc.get.call(select),
    set: v => { nativeSet.call(select, v); updateDisplay(v); },
    configurable: true
  });
}
