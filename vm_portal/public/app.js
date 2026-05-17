const state = {
  user: null,
  snapshots: [],
  currentSnapshot: null,
  records: [],
  filtered: [],
  filters: {},
  preset: "all",
  sort: { key: "vmName", dir: "asc" },
  theme: localStorage.getItem("vmPortalTheme") || "light",
};

const IDLE_TIMEOUT_MS = 10 * 60 * 1000;
let idleTimer = null;

const columns = [
  ["vmName", "text"],
  ["powerState", "select"],
  ["vmHost", "text"],
  ["hasVeeamBackup", "bool"],
  ["hasVeeamReplica", "bool"],
  ["hasAnyVeeamProtection", "bool"],
  ["backupJobs", "text"],
  ["replicaJobs", "text"],
  ["lastBackupRestorePoint", "text"],
  ["lastReplicaRestorePoint", "text"],
  ["backupRestorePoints", "text"],
  ["replicaRestorePoints", "text"],
];

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: options.body instanceof FormData ? {} : { "Content-Type": "application/json" },
    ...options,
  });
  if (response.status === 401 && state.user) {
    await logout("Сессия истекла. Войдите снова.");
    throw new Error("Session expired");
  }
  if (!response.ok) {
    let message = response.statusText;
    try {
      message = (await response.json()).error || message;
    } catch {}
    throw new Error(message);
  }
  if (response.status === 204) return null;
  return response.json();
}

function showApp() {
  $("#loginView").classList.toggle("hidden", !!state.user);
  $("#appView").classList.toggle("hidden", !state.user);
  if (!state.user) return;
  $("#userName").textContent = state.user.username;
  $("#userRole").textContent = state.user.role;
  $("#uploadPanel").classList.toggle("hidden", !["write", "admin"].includes(state.user.role));
  $("#autoImportPanel").classList.toggle("hidden", !["write", "admin"].includes(state.user.role));
  $("#adminNavBtn").classList.toggle("hidden", state.user.role !== "admin");
}

function applyTheme(theme) {
  state.theme = theme === "dark" ? "dark" : "light";
  document.body.dataset.theme = state.theme;
  localStorage.setItem("vmPortalTheme", state.theme);
  $("#themeQuickToggle").textContent = state.theme === "dark" ? "☾ Dark mode" : "☼ Light mode";
  $$("[data-theme-choice]").forEach((button) => {
    button.classList.toggle("active", button.dataset.themeChoice === state.theme);
  });
}

function armIdleLogout() {
  clearTimeout(idleTimer);
  if (!state.user) return;
  idleTimer = setTimeout(() => {
    logout("Автоматический выход после 10 минут без активности.");
  }, IDLE_TIMEOUT_MS);
}

function markActivity() {
  if (state.user) armIdleLogout();
}

async function logout(message = "") {
  try {
    await api("/api/logout", { method: "POST", body: "{}" });
  } catch {}
  clearTimeout(idleTimer);
  state.user = null;
  state.currentSnapshot = null;
  state.records = [];
  state.filtered = [];
  showApp();
  $("#loginError").textContent = message;
}

async function loadMe() {
  applyTheme(state.theme);
  const data = await api("/api/me");
  state.user = data.user;
  showApp();
  if (state.user) {
    armIdleLogout();
    await loadSnapshots();
    if (state.user.role === "admin") await loadAdmin();
  }
}

async function navigateTo(view) {
  if (view === "admin" && state.user?.role !== "admin") return;
  $$(".sidebar-nav-item, .sidebar-link[data-view]").forEach((node) => {
    node.classList.toggle("active", node.dataset.view === view);
  });
  $("#dashboardView").classList.toggle("hidden", view !== "dashboard");
  $("#filesView").classList.toggle("hidden", view !== "files");
  $("#logsView").classList.toggle("hidden", view !== "logs");
  $("#settingsView").classList.toggle("hidden", view !== "settings");
  $("#adminView").classList.toggle("hidden", view !== "admin");
  if (view === "admin") await loadAdmin();
  if (view === "files") await loadSnapshots();
  if (view === "logs") await loadImportLogs();
}

