// Magis Cafe Food Committee Monitoring App

let appState = {
  currentTab: 'logger',
  currentMeal: 'Lunch',
  selectedDate: new Date().toISOString().split('T')[0],
  selectedBatch: 'All',
  students: [],
  filteredStudents: [],
  selectedStudentIds: new Set(),
  bulkMode: false,
  recentLogs: [],
  records: [],
  recordsSummary: {},
  dirBatchFilter: 'All',
  noteModalTargetStudent: null,
  noteModalViolationType: 'waste_food',
  noteModalSeverity: 'Normal',
  mobileUrl: '',
  currentUser: null,
  currentDossierStudent: null,
  charts: {}
};

// ------------------- INITIALIZATION ------------------- //

document.addEventListener('DOMContentLoaded', async () => {
  initIcons();
  setupKeyboardShortcuts();
  await fetchSessionInfo();
  await loadBatches();
  await loadStudents();
  await loadRecentLogs();
  startClock();
});

function initIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function startClock() {
  setInterval(() => {
    const now = new Date();
    const clockEl = document.getElementById('headerClock');
    if (clockEl) {
      clockEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  }, 1000);
}

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
      e.preventDefault();
      const searchInput = document.getElementById('studentSearchInput');
      if (searchInput) searchInput.focus();
    }
    if (e.key === 'Escape') {
      closeQuickNoteModal();
      closeUploadModal();
      closeAddStudentModal();
      closeMobileModal();
      closeStudentSummaryModal();
      closeUserManagementModal();
    }
  });
}

// ------------------- SESSION & TIME ------------------- //

async function fetchSessionInfo() {
  try {
    const res = await fetch('/api/session-info');
    if (res.status === 401) {
      window.location.href = '/login';
      return;
    }
    const data = await res.json();
    
    appState.selectedDate = data.current_date;
    appState.currentMeal = data.detected_meal;
    appState.mobileUrl = data.mobile_url;

    const badge = document.getElementById('headerCurrentMealBadge');
    if (badge) badge.textContent = `${data.detected_meal} (${data.current_time})`;

    const datePicker = document.getElementById('selectedLogDate');
    if (datePicker) datePicker.value = data.current_date;

    selectMealSession(data.detected_meal, false);
    setupQrCode(data.mobile_url);
    updateSessionTitle();

    // User profile in navbar
    if (data.current_user) {
      appState.currentUser = data.current_user;
      const nameEl = document.getElementById('navUserFullName');
      const roleEl = document.getElementById('navUserRoleBadge');
      const iconEl = document.getElementById('userRoleIconContainer');

      if (nameEl) nameEl.textContent = data.current_user.full_name || data.current_user.username;
      
      const roleTitles = {
        'admin': 'Admin (Warden)',
        'food_committee': 'Committee',
        'staff': 'Staff'
      };
      const roleIcons = {
        'admin': '🎓',
        'food_committee': '🍽️',
        'staff': '📋'
      };
      if (roleEl) roleEl.textContent = roleTitles[data.current_user.role] || data.current_user.role;
      if (iconEl) iconEl.textContent = roleIcons[data.current_user.role] || '👤';

      const adminBtn = document.getElementById('adminManageUsersBtn');
      if (adminBtn) {
        if (data.current_user.role === 'admin') {
          adminBtn.classList.remove('hidden');
        } else {
          adminBtn.classList.add('hidden');
        }
      }

      // Default staff to records view
      if (data.current_user.role === 'staff' && appState.currentTab === 'logger') {
        switchTab('records');
      }
    }
  } catch (err) {
    console.error('Error fetching session info:', err);
  }
}

function updateSessionTitle() {
  const titleEl = document.getElementById('panelSessionTitle');
  if (titleEl) {
    const isToday = appState.selectedDate === new Date().toISOString().split('T')[0];
    const dateStr = isToday ? 'Today' : appState.selectedDate;
    titleEl.textContent = `${appState.currentMeal} - ${dateStr}`;
  }
}

function selectMealSession(meal, reload = true) {
  appState.currentMeal = meal;
  document.querySelectorAll('.meal-pill').forEach(btn => {
    if (btn.getAttribute('data-meal') === meal) {
      btn.classList.add('active-meal');
    } else {
      btn.classList.remove('active-meal');
    }
  });

  updateSessionTitle();
  if (reload) {
    loadStudents();
    loadRecentLogs();
  }
}

function setLogDate(preset) {
  const now = new Date();
  if (preset === 'today') {
    appState.selectedDate = now.toISOString().split('T')[0];
  } else if (preset === 'yesterday') {
    const yest = new Date(now);
    yest.setDate(now.getDate() - 1);
    appState.selectedDate = yest.toISOString().split('T')[0];
  }

  const picker = document.getElementById('selectedLogDate');
  if (picker) picker.value = appState.selectedDate;

  onDateChanged();
}

function onDateChanged() {
  const picker = document.getElementById('selectedLogDate');
  if (picker && picker.value) {
    appState.selectedDate = picker.value;
  }
  updateSessionTitle();
  loadStudents();
  loadRecentLogs();
}

// ------------------- TABS NAVIGATION ------------------- //

function switchTab(tabId) {
  appState.currentTab = tabId;

  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active-tab'));
  const activeTabBtn = document.getElementById(`tabBtn-${tabId}`);
  if (activeTabBtn) activeTabBtn.classList.add('active-tab');

  document.querySelectorAll('.mobile-tab').forEach(t => t.classList.remove('active-tab'));
  const activeMobileTab = document.getElementById(`mTabBtn-${tabId}`);
  if (activeMobileTab) activeMobileTab.classList.add('active-tab');

  document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
  const targetSection = document.getElementById(`tab-${tabId}`);
  if (targetSection) targetSection.classList.remove('hidden');

  if (tabId === 'records') {
    loadRecords();
  } else if (tabId === 'analytics') {
    loadAnalytics();
  } else if (tabId === 'students') {
    loadDirectoryStudents();
  } else if (tabId === 'logger') {
    loadStudents();
    loadRecentLogs();
  }

  initIcons();
}

// ------------------- BATCHES & STUDENTS LOADING ------------------- //

async function loadBatches() {
  try {
    const res = await fetch('/api/batches');
    const batches = await res.json();
    
    const group = document.getElementById('loggerBatchFilterGroup');
    if (group) {
      let html = `<button onclick="setBatchFilter('All')" class="batch-filter-btn active-batch px-3 py-1.5 text-xs font-bold rounded-lg transition" data-batch="All">All</button>`;
      batches.forEach(b => {
        html += `<button onclick="setBatchFilter('${b.batch}')" class="batch-filter-btn px-3 py-1.5 text-xs font-bold rounded-lg transition" data-batch="${b.batch}">${b.batch} (${b.count})</button>`;
      });
      group.innerHTML = html;
    }

    const recSelect = document.getElementById('recordsBatchFilter');
    if (recSelect) {
      let optHtml = `<option value="All">All Batches</option>`;
      batches.forEach(b => {
        optHtml += `<option value="${b.batch}">${b.batch}</option>`;
      });
      recSelect.innerHTML = optHtml;
    }
  } catch (err) {
    console.error('Failed to load batches:', err);
  }
}

