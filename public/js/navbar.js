// js/navbar.js - Using absolute paths
function getCurrentUser() {
  const userStr = sessionStorage.getItem('pms_user');
  if (!userStr) return null;
  try { return JSON.parse(userStr); } catch(e) { return null; }
}

function logout() {
  sessionStorage.removeItem('pms_user');
  window.location.href = '/pages/login.html';
}

function switchToBack() {
  alert('Back office feature coming soon');
}

function createChangePasswordModal() {
  if (document.getElementById('change-password-modal')) return;
  
  const modalHTML = `
    <div class="reservation-modal-overlay" id="change-password-modal-overlay" onclick="closeChangePasswordModal()"></div>
    <div class="reservation-modal" id="change-password-modal">
      <div class="reservation-modal-header">
        <h3>🔐 Change Password</h3>
        <button class="reservation-modal-close" onclick="closeChangePasswordModal()">✕</button>
      </div>
      <div class="reservation-modal-body">
        <form id="change-password-form">
          <div class="form-group">
            <label>Current Password</label>
            <input type="password" id="current-password" class="form-control" required>
          </div>
          <div class="form-group">
            <label>New Password (min 6 characters)</label>
            <input type="password" id="new-password" class="form-control" required>
          </div>
          <div class="form-group">
            <label>Confirm New Password</label>
            <input type="password" id="confirm-password" class="form-control" required>
          </div>
          <hr class="divider" />
          <button type="submit" class="btn btn-success">✅ Update Password</button>
          <button type="button" class="btn btn-outline" style="margin-top:10px; width:100%;" onclick="closeChangePasswordModal()">Cancel</button>
        </form>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHTML);
  
  document.getElementById('change-password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const currentPassword = document.getElementById('current-password').value;
    const newPassword = document.getElementById('new-password').value;
    const confirmPassword = document.getElementById('confirm-password').value;
    const user = getCurrentUser();
    
    if (newPassword !== confirmPassword) {
      showToast('New passwords do not match', '⚠️');
      return;
    }
    if (newPassword.length < 6) {
      showToast('Password must be at least 6 characters', '⚠️');
      return;
    }
    
    try {
      const response = await fetch('http://localhost:3000/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          oldPassword: currentPassword,
          newPassword: newPassword
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      
      showToast('Password changed successfully! Please login again.', '✅');
      setTimeout(() => { logout(); }, 1500);
    } catch (err) {
      showToast('Failed to change password: ' + err.message, '❌');
    }
  });
}

function openChangePasswordModal() {
  createChangePasswordModal();
  const modal = document.getElementById('change-password-modal');
  const overlay = document.getElementById('change-password-modal-overlay');
  if (modal) modal.classList.add('open');
  if (overlay) overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeChangePasswordModal() {
  const modal = document.getElementById('change-password-modal');
  const overlay = document.getElementById('change-password-modal-overlay');
  if (modal) modal.classList.remove('open');
  if (overlay) overlay.classList.remove('open');
  document.body.style.overflow = '';
}

async function loadNavbar() {
  const container = document.getElementById('navbar-container');
  if (!container) {
    console.error('navbar-container not found');
    return;
  }
  
  // Try multiple paths - absolute first
  const pathsToTry = [
    '/pages/navbar.html',
    'navbar.html',
    '../navbar.html',
    './navbar.html'
  ];
  
  let navbarHtml = null;
  
  for (const path of pathsToTry) {
    try {
      console.log('Trying to fetch:', path);
      const response = await fetch(path);
      if (response.ok) {
        navbarHtml = await response.text();
        console.log('Successfully loaded from:', path);
        break;
      }
    } catch (err) {
      console.log('Failed from:', path);
    }
  }
  
  if (!navbarHtml) {
    console.error('Could not load navbar from any path');
    container.innerHTML = `
      <div style="background:#dc2626; color:white; padding:10px; text-align:center;">
        ⚠️ Navbar failed to load. Please check console for details.
      </div>
    `;
    return;
  }
  
  container.innerHTML = navbarHtml;
  initNavbar();
}

function initNavbar() {
  const currentUser = getCurrentUser();
  if (!currentUser) {
    window.location.href = '/pages/login.html';
    return;
  }
  
  // Set page title if defined
  const pageTitleEl = document.getElementById('pageTitle');
  const pageSubtitleEl = document.getElementById('pageSubtitle');
  if (pageTitleEl && window.pageTitle) pageTitleEl.innerText = window.pageTitle;
  if (pageSubtitleEl && window.pageSubtitle) pageSubtitleEl.innerText = window.pageSubtitle;
  
  // Display user info
  const userNameSpan = document.getElementById('userName');
  const userRoleSpan = document.getElementById('userRole');
  const userAvatarSpan = document.getElementById('userAvatar');
  if (userNameSpan) userNameSpan.innerText = currentUser.fullName || currentUser.username;
  if (userRoleSpan) userRoleSpan.innerText = currentUser.role ? currentUser.role.charAt(0).toUpperCase() + currentUser.role.slice(1) : 'User';
  if (userAvatarSpan) userAvatarSpan.innerText = (currentUser.fullName || currentUser.username || 'U').charAt(0).toUpperCase();
  
  // Dropdown toggle
  const userPill = document.getElementById('userPill');
  const dropdownMenu = document.getElementById('dropdownMenu');
  if (userPill && dropdownMenu) {
    // Remove old listeners by cloning
    const newUserPill = userPill.cloneNode(true);
    userPill.parentNode.replaceChild(newUserPill, userPill);
    
    newUserPill.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdownMenu.classList.toggle('show');
      newUserPill.classList.toggle('active');
    });
    document.addEventListener('click', () => {
      dropdownMenu.classList.remove('show');
      if (newUserPill) newUserPill.classList.remove('active');
    });
  }
  
  // Make functions global
  window.logout = logout;
  window.switchToBack = switchToBack;
  window.openChangePasswordModal = openChangePasswordModal;
  window.closeChangePasswordModal = closeChangePasswordModal;
}

// Auto-load when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM ready, loading navbar...');
  loadNavbar();
});