async function loadSnapshots() {
  const data = await api("/api/snapshots");
  state.snapshots = data.snapshots;
  renderSnapshots();
  if (!state.currentSnapshot && state.snapshots.length) {
    await selectSnapshot(state.snapshots[0].id);
  }
}

function renderSnapshots() {
  const root = $("#snapshotList");
  root.innerHTML = "";
  $("#snapshotCount").textContent = `${state.snapshots.length} pairs`;
  if (!state.snapshots.length) {
    root.innerHTML = '<tr><td colspan="9" class="muted">Пока нет загруженных пар.</td></tr>';
    return;
  }
  for (const item of state.snapshots) {
    const node = document.createElement("tr");
    node.className = state.currentSnapshot?.id === item.id ? "is-selected" : "";
    node.innerHTML = `
      <td><strong>${escapeHtml(item.title)}</strong></td>
      <td>${escapeHtml(item.created_at)}</td>
      <td>${escapeHtml(item.vsphere_filename)}</td>
      <td>${escapeHtml(item.veeam_filename)}</td>
      <td>${item.total_vms}</td>
      <td>${item.powered_off}</td>
      <td>${item.off_with_backup}</td>
      <td>${item.off_with_replica}</td>
      <td></td>
    `;
    const actions = document.createElement("div");
    actions.className = "mini-actions";
    const openBtn = document.createElement("button");
    openBtn.className = "btn btn-secondary btn-small";
    openBtn.textContent = "Open";
    openBtn.addEventListener("click", () => {
      selectSnapshot(item.id);
      navigateTo("dashboard");
    });
    actions.appendChild(openBtn);
    const exportBtn = document.createElement("button");
    exportBtn.className = "btn btn-secondary btn-small";
    exportBtn.textContent = "Export";
    exportBtn.addEventListener("click", () => {
      window.location.href = `/api/snapshots/${item.id}/export`;
    });
    actions.appendChild(exportBtn);
    if (["write", "admin"].includes(state.user?.role)) {
      const deleteBtn = document.createElement("button");
      deleteBtn.className = "btn btn-danger btn-small";
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", async () => {
        if (!confirm(`Delete pair ${item.title}?`)) return;
        await api(`/api/snapshots/${item.id}`, { method: "DELETE" });
        if (state.currentSnapshot?.id === item.id) {
          state.currentSnapshot = null;
          state.records = [];
          state.filtered = [];
          $("#exportBtn").disabled = true;
          $("#snapshotTitle").textContent = "Dashboard";
          $("#snapshotMeta").textContent = "Выберите пару файлов для анализа.";
          renderTable();
        }
        await loadSnapshots();
      });
      actions.appendChild(deleteBtn);
    }
    node.children[8].appendChild(actions);
    root.appendChild(node);
  }
}

async function selectSnapshot(id) {
  const data = await api(`/api/snapshots/${id}/data`);
  state.currentSnapshot = data.snapshot;
  state.records = data.records;
  state.filters = {};
  state.preset = "all";
  $("#searchInput").value = "";
  $$(".filter-chip").forEach((chip) => chip.classList.toggle("active", chip.dataset.preset === "all"));
  renderSnapshotHeader();
  buildColumnFilters();
  applyFilters();
  renderSnapshots();
}

function renderSnapshotHeader() {
  const item = state.currentSnapshot;
  $("#snapshotTitle").textContent = item.title;
  $("#snapshotMeta").textContent = `${item.created_at} · vSphere: ${item.vsphere_filename} · Veeam: ${item.veeam_filename}`;
  $("#exportBtn").disabled = false;
  $("#kpiTotal").textContent = item.total_vms;
  $("#kpiOff").textContent = item.powered_off;
  $("#kpiOffBackup").textContent = item.off_with_backup;
  $("#kpiOffReplica").textContent = item.off_with_replica;
}