function setBatchFilter(batch) {
  appState.selectedBatch = batch;
  document.querySelectorAll('.batch-filter-btn').forEach(btn => {
    if (btn.getAttribute('data-batch') === batch) {
      btn.classList.add('active-batch');
    } else {
      btn.classList.remove('active-batch');
    }
  });
  filterStudents();
}

async function loadStudents() {
  try {
    const url = `/api/students?date=${appState.selectedDate}&meal_session=${encodeURIComponent(appState.currentMeal)}`;
    const res = await fetch(url);
    appState.students = await res.json();
    filterStudents();
  } catch (err) {
    console.error('Error loading students:', err);
    showToast('Failed to load students', 'error');
  }
}

function filterStudents() {
  const searchInput = document.getElementById('studentSearchInput');
  const query = (searchInput ? searchInput.value : '').trim().toLowerCase();
  const clearBtn = document.getElementById('clearSearchBtn');
  if (clearBtn) {
    clearBtn.classList.toggle('hidden', query.length === 0);
  }

  appState.filteredStudents = appState.students.filter(s => {
    if (appState.selectedBatch !== 'All' && s.batch !== appState.selectedBatch) {
      return false;
    }
    if (query) {
      const matchRoll = s.roll_no.toLowerCase().includes(query);
      const matchName = s.name.toLowerCase().includes(query);
      const matchMobile = s.mobile && s.mobile.toLowerCase().includes(query);
      return matchRoll || matchName || matchMobile;
    }
    return true;
  });

  renderStudentsList();
}

function clearSearch() {
  const searchInput = document.getElementById('studentSearchInput');
  if (searchInput) {
    searchInput.value = '';
    searchInput.focus();
  }
  filterStudents();
}

function renderStudentsList() {
  const container = document.getElementById('studentsGrid');
  const countIndicator = document.getElementById('studentsCountIndicator');
  if (!container) return;

  if (countIndicator) {
    countIndicator.textContent = `Showing ${appState.filteredStudents.length} of ${appState.students.length} students`;
  }

  if (appState.filteredStudents.length === 0) {
    container.innerHTML = `
      <div class="bg-white rounded-2xl p-8 text-center border border-slate-200 text-slate-400">
        <i data-lucide="user-x" class="w-10 h-10 mx-auto mb-2 text-slate-300"></i>
        <p class="font-bold text-slate-600">No matching students found</p>
        <p class="text-xs mt-1">Try another search term or switch batch filter.</p>
      </div>
    `;
    initIcons();
    return;
  }

  let html = '';
  appState.filteredStudents.forEach(st => {
    const isSelected = appState.selectedStudentIds.has(st.id);
    const hasCurrentMealViolation = !!st.current_meal_violation;
    const violationType = st.current_meal_violation;

    let badgeHtml = '';
    if (hasCurrentMealViolation) {
      if (violationType === 'eat_in_hand') {
        badgeHtml = `<span class="bg-amber-100 text-amber-800 border border-amber-300 font-bold text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1">🖐️ Marked Hand</span>`;
      } else if (violationType === 'waste_food') {
        badgeHtml = `<span class="bg-rose-100 text-rose-800 border border-rose-300 font-bold text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1">🗑️ Marked Waste</span>`;
      } else {
        badgeHtml = `<span class="bg-purple-100 text-purple-800 border border-purple-300 font-bold text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1">⚠️ Marked Both</span>`;
      }
    }

    html += `
      <div class="student-card bg-white rounded-xl p-3 border ${hasCurrentMealViolation ? 'border-amber-300 bg-amber-50/20' : 'border-slate-200'} shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        
        <!-- Left: Student Info & Checkbox -->
        <div class="flex items-center gap-3 flex-1 min-w-0">
          ${appState.bulkMode ? `
            <input type="checkbox" onchange="toggleSelectStudent('${st.id}', this.checked)" ${isSelected ? 'checked' : ''} class="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer">
          ` : ''}

          <div onclick="openStudentSummary('${st.roll_no}')" title="Click to view summary dossier" class="cursor-pointer w-10 h-10 rounded-xl ${st.gender === 'F' ? 'bg-pink-100 text-pink-700' : 'bg-blue-100 text-blue-700'} font-black text-xs flex items-center justify-center flex-shrink-0 hover:scale-105 transition">
            ${st.roll_no.slice(-3)}
          </div>

          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 flex-wrap">
              <span onclick="openStudentSummary('${st.roll_no}')" class="cursor-pointer font-mono font-bold text-slate-900 text-xs px-1.5 py-0.5 bg-slate-100 hover:bg-indigo-100 hover:text-indigo-800 rounded transition">${st.roll_no}</span>
              <span class="text-xs font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.2 rounded">${st.batch}</span>
              ${badgeHtml}
            </div>
            <h4 onclick="openStudentSummary('${st.roll_no}')" class="cursor-pointer text-xs sm:text-sm font-bold text-slate-800 hover:text-indigo-600 truncate mt-0.5 transition">${st.name}</h4>
          </div>
        </div>

        <!-- Right: Action Buttons -->
        <div class="flex items-center gap-1.5 flex-shrink-0 self-end sm:self-center">
          <button type="button" onclick="logStudentFast('${st.id}', 'eat_in_hand', '${escapeHtml(st.name)}', '${st.roll_no}')" 
            title="Mark Eat in Hand" 
            class="btn-hand px-2.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1">
            <span>🖐️</span>
            <span class="hidden sm:inline">Hand</span>
          </button>
          
          <button type="button" onclick="logStudentFast('${st.id}', 'waste_food', '${escapeHtml(st.name)}', '${st.roll_no}')" 
            title="Mark Wasted Food" 
            class="btn-waste px-2.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1">
            <span>🗑️</span>
            <span class="hidden sm:inline">Waste</span>
          </button>
          
          <button type="button" onclick="logStudentFast('${st.id}', 'both', '${escapeHtml(st.name)}', '${st.roll_no}')" 
            title="Mark Both (Hand + Waste)" 
            class="btn-both px-2.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1">
            <span>⚠️</span>
            <span class="hidden sm:inline">Both</span>
          </button>

          <button type="button" onclick="openStudentSummary('${st.roll_no}')" 
            title="Student Dossier & History" 
            class="p-1.5 text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50 rounded-lg transition">
            <i data-lucide="file-text" class="w-4 h-4"></i>
          </button>

          <button type="button" onclick="openQuickNoteModal('${st.id}', '${escapeHtml(st.name)}', '${st.roll_no}')" 
            title="Add details or custom note" 
            class="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition">
            <i data-lucide="message-square-plus" class="w-4 h-4"></i>
          </button>
        </div>

      </div>
    `;
  });

  container.innerHTML = html;
  initIcons();
}

// ------------------- LOGGING ACTIONS ------------------- //