function buildColumnFilters() {
  const root = $("#columnFilters");
  root.innerHTML = "";
  for (const [key, type] of columns) {
    const th = document.createElement("th");
    if (type === "select" || type === "bool") {
      const select = document.createElement("select");
      select.dataset.key = key;
      select.innerHTML = '<option value="">All</option>';
      const values = [...new Set(state.records.map((item) => formatFilterValue(item[key], key)))].filter(Boolean).sort();
      for (const value of values) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        select.appendChild(option);
      }
      select.addEventListener("change", handleColumnFilter);
      th.appendChild(select);
    } else {
      const input = document.createElement("input");
      input.placeholder = "Filter";
      input.dataset.key = key;
      input.addEventListener("input", debounce(handleColumnFilter, 120));
      th.appendChild(input);
    }
    root.appendChild(th);
  }
}

function handleColumnFilter(event) {
  const key = event.target.dataset.key;
  const value = event.target.value.trim();
  if (value) state.filters[key] = value;
  else delete state.filters[key];
  applyFilters();
}

function applyFilters() {
  const search = $("#searchInput").value.trim().toLowerCase();
  let rows = state.records.filter((item) => matchesPreset(item));

  for (const [key, value] of Object.entries(state.filters)) {
    rows = rows.filter((item) => {
      const current = formatFilterValue(item[key], key);
      if (["hasVeeamBackup", "hasVeeamReplica", "hasAnyVeeamProtection", "powerState"].includes(key)) {
        return current === value;
      }
      return current.toLowerCase().includes(value.toLowerCase());
    });
  }

  if (search) {
    rows = rows.filter((item) => searchableText(item).includes(search));
  }

  rows.sort((a, b) => {
    const av = formatFilterValue(a[state.sort.key], state.sort.key);
    const bv = formatFilterValue(b[state.sort.key], state.sort.key);
    const result = av.localeCompare(bv, undefined, { numeric: true, sensitivity: "base" });
    return state.sort.dir === "asc" ? result : -result;
  });

  state.filtered = rows;
  renderTable();
}

function matchesPreset(item) {
  if (state.preset === "offBackup") return item.powerState === "PoweredOff" && item.hasVeeamBackup;
  if (state.preset === "offReplica") return item.powerState === "PoweredOff" && item.hasVeeamReplica;
  if (state.preset === "noProtection") return !item.hasAnyVeeamProtection;
  if (state.preset === "poweredOff") return item.powerState === "PoweredOff";
  if (state.preset === "poweredOn") return item.powerState === "PoweredOn";
  return true;
}

function renderTable() {
  const tbody = $("#vmTable tbody");
  tbody.innerHTML = "";
  const fragment = document.createDocumentFragment();
  for (const item of state.filtered) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(item.vmName)}</td>
      <td>${badge(item.powerState, item.powerState === "PoweredOff" ? "powered-off" : "powered-on")}</td>
      <td>${escapeHtml(item.vmHost)}</td>
      <td>${boolBadge(item.hasVeeamBackup, item.hasVeeamBackup && item.hasVeeamReplica ? "yes-both" : "yes-backup")}</td>
      <td>${boolBadge(item.hasVeeamReplica, item.hasVeeamBackup && item.hasVeeamReplica ? "yes-both" : "yes-replica")}</td>
      <td>${boolBadge(item.hasAnyVeeamProtection, item.hasVeeamBackup && item.hasVeeamReplica ? "yes-both" : "yes-backup")}</td>
      <td>${escapeHtml(item.backupJobs.join("; "))}</td>
      <td>${escapeHtml(item.replicaJobs.join("; "))}</td>
      <td>${escapeHtml(item.lastBackupRestorePoint)}</td>
      <td>${escapeHtml(item.lastReplicaRestorePoint)}</td>
      <td>${item.backupRestorePoints || ""}</td>
      <td>${item.replicaRestorePoints || ""}</td>
    `;
    fragment.appendChild(tr);
  }
  tbody.appendChild(fragment);
  $("#rowCount").textContent = `${state.filtered.length} rows`;
}

function badge(text, cls) {
  return `<span class="status-badge ${cls}">${escapeHtml(text || "—")}</span>`;
}

function boolBadge(value, yesClass) {
  return value ? `<span class="status-badge ${yesClass}">Yes</span>` : '<span class="status-badge no">No</span>';
}

function formatFilterValue(value, key) {
  if (Array.isArray(value)) return value.join("; ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value == null) return "";
  return String(value);
}

function searchableText(item) {
  return [
    item.vmName,
    item.powerState,
    item.vmHost,
    item.hasVeeamBackup ? "backup yes" : "backup no",
    item.hasVeeamReplica ? "replica yes" : "replica no",
    item.backupJobs.join(" "),
    item.replicaJobs.join(" "),
    item.lastBackupRestorePoint,
    item.lastReplicaRestorePoint,
  ]
    .join(" ")
    .toLowerCase();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function compactImportError(message) {
  const text = String(message || "");
  if (text.includes("Veeam PowerShell is not installed")) {
    return "Import failed: Veeam PowerShell is not installed. Install Veeam Backup & Replication Console on this PC or run the portal on the Veeam server.";
  }
  if (text.includes("VMware PowerCLI")) {
    return "Import failed: VMware PowerCLI is not available in this Windows profile.";
  }
  return text.split("\n")[0].slice(0, 500);
}

async function loadUsers() {
  const data = await api("/api/users");
  const root = $("#userList");
  root.innerHTML = "";
  $("#adminKpiUsers").textContent = data.users.length;
  $("#adminKpiLocked").textContent = data.users.filter((user) => user.is_locked).length;
  for (const user of data.users) {
    const node = document.createElement("tr");
    node.innerHTML = `
      <td><strong>${escapeHtml(user.username)}</strong></td>
      <td></td>
      <td>${badge(user.is_locked ? "Locked" : "Active", user.is_locked ? "no" : "powered-on")}</td>
      <td>${escapeHtml(user.created_at)}</td>
      <td></td>
      <td></td>
    `;
    const roleSelect = document.createElement("select");
    roleSelect.innerHTML = '<option value="read">read</option><option value="write">write</option><option value="admin">admin</option>';
    roleSelect.value = user.role;
    roleSelect.disabled = state.user.id === user.id;
    roleSelect.addEventListener("change", async () => {
      const nextRole = roleSelect.value;
      try {
        await api(`/api/users/${user.id}/role`, { method: "POST", body: JSON.stringify({ role: nextRole }) });
        $("#adminStatus").textContent = `Role for ${user.username} changed to ${nextRole}.`;
        await loadUsers();
      } catch (error) {
        roleSelect.value = user.role;
        $("#adminStatus").textContent = error.message;
      }
    });
    node.children[1].appendChild(roleSelect);

    const passwordForm = document.createElement("form");
    passwordForm.className = "mini-password";
    passwordForm.innerHTML = '<input type="password" placeholder="New password" autocomplete="new-password" /><button class="btn btn-secondary btn-small" type="submit">Set</button>';
    passwordForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = passwordForm.querySelector("input");
      if (!input.value || input.value.length < 8) {
        $("#adminStatus").textContent = "Password must be at least 8 characters.";
        return;
      }
      await api(`/api/users/${user.id}/password`, { method: "POST", body: JSON.stringify({ newPassword: input.value }) });
      input.value = "";
      $("#adminStatus").textContent = `Password changed for ${user.username}.`;
    });
    node.children[4].appendChild(passwordForm);

    const actions = document.createElement("div");
    actions.className = "mini-actions";
    if (state.user.id !== user.id) {
      const lockBtn = document.createElement("button");
      lockBtn.className = user.is_locked ? "btn btn-secondary btn-small" : "btn btn-danger btn-small";
      lockBtn.textContent = user.is_locked ? "Unlock" : "Lock";
      lockBtn.addEventListener("click", async () => {
        if (!confirm(`${user.is_locked ? "Unlock" : "Lock"} user ${user.username}?`)) return;
        await api(`/api/users/${user.id}/${user.is_locked ? "unlock" : "lock"}`, { method: "POST", body: "{}" });
        await loadUsers();
      });
      actions.appendChild(lockBtn);

      const btn = document.createElement("button");
      btn.className = "btn btn-danger btn-small";
      btn.textContent = "Delete";
      btn.addEventListener("click", async () => {
        if (!confirm(`Delete user ${user.username}? This cannot be undone.`)) return;
        await api(`/api/users/${user.id}`, { method: "DELETE" });
        await loadUsers();
      });
      actions.appendChild(btn);
    }
    node.children[5].appendChild(actions);
    root.appendChild(node);
  }
}

async function loadAdmin() {
  await loadUsers();
  await loadSecurity();
}

async function loadImportLogs() {
  const data = await api("/api/import/logs");
  const root = $("#importLogList");
  root.innerHTML = "";
  $("#logCount").textContent = `${data.logs.length} events`;
  if (!data.logs.length) {
    root.innerHTML = '<tr><td colspan="5" class="muted">No import logs.</td></tr>';
    return;
  }
  for (const item of data.logs) {
    const statusClass = item.status === "success" ? "powered-on" : item.status === "error" ? "no" : "yes-backup";
    const node = document.createElement("tr");
    node.innerHTML = `
      <td>${escapeHtml(item.created_at)}</td>
      <td>${badge(item.status, statusClass)}</td>
      <td>${escapeHtml(item.username || "-")}</td>
      <td>${escapeHtml(item.message)}</td>
      <td class="log-details">${escapeHtml(item.details || "")}</td>
    `;
    root.appendChild(node);
  }
}

async function loadSecurity() {
  const data = await api("/api/security");
  const form = $("#securityForm");
  form.fail2ban_enabled.checked = data.settings.fail2ban_enabled === "true";
  form.fail2ban_max_attempts.value = data.settings.fail2ban_max_attempts || "5";
  form.fail2ban_window_minutes.value = data.settings.fail2ban_window_minutes || "10";
  form.fail2ban_ban_minutes.value = data.settings.fail2ban_ban_minutes || "30";
  renderBans(data.bans);
  renderIpStats(data.ipStats);
  renderAuthEvents(data.events);
  $("#adminKpiBans").textContent = data.bans.length;
  $("#adminKpiEvents").textContent = data.events.length;
}

function renderBans(bans) {
  const root = $("#banList");
  root.innerHTML = "";
  if (!bans.length) {
    root.innerHTML = '<tr><td colspan="6" class="muted">No blocked IPs.</td></tr>';
    return;
  }
  for (const ban of bans) {
    const node = document.createElement("tr");
    node.innerHTML = `
      <td><strong>${escapeHtml(ban.ip)}</strong></td>
      <td>${escapeHtml(ban.reason)}</td>
      <td>${escapeHtml(ban.banned_at)}</td>
      <td>${escapeHtml(ban.expires_at || "Permanent")}</td>
      <td>${escapeHtml(ban.banned_by_username || "system")}</td>
      <td></td>
    `;
    const actions = document.createElement("div");
    actions.className = "mini-actions";
    const button = document.createElement("button");
    button.className = "btn btn-secondary btn-small";
    button.textContent = "Unblock";
    button.addEventListener("click", async () => {
      if (!confirm(`Unblock ${ban.ip}?`)) return;
      await api(`/api/security/unban-ip/${encodeURIComponent(ban.ip)}`, { method: "POST", body: "{}" });
      await loadSecurity();
    });
    actions.appendChild(button);
    node.children[5].appendChild(actions);
    root.appendChild(node);
  }
}

function renderIpStats(stats) {
  const root = $("#ipStats");
  root.innerHTML = "";
  if (!stats.length) {
    root.innerHTML = '<tr><td colspan="5" class="muted">No login activity.</td></tr>';
    return;
  }
  for (const item of stats.slice(0, 20)) {
    const node = document.createElement("tr");
    node.innerHTML = `
      <td><strong>${escapeHtml(item.ip)}</strong></td>
      <td>${item.success_count || 0}</td>
      <td>${item.failure_count || 0}</td>
      <td>${escapeHtml(item.last_seen || "")}</td>
      <td></td>
    `;
    const actions = document.createElement("div");
    actions.className = "mini-actions";
    const button = document.createElement("button");
    button.className = "btn btn-danger btn-small";
    button.textContent = "Block";
    button.addEventListener("click", async () => {
      if (!confirm(`Block IP ${item.ip}?`)) return;
      await api("/api/security/ban-ip", {
        method: "POST",
        body: JSON.stringify({ ip: item.ip, reason: "manual block from monitor" }),
      });
      await loadSecurity();
    });
    actions.appendChild(button);
    node.children[4].appendChild(actions);
    root.appendChild(node);
  }
}

function renderAuthEvents(events) {
  const root = $("#authEvents");
  root.innerHTML = "";
  if (!events.length) {
    root.innerHTML = '<tr><td colspan="5" class="muted">No login events.</td></tr>';
    return;
  }
  for (const event of events.slice(0, 50)) {
    const node = document.createElement("tr");
    node.innerHTML = `
      <td>${escapeHtml(event.created_at)}</td>
      <td><strong>${escapeHtml(event.username || event.resolved_username || "-")}</strong></td>
      <td>${escapeHtml(event.ip)}</td>
      <td>${badge(event.success ? "OK" : "FAIL", event.success ? "powered-on" : "no")}</td>
      <td>${escapeHtml(event.reason)}</td>
    `;
    root.appendChild(node);
  }
}

$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#loginError").textContent = "";
  const payload = Object.fromEntries(new FormData(event.target));
  try {
    const data = await api("/api/login", { method: "POST", body: JSON.stringify(payload) });
    state.user = data.user;
    showApp();
    applyTheme(state.theme);
    armIdleLogout();
    await loadSnapshots();
    if (state.user.role === "admin") await loadAdmin();
  } catch (error) {
    $("#loginError").textContent = error.message;
  }
});

$("#logoutBtn").addEventListener("click", async () => {
  await logout();
});

$("#topLogoutBtn").addEventListener("click", async () => {
  await logout();
});

$("#adminLogoutBtn").addEventListener("click", async () => {
  await logout();
});

$$(".sidebar-nav-item, .sidebar-link[data-view]").forEach((button) => {
  button.addEventListener("click", async () => {
    await navigateTo(button.dataset.view);
  });
});

$("#refreshSnapshots").addEventListener("click", loadSnapshots);
$("#refreshAdminBtn").addEventListener("click", loadAdmin);
$("#refreshLogsBtn").addEventListener("click", loadImportLogs);

$("#uploadForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#uploadStatus").textContent = "Загрузка и анализ...";
  try {
    await api("/api/upload", { method: "POST", body: new FormData(event.target) });
    event.target.reset();
    $("#uploadStatus").textContent = "Готово";
    state.currentSnapshot = null;
    await loadSnapshots();
  } catch (error) {
    $("#uploadStatus").textContent = error.message;
  }
});

$("#importForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#importStatus").textContent = "Запускаю локальный PowerShell импорт...";
  const payload = Object.fromEntries(new FormData(event.target));
  try {
    const data = await api("/api/import/run", { method: "POST", body: JSON.stringify(payload) });
    event.target.vmwarePassword.value = "";
    event.target.veeamPassword.value = "";
    $("#importStatus").textContent = `Готово. Snapshot #${data.snapshotId} создан.`;
    state.currentSnapshot = null;
    await loadSnapshots();
    await selectSnapshot(data.snapshotId);
    await navigateTo("dashboard");
  } catch (error) {
    $("#importStatus").textContent = compactImportError(error.message);
    loadImportLogs().catch(console.error);
  }
});