async function logStudentFast(studentId, violationType, studentName, rollNo) {
  try {
    const payload = {
      student_ids: [studentId],
      log_date: appState.selectedDate,
      meal_session: appState.currentMeal,
      violation_type: violationType,
      waste_severity: 'Normal',
      remarks: ''
    };

    const res = await fetch('/api/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (data.success) {
      const vLabels = {
        'eat_in_hand': '🖐️ Eat in Hand',
        'waste_food': '🗑️ Food Waste',
        'both': '⚠️ Both (Hand + Waste)'
      };
      
      const newLogId = data.created_ids[0];
      showToast(`Logged ${rollNo} (${studentName}) for ${vLabels[violationType]}`, 'success', () => undoLog(newLogId, studentName));

      loadStudents();
      loadRecentLogs();
    } else {
      showToast(data.error || 'Failed to log student', 'error');
    }
  } catch (err) {
    console.error('Error logging student:', err);
    showToast('Network error while saving log', 'error');
  }
}

async function undoLog(logId, studentName) {
  try {
    const res = await fetch(`/api/logs/${logId}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast(`Undone log for ${studentName}`, 'info');
      loadStudents();
      loadRecentLogs();
      if (appState.currentTab === 'records') loadRecords();
    }
  } catch (err) {
    console.error('Error undoing log:', err);
  }
}

// ------------------- STUDENT SUMMARY DOSSIER MODAL ------------------- //

async function openStudentSummary(studentIdOrRoll) {
  try {
    const res = await fetch(`/api/students/${encodeURIComponent(studentIdOrRoll)}/summary`);
    const data = await res.json();

    if (!res.ok || data.error) {
      showToast(data.error || 'Student not found', 'error');
      return;
    }

    appState.currentDossierStudent = data.student;
    const st = data.student;
    const stats = data.stats;
    const standing = data.standing;

    document.getElementById('dossierAvatar').textContent = st.roll_no.slice(-3);
    document.getElementById('dossierName').textContent = st.name;
    document.getElementById('dossierRoll').textContent = st.roll_no;
    document.getElementById('dossierMeta').textContent = `${st.batch} • ${st.gender === 'F' ? 'Female' : 'Male'} • Phone: ${st.mobile || 'N/A'}`;

    // Standing banner
    const banner = document.getElementById('dossierStandingBanner');
    const icon = document.getElementById('dossierStandingIcon');
    const title = document.getElementById('dossierStandingTitle');
    const desc = document.getElementById('dossierStandingDesc');
    const badge = document.getElementById('dossierStandingBadge');

    title.textContent = standing.title;
    desc.textContent = standing.description;

    if (standing.level === 'clean') {
      banner.className = 'p-3.5 rounded-2xl border bg-emerald-50 border-emerald-200 text-emerald-950 flex items-center justify-between gap-3';
      icon.textContent = '🟢';
      badge.className = 'px-2.5 py-1 rounded-full text-xs font-bold uppercase bg-emerald-200 text-emerald-900';
      badge.textContent = 'Good';
    } else if (standing.level === 'notice') {
      banner.className = 'p-3.5 rounded-2xl border bg-amber-50 border-amber-200 text-amber-950 flex items-center justify-between gap-3';
      icon.textContent = '🟡';
      badge.className = 'px-2.5 py-1 rounded-full text-xs font-bold uppercase bg-amber-200 text-amber-900';
      badge.textContent = '1 Notice';
    } else if (standing.level === 'warning') {
      banner.className = 'p-3.5 rounded-2xl border bg-orange-50 border-orange-200 text-orange-950 flex items-center justify-between gap-3';
      icon.textContent = '🟠';
      badge.className = 'px-2.5 py-1 rounded-full text-xs font-bold uppercase bg-orange-200 text-orange-900';
      badge.textContent = 'Warning';
    } else {
      banner.className = 'p-3.5 rounded-2xl border bg-rose-50 border-rose-300 text-rose-950 flex items-center justify-between gap-3';
      icon.textContent = '🔴';
      badge.className = 'px-2.5 py-1 rounded-full text-xs font-bold uppercase bg-rose-200 text-rose-900';
      badge.textContent = 'Action Required';
    }

    // Stats
    document.getElementById('dossierTotalCount').textContent = stats.total_violations;
    document.getElementById('dossierHandCount').textContent = stats.hand_count;
    document.getElementById('dossierWasteCount').textContent = stats.waste_count;
    document.getElementById('dossierLastDate').textContent = stats.last_violation_date || 'None';
    document.getElementById('dossierActiveMealLabel').textContent = `${appState.currentMeal} Session`;

    // Timeline list
    const timeline = document.getElementById('dossierTimelineList');
    if (data.logs.length === 0) {
      timeline.innerHTML = `
        <div class="p-6 text-center text-slate-400 bg-slate-50 rounded-2xl border border-slate-100 text-xs">
          <i data-lucide="check-circle" class="w-8 h-8 text-emerald-500 mx-auto mb-2"></i>
          <p class="font-bold text-slate-700">Clean Mess Discipline Record</p>
          <p class="text-[11px] mt-0.5">No infractions recorded for this student.</p>
        </div>
      `;
    } else {
      let tHtml = '';
      data.logs.forEach(l => {
        let vBadge = '';
        if (l.violation_type === 'eat_in_hand') {
          vBadge = `<span class="bg-amber-100 text-amber-800 font-bold px-2 py-0.5 rounded text-[10px]">🖐️ Eat in Hand</span>`;
        } else if (l.violation_type === 'waste_food') {
          vBadge = `<span class="bg-rose-100 text-rose-800 font-bold px-2 py-0.5 rounded text-[10px]">🗑️ Food Waste</span>`;
        } else {
          vBadge = `<span class="bg-purple-100 text-purple-800 font-bold px-2 py-0.5 rounded text-[10px]">⚠️ Both</span>`;
        }

        tHtml += `
          <div class="p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between text-xs hover:bg-slate-100 transition">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="font-bold text-slate-800">${l.log_date}</span>
                <span class="font-bold text-indigo-700 text-[11px]">${l.meal_session}</span>
                ${vBadge}
              </div>
              <div class="text-[11px] text-slate-500 mt-0.5">
                ${l.remarks ? `"${l.remarks}" &bull; ` : ''}Logged by: ${l.logged_by || 'Food Committee'}
              </div>
            </div>
            <button onclick="undoLog('${l.id}', '${escapeHtml(st.name)}'); openStudentSummary('${st.roll_no}')" title="Delete entry" class="p-1 text-slate-300 hover:text-rose-600 rounded">
              <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
          </div>
        `;
      });
      timeline.innerHTML = tHtml;
    }

    document.getElementById('studentSummaryModal').classList.remove('hidden');
    initIcons();
  } catch (err) {
    console.error('Error fetching student summary:', err);
    showToast('Failed to load student dossier', 'error');
  }
}

function closeStudentSummaryModal() {
  document.getElementById('studentSummaryModal').classList.add('hidden');
  appState.currentDossierStudent = null;
}

async function logFromDossier(violationType) {
  if (!appState.currentDossierStudent) return;
  const st = appState.currentDossierStudent;
  await logStudentFast(st.id, violationType, st.name, st.roll_no);
  await openStudentSummary(st.roll_no);
}

// ------------------- USER MANAGEMENT MODAL (ADMIN) ------------------- //

async function openUserManagementModal() {
  document.getElementById('userManagementModal').classList.remove('hidden');
  await loadUsersList();
}

function closeUserManagementModal() {
  document.getElementById('userManagementModal').classList.add('hidden');
}

async function loadUsersList() {
  const container = document.getElementById('usersListContainer');
  if (!container) return;

  try {
    const res = await fetch('/api/users');
    const users = await res.json();

    if (!res.ok || users.length === 0) {
      container.innerHTML = `<div class="text-xs text-slate-400 py-3 text-center">No users found.</div>`;
      return;
    }

    const roleBadges = {
      'admin': '<span class="bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-bold px-2 py-0.5 rounded-full">🎓 Admin</span>',
      'food_committee': '<span class="bg-indigo-100 text-indigo-900 border border-indigo-300 text-[10px] font-bold px-2 py-0.5 rounded-full">🍽️ Food Committee</span>',
      'staff': '<span class="bg-emerald-100 text-emerald-900 border border-emerald-300 text-[10px] font-bold px-2 py-0.5 rounded-full">📋 Staff</span>'
    };

    let html = '';
    users.forEach(u => {
      html += `
        <div class="p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between text-xs">
          <div>
            <div class="flex items-center gap-2">
              <span class="font-mono font-bold text-slate-900">${u.username}</span>
              ${roleBadges[u.role] || u.role}
            </div>
            <div class="text-[11px] text-slate-500 mt-0.5">${u.full_name}</div>
          </div>
          ${u.username !== 'admin' ? `
            <button onclick="handleDeleteUser('${u.id}', '${u.username}')" title="Delete User" class="p-1 text-slate-300 hover:text-rose-600 rounded">
              <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
          ` : '<span class="text-[10px] text-slate-400 font-bold px-2">Primary</span>'}
        </div>
      `;
    });

    container.innerHTML = html;
    initIcons();
  } catch (err) {
    console.error('Error loading users:', err);
  }
}

async function handleCreateUser(e) {
  e.preventDefault();
  const username = document.getElementById('newUsername').value.trim();
  const fullName = document.getElementById('newFullName').value.trim();
  const role = document.getElementById('newUserRole').value;
  const password = document.getElementById('newUserPassword').value;

  const btn = document.getElementById('saveUserBtn');
  btn.disabled = true;
  btn.innerHTML = `<span>Creating...</span>`;

  try {
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, full_name: fullName, role, password })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`User account '${username}' created!`, 'success');
      document.getElementById('newUsername').value = '';
      document.getElementById('newFullName').value = '';
      document.getElementById('newUserPassword').value = '';
      loadUsersList();
    } else {
      showToast(data.error || 'Failed to create user', 'error');
    }
  } catch (err) {
    showToast('Network error while saving user', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i data-lucide="plus" class="w-4 h-4"></i><span>Create Account</span>`;
    initIcons();
  }
}

async function handleDeleteUser(userId, username) {
  if (!confirm(`Are you sure you want to remove user '${username}'?`)) return;

  try {
    const res = await fetch(`/api/users/${userId}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast(`Removed user ${username}`, 'info');
      loadUsersList();
    } else {
      showToast(data.error || 'Failed to delete user', 'error');
    }
  } catch (err) {
    console.error('Delete user error:', err);
  }
}

// ------------------- BULK SELECTION MODE ------------------- //

function toggleBulkMode() {
  const toggle = document.getElementById('bulkSelectModeToggle');
  appState.bulkMode = toggle.checked;
  appState.selectedStudentIds.clear();
  updateBulkToolbar();
  renderStudentsList();
}

function toggleSelectStudent(studentId, isChecked) {
  if (isChecked) {
    appState.selectedStudentIds.add(studentId);
  } else {
    appState.selectedStudentIds.delete(studentId);
  }
  updateBulkToolbar();
}

function updateBulkToolbar() {
  const badge = document.getElementById('selectedCountBadge');
  const bar = document.getElementById('bulkActionsBar');
  const count = appState.selectedStudentIds.size;

  if (count > 0) {
    badge.classList.remove('hidden');
    badge.textContent = `${count} selected`;
    bar.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
    bar.classList.add('hidden');
  }
}

function clearBulkSelection() {
  appState.selectedStudentIds.clear();
  updateBulkToolbar();
  renderStudentsList();
}

async function logBulkStudents(violationType) {
  if (appState.selectedStudentIds.size === 0) return;

  const ids = Array.from(appState.selectedStudentIds);
  try {
    const payload = {
      student_ids: ids,
      log_date: appState.selectedDate,
      meal_session: appState.currentMeal,
      violation_type: violationType,
      waste_severity: 'Normal',
      remarks: `Bulk logged (${ids.length} students)`
    };

    const res = await fetch('/api/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (data.success) {
      showToast(`Successfully logged ${ids.length} students!`, 'success');
      clearBulkSelection();
      loadStudents();
      loadRecentLogs();
    } else {
      showToast(data.error || 'Failed bulk logging', 'error');
    }
  } catch (err) {
    console.error('Bulk log error:', err);
    showToast('Failed to execute bulk log', 'error');
  }
}

// ------------------- RECENT SESSION LOGS FEED ------------------- //

async function loadRecentLogs() {
  try {
    const url = `/api/logs?date=${appState.selectedDate}&meal_session=${encodeURIComponent(appState.currentMeal)}&limit=50`;
    const res = await fetch(url);
    const data = await res.json();
    appState.recentLogs = data.logs || [];

    const summary = data.summary || {};
    document.getElementById('quickStatsTotal').textContent = summary.total || 0;
    document.getElementById('quickStatsHand').textContent = (summary.eat_in_hand || 0) + (summary.both || 0);
    document.getElementById('quickStatsWaste').textContent = (summary.waste_food || 0) + (summary.both || 0);

    renderRecentActivityFeed();
  } catch (err) {
    console.error('Error loading recent logs:', err);
  }
}

function renderRecentActivityFeed() {
  const container = document.getElementById('recentActivityList');
  if (!container) return;

  if (appState.recentLogs.length === 0) {
    container.innerHTML = `
      <div class="text-center py-8 text-slate-400 text-xs">
        <i data-lucide="check-circle-2" class="w-8 h-8 mx-auto mb-2 text-emerald-400"></i>
        <p>No infractions recorded yet for this session.</p>
      </div>
    `;
    initIcons();
    return;
  }

  let html = '';
  appState.recentLogs.slice(0, 15).forEach(l => {
    let vBadge = '';
    if (l.violation_type === 'eat_in_hand') {
      vBadge = `<span class="text-amber-700 bg-amber-100 font-bold px-1.5 py-0.5 rounded text-[10px]">🖐️ Eat in Hand</span>`;
    } else if (l.violation_type === 'waste_food') {
      vBadge = `<span class="text-rose-700 bg-rose-100 font-bold px-1.5 py-0.5 rounded text-[10px]">🗑️ Food Waste</span>`;
    } else {
      vBadge = `<span class="text-purple-700 bg-purple-100 font-bold px-1.5 py-0.5 rounded text-[10px]">⚠️ Both</span>`;
    }

    const timeStr = l.created_at ? l.created_at.split(' ')[1]?.slice(0, 5) || '' : '';

    html += `
      <div class="bg-slate-50 border border-slate-200 rounded-xl p-2.5 flex items-center justify-between text-xs hover:bg-slate-100 transition">
        <div class="min-w-0 flex-1 pr-2">
          <div class="flex items-center gap-1.5">
            <span onclick="openStudentSummary('${l.roll_no}')" class="cursor-pointer font-mono font-bold text-slate-900 hover:text-indigo-600 transition">${l.roll_no}</span>
            ${vBadge}
            ${l.remarks ? `<span class="text-[10px] text-slate-400 italic truncate max-w-[120px]">"${l.remarks}"</span>` : ''}
          </div>
          <div onclick="openStudentSummary('${l.roll_no}')" class="cursor-pointer text-slate-600 font-medium truncate text-[11px] mt-0.5 hover:text-indigo-600 transition">${l.student_name}</div>
        </div>
        <div class="flex items-center gap-1">
          <span class="text-[10px] font-mono text-slate-400 mr-1">${timeStr}</span>
          <button onclick="undoLog('${l.id}', '${escapeHtml(l.student_name)}')" title="Undo / Delete" class="p-1 text-slate-300 hover:text-rose-600 rounded">
            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
          </button>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
  initIcons();
}

// ------------------- QUICK NOTE MODAL ------------------- //

function openQuickNoteModal(studentId, name, rollNo) {
  appState.noteModalTargetStudent = { id: studentId, name, rollNo };
  document.getElementById('noteModalStudentName').textContent = name;
  document.getElementById('noteModalStudentRoll').textContent = `${rollNo} • ${appState.currentMeal}`;
  
  setModalViolationType('waste_food');
  setModalSeverity('Normal');
  document.getElementById('modalRemarksInput').value = '';

  document.getElementById('quickNoteModal').classList.remove('hidden');
}

function closeQuickNoteModal() {
  document.getElementById('quickNoteModal').classList.add('hidden');
  appState.noteModalTargetStudent = null;
}

function setModalViolationType(type) {
  appState.noteModalViolationType = type;
  document.querySelectorAll('.modal-vtype-btn').forEach(btn => btn.classList.remove('active'));
  
  if (type === 'eat_in_hand') document.getElementById('modalVTypeHand').classList.add('active');
  if (type === 'waste_food') document.getElementById('modalVTypeWaste').classList.add('active');
  if (type === 'both') document.getElementById('modalVTypeBoth').classList.add('active');

  const sevSection = document.getElementById('modalSeveritySection');
  if (sevSection) {
    sevSection.style.display = (type === 'eat_in_hand') ? 'none' : 'block';
  }
}

function setModalSeverity(sev) {
  appState.noteModalSeverity = sev;
  document.querySelectorAll('.modal-sev-btn').forEach(btn => btn.classList.remove('active'));
  if (sev === 'Minor') document.getElementById('modalSevMinor').classList.add('active');
  if (sev === 'Normal') document.getElementById('modalSevNormal').classList.add('active');
  if (sev === 'Heavy') document.getElementById('modalSevHeavy').classList.add('active');
}

function appendRemark(text) {
  const textarea = document.getElementById('modalRemarksInput');
  if (textarea.value) {
    textarea.value += ', ' + text;
  } else {
    textarea.value = text;
  }
}

async function submitQuickNoteModal() {
  if (!appState.noteModalTargetStudent) return;

  const st = appState.noteModalTargetStudent;
  const remarks = document.getElementById('modalRemarksInput').value.trim();

  try {
    const payload = {
      student_ids: [st.id],
      log_date: appState.selectedDate,
      meal_session: appState.currentMeal,
      violation_type: appState.noteModalViolationType,
      waste_severity: appState.noteModalSeverity,
      remarks: remarks
    };

    const res = await fetch('/api/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (data.success) {
      showToast(`Recorded note for ${st.roll_no}`, 'success');
      closeQuickNoteModal();
      loadStudents();
      loadRecentLogs();
      if (appState.currentTab === 'records') loadRecords();
    } else {
      showToast(data.error || 'Failed to record note', 'error');
    }
  } catch (err) {
    console.error('Error submitting modal:', err);
    showToast('Failed to save record', 'error');
  }
}

// ------------------- RECORDS & FILTERING ------------------- //

let recordsDebounceTimer = null;
function loadRecordsDebounced() {
  clearTimeout(recordsDebounceTimer);
  recordsDebounceTimer = setTimeout(() => loadRecords(), 300);
}

function onRecordsDatePresetChanged() {
  const preset = document.getElementById('recordsDatePreset').value;
  const customGroup = document.getElementById('recordsCustomDatesGroup');
  if (preset === 'custom') {
    customGroup.classList.remove('hidden');
  } else {
    customGroup.classList.add('hidden');
    loadRecords();
  }
}

async function loadRecords() {
  const preset = document.getElementById('recordsDatePreset').value;
  const meal = document.getElementById('recordsMealFilter').value;
  const violation = document.getElementById('recordsViolationFilter').value;
  const batch = document.getElementById('recordsBatchFilter').value;
  const search = document.getElementById('recordsSearchInput').value.trim();

  let query = `?meal_session=${encodeURIComponent(meal)}&violation_type=${encodeURIComponent(violation)}&batch=${encodeURIComponent(batch)}&search=${encodeURIComponent(search)}`;

  const today = new Date().toISOString().split('T')[0];
  if (preset === 'today') {
    query += `&date=${today}`;
  } else if (preset === 'yesterday') {
    const yest = new Date();
    yest.setDate(yest.getDate() - 1);
    query += `&date=${yest.toISOString().split('T')[0]}`;
  } else if (preset === 'last7') {
    const start = new Date();
    start.setDate(start.getDate() - 7);
    query += `&start_date=${start.toISOString().split('T')[0]}&end_date=${today}`;
  } else if (preset === 'this_month') {
    const start = new Date();
    start.setDate(1);
    query += `&start_date=${start.toISOString().split('T')[0]}&end_date=${today}`;
  } else if (preset === 'custom') {
    const start = document.getElementById('recordsStartDate').value;
    const end = document.getElementById('recordsEndDate').value;
    if (start && end) {
      query += `&start_date=${start}&end_date=${end}`;
    }
  }

  try {
    const res = await fetch(`/api/logs${query}`);
    const data = await res.json();
    appState.records = data.logs || [];
    appState.recordsSummary = data.summary || {};
    renderRecords();
  } catch (err) {
    console.error('Error loading records:', err);
    showToast('Failed to load records', 'error');
  }
}

function renderRecords() {
  const tbody = document.getElementById('recordsTableBody');
  const summary = appState.recordsSummary;

  document.getElementById('recordsTotalBadge').textContent = `${summary.total || 0} Total`;
  document.getElementById('recordsHandBadge').textContent = `${summary.eat_in_hand || 0} Hand`;
  document.getElementById('recordsWasteBadge').textContent = `${summary.waste_food || 0} Waste`;
  document.getElementById('recordsBothBadge').textContent = `${summary.both || 0} Both`;
  document.getElementById('recordsUniqueStudentsBadge').textContent = `${summary.unique_students || 0} Unique Students Involved`;

  if (appState.records.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" class="px-4 py-12 text-center text-slate-400">
          <i data-lucide="inbox" class="w-8 h-8 mx-auto mb-2 text-slate-300"></i>
          <p class="font-bold text-slate-600">No records found for the selected criteria.</p>
        </td>
      </tr>
    `;
    initIcons();
    return;
  }

  let html = '';
  appState.records.forEach((l, idx) => {
    let vBadge = '';
    if (l.violation_type === 'eat_in_hand') {
      vBadge = `<span class="bg-amber-100 text-amber-800 font-bold px-2 py-0.5 rounded text-[10px]">🖐️ Eat in Hand</span>`;
    } else if (l.violation_type === 'waste_food') {
      vBadge = `<span class="bg-rose-100 text-rose-800 font-bold px-2 py-0.5 rounded text-[10px]">🗑️ Food Waste</span>`;
    } else {
      vBadge = `<span class="bg-purple-100 text-purple-800 font-bold px-2 py-0.5 rounded text-[10px]">⚠️ Both</span>`;
    }

    html += `
      <tr class="hover:bg-slate-50 transition">
        <td class="px-4 py-2.5 font-mono text-slate-400">${idx + 1}</td>
        <td class="px-4 py-2.5 font-medium text-slate-700 whitespace-nowrap">${l.log_date}</td>
        <td class="px-4 py-2.5 font-bold text-indigo-700">${l.meal_session}</td>
        <td onclick="openStudentSummary('${l.roll_no}')" class="cursor-pointer px-4 py-2.5 font-mono font-bold text-slate-900 hover:text-indigo-600 transition">${l.roll_no}</td>
        <td onclick="openStudentSummary('${l.roll_no}')" class="cursor-pointer px-4 py-2.5 font-bold text-slate-800 hover:text-indigo-600 transition">${l.student_name}</td>
        <td class="px-4 py-2.5 font-medium text-slate-600">${l.batch}</td>
        <td class="px-4 py-2.5">${vBadge}</td>
        <td class="px-4 py-2.5 text-slate-600">
          <div class="flex items-center gap-1.5">
            ${l.waste_severity && l.waste_severity !== 'Normal' ? `<span class="bg-slate-100 font-bold px-1.5 py-0.2 rounded text-[10px] text-slate-700">${l.waste_severity}</span>` : ''}
            <span>${l.remarks || '-'}</span>
          </div>
        </td>
        <td class="px-4 py-2.5 text-right whitespace-nowrap">
          <button onclick="undoLog('${l.id}', '${escapeHtml(l.student_name)}')" title="Delete entry" class="text-slate-300 hover:text-rose-600 p-1 rounded">
            <i data-lucide="trash-2" class="w-4 h-4"></i>
          </button>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
  initIcons();
}

function exportToExcel() {
  const preset = document.getElementById('recordsDatePreset').value;
  const meal = document.getElementById('recordsMealFilter').value;
  const violation = document.getElementById('recordsViolationFilter').value;
  const batch = document.getElementById('recordsBatchFilter').value;
  const search = document.getElementById('recordsSearchInput').value.trim();

  let query = `?meal_session=${encodeURIComponent(meal)}&violation_type=${encodeURIComponent(violation)}&batch=${encodeURIComponent(batch)}&search=${encodeURIComponent(search)}`;

  const today = new Date().toISOString().split('T')[0];
  if (preset === 'today') {
    query += `&date=${today}`;
  } else if (preset === 'yesterday') {
    const yest = new Date();
    yest.setDate(yest.getDate() - 1);
    query += `&date=${yest.toISOString().split('T')[0]}`;
  } else if (preset === 'last7') {
    const start = new Date();
    start.setDate(start.getDate() - 7);
    query += `&start_date=${start.toISOString().split('T')[0]}&end_date=${today}`;
  } else if (preset === 'this_month') {
    const start = new Date();
    start.setDate(1);
    query += `&start_date=${start.toISOString().split('T')[0]}&end_date=${today}`;
  } else if (preset === 'custom') {
    const start = document.getElementById('recordsStartDate').value;
    const end = document.getElementById('recordsEndDate').value;
    if (start && end) {
      query += `&start_date=${start}&end_date=${end}`;
    }
  }

  window.location.href = `/export/excel${query}`;
}

function openPrintReport() {
  const preset = document.getElementById('recordsDatePreset').value;
  const meal = document.getElementById('recordsMealFilter').value;
  const violation = document.getElementById('recordsViolationFilter').value;
  const batch = document.getElementById('recordsBatchFilter').value;

  let query = `?meal_session=${encodeURIComponent(meal)}&violation_type=${encodeURIComponent(violation)}&batch=${encodeURIComponent(batch)}`;

  const today = new Date().toISOString().split('T')[0];
  if (preset === 'today') {
    query += `&date=${today}`;
  } else if (preset === 'yesterday') {
    const yest = new Date();
    yest.setDate(yest.getDate() - 1);
    query += `&date=${yest.toISOString().split('T')[0]}`;
  } else if (preset === 'last7') {
    const start = new Date();
    start.setDate(start.getDate() - 7);
    query += `&start_date=${start.toISOString().split('T')[0]}&end_date=${today}`;
  } else if (preset === 'this_month') {
    const start = new Date();
    start.setDate(1);
    query += `&start_date=${start.toISOString().split('T')[0]}&end_date=${today}`;
  } else if (preset === 'custom') {
    const start = document.getElementById('recordsStartDate').value;
    const end = document.getElementById('recordsEndDate').value;
    if (start && end) {
      query += `&start_date=${start}&end_date=${end}`;
    }
  }

  window.open(`/report/print${query}`, '_blank');
}

// ------------------- ANALYTICS & CHARTS ------------------- //

async function loadAnalytics() {
  try {
    const res = await fetch('/api/analytics');
    const data = await res.json();

    document.getElementById('statTodayTotal').textContent = data.today.total || 0;
    document.getElementById('statTotalHand').textContent = (data.all_time.hand_count || 0) + (data.all_time.both_count || 0);
    document.getElementById('statTotalWaste').textContent = (data.all_time.waste_count || 0) + (data.all_time.both_count || 0);
    document.getElementById('statAllTimeTotal').textContent = data.all_time.total || 0;

    renderLeaderboard(data.leaderboard || []);
    renderCharts(data);
  } catch (err) {
    console.error('Error loading analytics:', err);
  }
}

function renderLeaderboard(board) {
  const tbody = document.getElementById('leaderboardTableBody');
  if (!tbody) return;

  if (board.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" class="px-4 py-8 text-center text-slate-400">
          No violations recorded yet. Good job to the mess!
        </td>
      </tr>
    `;
    return;
  }

  let html = '';
  board.forEach((st, idx) => {
    let rankBadge = '';
    if (idx === 0) rankBadge = `<span class="bg-amber-400 text-amber-950 font-black px-2 py-0.5 rounded-full text-xs">#1</span>`;
    else if (idx === 1) rankBadge = `<span class="bg-slate-300 text-slate-900 font-black px-2 py-0.5 rounded-full text-xs">#2</span>`;
    else if (idx === 2) rankBadge = `<span class="bg-amber-700 text-amber-100 font-black px-2 py-0.5 rounded-full text-xs">#3</span>`;
    else rankBadge = `<span class="font-bold text-slate-500 text-xs">#${idx + 1}</span>`;

    html += `
      <tr class="hover:bg-slate-50 transition">
        <td class="px-4 py-2.5">${rankBadge}</td>
        <td onclick="openStudentSummary('${st.roll_no}')" class="cursor-pointer px-4 py-2.5 font-mono font-bold text-slate-900 hover:text-indigo-600 transition">${st.roll_no}</td>
        <td onclick="openStudentSummary('${st.roll_no}')" class="cursor-pointer px-4 py-2.5 font-bold text-slate-800 hover:text-indigo-600 transition">${st.name}</td>
        <td class="px-4 py-2.5 text-slate-600">${st.batch}</td>
        <td class="px-4 py-2.5 text-center font-bold text-amber-600">${st.hand_violations}</td>
        <td class="px-4 py-2.5 text-center font-bold text-rose-600">${st.waste_violations}</td>
        <td class="px-4 py-2.5 text-center font-extrabold text-slate-900">${st.total_violations}</td>
        <td class="px-4 py-2.5 text-slate-400 font-mono">${st.last_violation_date || '-'}</td>
        <td class="px-4 py-2.5 text-right">
          <button onclick="openStudentSummary('${st.roll_no}')" class="px-2 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold rounded-lg text-xs flex items-center gap-1 ml-auto">
            <i data-lucide="file-text" class="w-3.5 h-3.5"></i>
            <span>Dossier</span>
          </button>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
  initIcons();
}

function renderCharts(data) {
  const trendCtx = document.getElementById('trendChart');
  if (trendCtx) {
    if (appState.charts.trend) appState.charts.trend.destroy();

    const trends = data.daily_trends || [];
    const labels = trends.map(t => t.log_date.slice(5));
    const handData = trends.map(t => t.hand_count);
    const wasteData = trends.map(t => t.waste_count);

    appState.charts.trend = new Chart(trendCtx, {
      type: 'bar',
      data: {
        labels: labels.length ? labels : ['No Data'],
        datasets: [
          {
            label: 'Eat in Hand',
            data: handData.length ? handData : [0],
            backgroundColor: '#f59e0b',
            borderRadius: 6
          },
          {
            label: 'Food Waste',
            data: wasteData.length ? wasteData : [0],
            backgroundColor: '#f43f5e',
            borderRadius: 6
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { boxWidth: 12, font: { weight: 'bold', size: 11 } } }
        },
        scales: {
          x: { grid: { display: false } },
          y: { beginAtZero: true, ticks: { precision: 0 } }
        }
      }
    });
  }

  const mealCtx = document.getElementById('mealPieChart');
  if (mealCtx) {
    if (appState.charts.meal) appState.charts.meal.destroy();

    const meals = data.meal_distribution || [];
    const mLabels = meals.map(m => m.meal_session);
    const mCounts = meals.map(m => m.count);

    appState.charts.meal = new Chart(mealCtx, {
      type: 'doughnut',
      data: {
        labels: mLabels.length ? mLabels : ['No Data'],
        datasets: [{
          data: mCounts.length ? mCounts : [1],
          backgroundColor: ['#f59e0b', '#3b82f6', '#10b981', '#8b5cf6'],
          borderWidth: 2,
          borderColor: '#ffffff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10, weight: 'bold' } } }
        }
      }
    });
  }
}

// ------------------- STUDENT DIRECTORY & II MBA UPLOAD ------------------- //

function setDirBatchFilter(batch) {
  appState.dirBatchFilter = batch;
  document.querySelectorAll('.dir-batch-btn').forEach(btn => {
    if (btn.getAttribute('data-batch') === batch) {
      btn.classList.add('active-batch');
    } else {
      btn.classList.remove('active-batch');
    }
  });
  loadDirectoryStudents();
}

async function loadDirectoryStudents() {
  const tbody = document.getElementById('directoryTableBody');
  const search = document.getElementById('directorySearchInput').value.trim();
  const batch = appState.dirBatchFilter;

  try {
    const res = await fetch(`/api/students?batch=${encodeURIComponent(batch)}&search=${encodeURIComponent(search)}`);
    const students = await res.json();

    if (students.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="px-4 py-8 text-center text-slate-400">
            No students found.
          </td>
        </tr>
      `;
      return;
    }

    let html = '';
    students.forEach((st, idx) => {
      html += `
        <tr class="hover:bg-slate-50 transition">
          <td class="px-4 py-2.5 font-mono text-slate-400">${idx + 1}</td>
          <td onclick="openStudentSummary('${st.roll_no}')" class="cursor-pointer px-4 py-2.5 font-mono font-bold text-slate-900 hover:text-indigo-600 transition">${st.roll_no}</td>
          <td onclick="openStudentSummary('${st.roll_no}')" class="cursor-pointer px-4 py-2.5 font-bold text-slate-800 hover:text-indigo-600 transition">${st.name}</td>
          <td class="px-4 py-2.5 font-semibold text-indigo-700">${st.batch}</td>
          <td class="px-4 py-2.5">${st.gender || '-'}</td>
          <td class="px-4 py-2.5 font-mono text-slate-500">${st.mobile || '-'}</td>
          <td class="px-4 py-2.5 text-right whitespace-nowrap">
            <button onclick="openStudentSummary('${st.roll_no}')" class="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold rounded-xl text-xs inline-flex items-center gap-1 transition">
              <i data-lucide="file-text" class="w-3.5 h-3.5"></i>
              <span>View Dossier</span>
            </button>
            ${(appState.currentUser && ['admin', 'staff'].includes(appState.currentUser.role)) ? `
              <button onclick="deleteStudent('${st.id}', '${escapeHtml(st.name)}')" title="Delete student" class="ml-1 text-slate-300 hover:text-rose-600 p-1 rounded">
                <i data-lucide="trash-2" class="w-4 h-4"></i>
              </button>
            ` : ''}
          </td>
        </tr>
      `;
    });

    tbody.innerHTML = html;
    initIcons();
  } catch (err) {
    console.error('Error loading directory students:', err);
  }
}

async function deleteStudent(studentId, name) {
  if (!confirm(`Are you sure you want to remove student "${name}"?`)) return;

  try {
    const res = await fetch(`/api/students/${studentId}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast(`Removed student ${name}`, 'info');
      loadDirectoryStudents();
      loadStudents();
      loadBatches();
    }
  } catch (err) {
    console.error('Error deleting student:', err);
  }
}

// ------------------- UPLOAD EXCEL MODAL (II MBA) ------------------- //

function openUploadModal() {
  document.getElementById('uploadExcelModal').classList.remove('hidden');
  document.getElementById('uploadStatusMsg').classList.add('hidden');
  document.getElementById('uploadPreviewSection').classList.add('hidden');
  document.getElementById('excelFileInput').value = '';
  document.getElementById('fileChosenLabel').textContent = 'Click to browse or drop Excel file here';
}

function closeUploadModal() {
  document.getElementById('uploadExcelModal').classList.add('hidden');
}

function onFileSelected(input) {
  if (input.files && input.files[0]) {
    const file = input.files[0];
    document.getElementById('fileChosenLabel').textContent = `Selected: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
    previewSelectedExcel();
  }
}

async function previewSelectedExcel() {
  const fileInput = document.getElementById('excelFileInput');
  if (!fileInput.files || !fileInput.files[0]) {
    showToast('Please choose an Excel file first', 'error');
    return;
  }

  const formData = new FormData();
  formData.append('file', fileInput.files[0]);
  formData.append('batch_name', document.getElementById('uploadBatchName').value.trim());
  formData.append('action', 'preview');

  try {
    const res = await fetch('/api/upload-excel', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (data.success && data.preview) {
      const prev = data.preview;
      document.getElementById('previewRowsCount').textContent = `${prev.total_rows} Students Found`;
      
      let tableHtml = `<table class="w-full text-left border-collapse"><thead><tr class="border-b border-slate-200">`;
      prev.headers.slice(0, 5).forEach(h => {
        tableHtml += `<th class="py-1 px-2 font-bold">${h}</th>`;
      });
      tableHtml += `</tr></thead><tbody>`;

      prev.sample_rows.forEach(r => {
        tableHtml += `<tr class="border-b border-slate-100">`;
        r.slice(0, 5).forEach(c => {
          tableHtml += `<td class="py-1 px-2">${c}</td>`;
        });
        tableHtml += `</tr>`;
      });
      tableHtml += `</tbody></table>`;

      document.getElementById('previewTableContainer').innerHTML = tableHtml;
      document.getElementById('uploadPreviewSection').classList.remove('hidden');
    }
  } catch (err) {
    console.error('Preview error:', err);
  }
}

async function handleExcelUpload(e) {
  e.preventDefault();
  const fileInput = document.getElementById('excelFileInput');
  if (!fileInput.files || !fileInput.files[0]) {
    showToast('Please choose an Excel file to import', 'error');
    return;
  }

  const batchName = document.getElementById('uploadBatchName').value.trim();
  const formData = new FormData();
  formData.append('file', fileInput.files[0]);
  formData.append('batch_name', batchName);
  formData.append('action', 'import');

  const submitBtn = document.getElementById('submitImportBtn');
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span>Importing...</span>';

  try {
    const res = await fetch('/api/upload-excel', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();

    if (data.success) {
      showToast(`Success! Imported ${data.imported} new students into ${batchName} (${data.updated} updated).`, 'success');
      closeUploadModal();
      await loadBatches();
      await loadStudents();
      await loadDirectoryStudents();
    } else {
      showToast(data.error || 'Failed to import Excel file', 'error');
    }
  } catch (err) {
    console.error('Import error:', err);
    showToast('Network error during import', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<i data-lucide="check" class="w-4 h-4"></i><span>Import Students</span>`;
    initIcons();
  }
}

// ------------------- ADD SINGLE STUDENT MODAL ------------------- //

function openAddStudentModal() {
  document.getElementById('addStudentModal').classList.remove('hidden');
  document.getElementById('newStudentRoll').value = '';
  document.getElementById('newStudentName').value = '';
  document.getElementById('newStudentMobile').value = '';
}

function closeAddStudentModal() {
  document.getElementById('addStudentModal').classList.add('hidden');
}

async function handleAddStudent(e) {
  e.preventDefault();
  const roll = document.getElementById('newStudentRoll').value.trim().toUpperCase();
  const name = document.getElementById('newStudentName').value.trim().toUpperCase();
  const batch = document.getElementById('newStudentBatch').value;
  const gender = document.getElementById('newStudentGender').value;
  const mobile = document.getElementById('newStudentMobile').value.trim();

  try {
    const res = await fetch('/api/students', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roll_no: roll, name, batch, gender, mobile })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Student ${roll} (${name}) created!`, 'success');
      closeAddStudentModal();
      await loadBatches();
      await loadStudents();
      await loadDirectoryStudents();
    } else {
      showToast(data.error || 'Failed to create student', 'error');
    }
  } catch (err) {
    console.error('Add student error:', err);
    showToast('Failed to add student', 'error');
  }
}

// ------------------- MOBILE ACCESS MODAL ------------------- //

function openMobileModal() {
  document.getElementById('mobileAccessModal').classList.remove('hidden');
}

function closeMobileModal() {
  document.getElementById('mobileAccessModal').classList.add('hidden');
}

function setupQrCode(url) {
  const container = document.getElementById('qrCodeContainer');
  const directUrl = document.getElementById('mobileDirectUrlText');
  if (directUrl) directUrl.textContent = url;

  if (container && window.QRCode) {
    container.innerHTML = '';
    new QRCode(container, {
      text: url,
      width: 160,
      height: 160,
      colorDark: '#0f172a',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M
    });
  }
}

// ------------------- TOAST NOTIFICATIONS ------------------- //

function showToast(message, type = 'info', onUndo = null) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast-item pointer-events-auto flex items-center justify-between gap-3 px-4 py-3 rounded-2xl shadow-xl border text-xs font-semibold max-w-sm w-full transition`;

  let typeClasses = 'bg-slate-900 text-white border-slate-700';
  let iconHtml = 'ℹ️';

  if (type === 'success') {
    typeClasses = 'bg-emerald-950 text-emerald-100 border-emerald-800';
    iconHtml = '✅';
  } else if (type === 'error') {
    typeClasses = 'bg-rose-950 text-rose-100 border-rose-800';
    iconHtml = '❌';
  } else if (type === 'info') {
    typeClasses = 'bg-indigo-950 text-indigo-100 border-indigo-800';
    iconHtml = '📢';
  }

  toast.className += ` ${typeClasses}`;

  let undoButtonHtml = '';
  if (onUndo) {
    undoButtonHtml = `
      <button class="undo-btn bg-white/20 hover:bg-white/30 text-white px-2 py-1 rounded-lg text-[11px] font-bold uppercase tracking-wider flex-shrink-0">
        Undo
      </button>
    `;
  }

  toast.innerHTML = `
    <div class="flex items-center gap-2 min-w-0">
      <span class="flex-shrink-0">${iconHtml}</span>
      <span class="truncate">${message}</span>
    </div>
    ${undoButtonHtml}
  `;

  if (onUndo) {
    toast.querySelector('.undo-btn').addEventListener('click', () => {
      onUndo();
      toast.remove();
    });
  }

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, onUndo ? 6000 : 3500);
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/'/g, "\\'").replace(/"/g, '&quot;');
}