$("#userForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.target));
  try {
    await api("/api/users", { method: "POST", body: JSON.stringify(payload) });
    event.target.reset();
    $("#adminStatus").textContent = "User created.";
    await loadUsers();
  } catch (error) {
    $("#adminStatus").textContent = error.message;
  }
});

$("#securityForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const payload = {
    fail2ban_enabled: form.fail2ban_enabled.checked,
    fail2ban_max_attempts: form.fail2ban_max_attempts.value,
    fail2ban_window_minutes: form.fail2ban_window_minutes.value,
    fail2ban_ban_minutes: form.fail2ban_ban_minutes.value,
  };
  try {
    await api("/api/security/settings", { method: "POST", body: JSON.stringify(payload) });
    $("#adminStatus").textContent = "Security settings saved.";
    await loadSecurity();
  } catch (error) {
    $("#adminStatus").textContent = error.message;
  }
});

$("#banIpForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.target));
  if (!confirm(`Block IP ${payload.ip}?`)) return;
  try {
    await api("/api/security/ban-ip", { method: "POST", body: JSON.stringify(payload) });
    event.target.reset();
    $("#adminStatus").textContent = "IP blocked.";
    await loadSecurity();
  } catch (error) {
    $("#adminStatus").textContent = error.message;
  }
});

$$(".page-tab").forEach((tabButton) => {
  tabButton.addEventListener("click", () => {
    const name = tabButton.dataset.adminTab;
    $$(".page-tab").forEach((button) => button.classList.toggle("active", button === tabButton));
    $$("[data-admin-page]").forEach((page) => page.classList.toggle("hidden", page.dataset.adminPage !== name));
    if (state.user?.role === "admin") loadSecurity().catch(console.error);
  });
});

$("#searchInput").addEventListener("input", debounce(applyFilters, 120));

$$(".filter-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    state.preset = chip.dataset.preset;
    $$(".filter-chip").forEach((node) => node.classList.toggle("active", node === chip));
    applyFilters();
  });
});

$("#passwordForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.target));
  if (payload.newPassword !== payload.confirmPassword) {
    $("#passwordStatus").textContent = "New passwords do not match.";
    return;
  }
  try {
    await api("/api/me/password", {
      method: "POST",
      body: JSON.stringify({ currentPassword: payload.currentPassword, newPassword: payload.newPassword }),
    });
    event.target.reset();
    $("#passwordStatus").textContent = "Password changed.";
  } catch (error) {
    $("#passwordStatus").textContent = error.message;
  }
});

$("#themeQuickToggle").addEventListener("click", () => {
  applyTheme(state.theme === "dark" ? "light" : "dark");
});

$$("[data-theme-choice]").forEach((button) => {
  button.addEventListener("click", () => applyTheme(button.dataset.themeChoice));
});

$$("th[data-key]").forEach((th) => {
  th.addEventListener("click", () => {
    const key = th.dataset.key;
    if (state.sort.key === key) state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
    else state.sort = { key, dir: "asc" };
    applyFilters();
  });
});

$("#exportBtn").addEventListener("click", () => {
  if (!state.currentSnapshot) return;
  exportFiltered();
});

async function exportFiltered() {
  const response = await fetch("/api/export-filtered", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ snapshot: state.currentSnapshot, records: state.filtered }),
  });
  if (!response.ok) return;
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "vsphere-veeam-filtered.xlsx";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

loadMe().catch((error) => {
  console.error(error);
  state.user = null;
  showApp();
});

["click", "keydown", "mousemove", "scroll", "touchstart"].forEach((eventName) => {
  window.addEventListener(eventName, markActivity, { passive: true });
});
