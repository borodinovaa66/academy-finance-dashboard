const state = {
  user: null,
  month: new Date().toISOString().slice(0, 7),
  summary: null,
  references: [],
  users: [],
};

const roleLabels = {
  owner: "Собственник",
  accountant: "Бухгалтер",
  admin: "Админ",
  viewer: "Доступ к дашборду",
};

const byId = (id) => document.getElementById(id);
const api = async (url, options = {}) => {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Ошибка запроса");
  return data;
};

function rub(value) {
  return formatInteger(value);
}

function normalizeNumber(value) {
  return String(value || "").replace(/\s+/g, "").replace(/[^\d-]/g, "");
}

function formatInteger(value) {
  const normalized = normalizeNumber(value);
  if (!normalized || normalized === "-") return "0";
  const sign = normalized.startsWith("-") ? "-" : "";
  const digits = normalized.replace(/-/g, "").replace(/^0+(?=\d)/, "");
  return `${sign}${digits || "0"}`.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function formatInputValue(value, signed = false) {
  const normalized = normalizeNumber(value);
  const sign = signed && normalized.startsWith("-") ? "-" : "";
  const digits = normalized.replace(/-/g, "").replace(/^0+(?=\d)/, "");
  if (!digits) return sign;
  return `${sign}${digits}`.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function percent(value, total) {
  if (!total) return "0%";
  const result = (Number(value || 0) / Number(total || 0)) * 100;
  return `${result.toFixed(1).replace(".", ",")}%`;
}

function formPayload(form) {
  const payload = Object.fromEntries(new FormData(form).entries());
  form.querySelectorAll("[data-format-number]").forEach((input) => {
    payload[input.name] = normalizeNumber(input.value) || "0";
  });
  return payload;
}

function entryPayload(form) {
  return {
    ...formPayload(form),
    bank: "",
  };
}

function planPayload(form) {
  return {
    ...formPayload(form),
    deposit_income_plan: "0",
    cash_balance_plan: "0",
  };
}

function bindFormattedNumberInputs(root = document) {
  root.querySelectorAll("[data-format-number]").forEach((input) => {
    if (input.dataset.boundNumberFormat) return;
    input.dataset.boundNumberFormat = "true";
    input.addEventListener("input", () => {
      input.value = formatInputValue(input.value, input.hasAttribute("data-signed-number"));
    });
    input.addEventListener("blur", () => {
      input.value = formatInputValue(input.value, input.hasAttribute("data-signed-number")) || "0";
    });
  });
}

function toast(message) {
  const el = byId("toast");
  el.textContent = message;
  el.classList.add("visible");
  window.setTimeout(() => el.classList.remove("visible"), 2600);
}

function setFormError(id, message = "") {
  const el = byId(id);
  if (!el) return;
  el.textContent = message;
}

function selectedUserFromEditForm() {
  const id = byId("editUserForm").elements.id.value;
  return state.users.find((user) => String(user.id) === String(id));
}

function openDeleteUserConfirm(user) {
  if (!user) return;
  const dialog = byId("confirmDialog");
  dialog.dataset.userId = user.id;
  byId("confirmMessage").textContent = `Вы действительно хотите удалить пользователя ${user.name}?`;
  dialog.classList.remove("hidden");
}

function closeDeleteUserConfirm() {
  const dialog = byId("confirmDialog");
  dialog.dataset.userId = "";
  dialog.classList.add("hidden");
}

async function deleteUserById(id) {
  await api(`/api/users/${id}`, { method: "DELETE" });
  const editForm = byId("editUserForm");
  if (String(editForm.elements.id.value) === String(id)) {
    editForm.reset();
    editForm.classList.add("hidden");
  }
  closeDeleteUserConfirm();
  toast("Пользователь удален");
  await loadData();
}

function setView(viewId) {
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === viewId));
  document.querySelectorAll(".nav-button").forEach((button) => button.classList.toggle("active", button.dataset.view === viewId));
}

function availableViews() {
  if (state.user.role === "admin") {
    return [
      ["dashboardView", "Дашборд"],
      ["accountingView", "Ввод и планы"],
      ["usersView", "Пользователи"],
    ];
  }
  if (state.user.role === "accountant") {
    return [
      ["dashboardView", "Дашборд"],
      ["accountingView", "Ввод и планы"],
    ];
  }
  return [["dashboardView", "Дашборд"]];
}

function renderShell() {
  const currentView = document.querySelector(".view.active")?.id;
  const views = availableViews();
  byId("roleLabel").textContent = roleLabels[state.user.role];
  byId("userName").textContent = state.user.name;
  byId("monthInput").value = state.month;
  byId("nav").innerHTML = "";
  views.forEach(([id, label]) => {
    const button = document.createElement("button");
    button.className = "nav-button";
    button.type = "button";
    button.dataset.view = id;
    button.textContent = label;
    button.addEventListener("click", () => setView(id));
    byId("nav").append(button);
  });
  const nextView = views.some(([id]) => id === currentView) ? currentView : views[0][0];
  setView(nextView);
}

function renderDashboard() {
  const summary = state.summary;
  if (!summary) return;
  const plan = summary.plan;
  const totals = summary.totals;
  const planIncome = summary.plan_income;
  const fillPercent = Math.max(0, Math.min(100, summary.progress * 100));
  const factLinePercent = Math.max(0, Math.min(96, fillPercent));
  const isRisk = summary.forecast_status === "risk";
  const netFlowFillPercent = Math.max(0, Math.min(100, summary.net_cash_flow_progress * 100));
  const netFlowFactLinePercent = Math.max(0, Math.min(96, netFlowFillPercent));
  const isNetFlowRisk = summary.net_cash_flow_status === "risk";

  byId("clientIncome").textContent = rub(summary.total_income);
  byId("clientPlan").textContent = `план приходов ${rub(plan.client_income_plan)}`;
  byId("depositIncome").textContent = rub(totals.deposit_income);
  byId("depositShare").textContent = `доля ${percent(totals.deposit_income, summary.total_income)} в приходах`;
  byId("expense").textContent = rub(totals.expense);
  byId("expensePlan").textContent = `план расходов ${rub(plan.expense_plan)}`;
  byId("cashBalance").textContent = rub(totals.cash_balance);
  byId("balanceDate").textContent = totals.last_date ? `на ${totals.last_date}` : "нет данных";

  byId("incomePlanTotal").textContent = rub(planIncome);
  byId("incomeFactTotal").textContent = rub(summary.total_income);
  byId("incomeForecast").textContent = rub(summary.income_forecast);
  byId("forecastDelta").textContent = `${summary.forecast_delta >= 0 ? "+" : ""}${rub(summary.forecast_delta)}`;
  byId("vesselFill").style.height = `${fillPercent}%`;
  byId("vesselFill").style.background = isRisk
    ? "linear-gradient(180deg, #e16f6f, #b93737)"
    : "linear-gradient(180deg, #47b883, #167a55)";
  byId("factLine").style.bottom = `${factLinePercent}%`;

  const badge = byId("forecastBadge");
  badge.textContent = isRisk ? "риск недовыполнения" : "прогноз выше плана";
  badge.classList.toggle("risk", isRisk);

  const net = byId("netCashFlow");
  net.textContent = rub(summary.net_cash_flow);
  net.classList.toggle("positive", summary.net_cash_flow >= 0);
  net.classList.toggle("negative", summary.net_cash_flow < 0);
  byId("netFlowPlan").textContent = rub(plan.net_cash_flow_plan);
  byId("netFlowForecast").textContent = rub(summary.net_cash_flow_forecast);
  byId("netFlowDelta").textContent = `${summary.net_cash_flow_delta >= 0 ? "+" : ""}${rub(summary.net_cash_flow_delta)}`;
  byId("netVesselFill").style.height = `${netFlowFillPercent}%`;
  byId("netVesselFill").style.background = isNetFlowRisk
    ? "linear-gradient(180deg, #e16f6f, #b93737)"
    : "linear-gradient(180deg, #47b883, #167a55)";
  byId("netFactLine").style.bottom = `${netFlowFactLinePercent}%`;
  const netBadge = byId("netFlowForecastBadge");
  netBadge.textContent = isNetFlowRisk ? "риск недовыполнения" : "прогноз выше плана";
  netBadge.classList.toggle("risk", isNetFlowRisk);
  byId("flowCaption").textContent =
    summary.net_cash_flow_forecast >= plan.net_cash_flow_plan
      ? "При текущем темпе план по чистому денежному потоку будет выполнен."
      : "При текущем темпе чистый денежный поток не дотягивает до плана.";

  drawTrend(summary.entries);
}

function drawTrend(entries) {
  const canvas = byId("trendCanvas");
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, width, height);

  const [year, month] = state.month.split("-").map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const entriesByDay = new Map(entries.map((entry) => [Number(entry.report_date.slice(8, 10)), entry]));
  const totalIncome = entries.reduce((sum, entry) => sum + entry.client_income + entry.deposit_income, 0);
  const totalExpense = entries.reduce((sum, entry) => sum + entry.expense, 0);
  const rows = Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1;
    const entry = entriesByDay.get(day);
    return {
      day,
      label: String(day).padStart(2, "0"),
      income: entry ? entry.client_income + entry.deposit_income : 0,
      expense: entry ? entry.expense : 0,
      hasData: Boolean(entry),
    };
  });
  const max = Math.max(totalIncome, totalExpense, ...rows.flatMap((row) => [row.income, row.expense]), 1);
  const chartLeft = 32;
  const chartTop = 36;
  const chartRight = width - 28;
  const chartBottom = height - 56;
  const chartHeight = chartBottom - chartTop;
  const totalBlockWidth = 142;
  const totalGap = 34;
  const daysLeft = chartLeft + totalBlockWidth + totalGap;
  const daysWidth = chartRight - daysLeft;
  const dayGap = daysWidth / daysInMonth;

  ctx.strokeStyle = "#d9e0e7";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = chartTop + (chartHeight / 4) * i;
    ctx.beginPath();
    ctx.moveTo(chartLeft, y);
    ctx.lineTo(chartRight, y);
    ctx.stroke();
  }

  ctx.fillStyle = "#17202a";
  ctx.font = "800 14px Arial";
  ctx.fillText("зеленый - приход, красный - расход", chartLeft, 20);

  function drawBarPair(x, groupWidth, income, expense, muted = false) {
    const barWidth = Math.max(4, Math.min(16, groupWidth * 0.34));
    const gap = Math.max(2, groupWidth * 0.08);
    const pairWidth = barWidth * 2 + gap;
    const startX = x + (groupWidth - pairWidth) / 2;
    const incomeHeight = (income / max) * chartHeight;
    const expenseHeight = (expense / max) * chartHeight;
    if (muted) {
      ctx.strokeStyle = "#d4dde6";
      ctx.beginPath();
      ctx.moveTo(x + groupWidth / 2, chartBottom - 2);
      ctx.lineTo(x + groupWidth / 2, chartBottom);
      ctx.stroke();
      return;
    }
    ctx.fillStyle = "#167a55";
    ctx.fillRect(startX, chartBottom - incomeHeight, barWidth, incomeHeight);
    ctx.fillStyle = "#b93737";
    ctx.fillRect(startX + barWidth + gap, chartBottom - expenseHeight, barWidth, expenseHeight);
  }

  drawBarPair(chartLeft + 8, totalBlockWidth - 16, totalIncome, totalExpense);
  ctx.fillStyle = "#17202a";
  ctx.font = "800 12px Arial";
  ctx.fillText("Всего", chartLeft + 36, chartBottom + 18);
  ctx.fillText("за месяц", chartLeft + 22, chartBottom + 34);

  ctx.strokeStyle = "#c8d3de";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(chartLeft + totalBlockWidth + totalGap / 2, chartTop - 6);
  ctx.lineTo(chartLeft + totalBlockWidth + totalGap / 2, chartBottom + 8);
  ctx.stroke();

  rows.forEach((row, index) => {
    const x = daysLeft + index * dayGap;
    drawBarPair(x, dayGap, row.income, row.expense, !row.hasData);
    ctx.fillStyle = row.hasData ? "#66727f" : "#98a3ae";
    ctx.font = "700 10px Arial";
    ctx.fillText(row.label, x + Math.max(1, dayGap * 0.14), chartBottom + 22);
  });
}

function renderAccountingForms() {
  if (!state.summary) return;
  const plan = state.summary.plan;
  byId("planForm").elements.month.value = state.month;
  ["client_income_plan", "expense_plan", "net_cash_flow_plan"].forEach((key) => {
    const input = byId("planForm").elements[key];
    input.value = formatInputValue(plan[key] || 0, input.hasAttribute("data-signed-number"));
  });
  const today = new Date().toISOString().slice(0, 10);
  byId("entryForm").elements.report_date.value ||= today;
  ["client_income", "deposit_income", "expense", "cash_balance"].forEach((key) => {
    const input = byId("entryForm").elements[key];
    if (!input.value) input.value = "0";
    input.value = formatInputValue(input.value, input.hasAttribute("data-signed-number"));
  });
  renderEntriesHistory();
}

function renderEntriesHistory() {
  const entries = state.summary?.entries || [];
  const list = byId("entriesList");
  if (!entries.length) {
    list.innerHTML = `<div class="empty-state">За выбранный месяц данные еще не внесены.</div>`;
    return;
  }
  list.innerHTML = entries
    .map((entry) => {
      const income = entry.client_income + entry.deposit_income;
      return `
        <div class="entry-row">
          <div>
            <strong>${escapeHtml(entry.report_date)}</strong>
            <span>Приходы ${rub(income)} · депозиты ${rub(entry.deposit_income)} (${percent(entry.deposit_income, income)}) · Расходы ${rub(entry.expense)} · Остаток ${rub(entry.cash_balance)}</span>
          </div>
          <button class="secondary-action" data-edit-entry="${escapeHtml(entry.report_date)}" type="button">Изменить</button>
        </div>
      `;
    })
    .join("");
  document.querySelectorAll("[data-edit-entry]").forEach((button) => {
    button.addEventListener("click", () => {
      const entry = entries.find((item) => item.report_date === button.dataset.editEntry);
      if (!entry) return;
      const form = byId("entryForm");
      form.elements.report_date.value = entry.report_date;
      form.elements.client_income.value = formatInputValue(entry.client_income);
      form.elements.deposit_income.value = formatInputValue(entry.deposit_income);
      form.elements.expense.value = formatInputValue(entry.expense);
      form.elements.cash_balance.value = formatInputValue(entry.cash_balance);
      form.elements.comment.value = entry.comment || "";
      form.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function renderUsers() {
  byId("usersList").innerHTML = state.users
    .map(
      (user) => `
        <div class="user-row">
          <div>
            <strong>${escapeHtml(user.name)}</strong>
            <span>${escapeHtml(user.login)} · ${roleLabels[user.role]} · ${user.active ? "активен" : "отключен"}</span>
          </div>
          <div class="user-actions">
            <button class="secondary-action" data-edit-user="${user.id}" type="button">Изменить</button>
            ${
              String(user.id) === String(state.user.id)
                ? ""
                : `<button class="danger-action" data-delete-user="${user.id}" type="button">Удалить</button>`
            }
          </div>
        </div>
      `,
    )
    .join("");
  document.querySelectorAll("[data-edit-user]").forEach((button) => {
    button.addEventListener("click", () => {
      const user = state.users.find((item) => String(item.id) === String(button.dataset.editUser));
      if (!user) return;
      const form = byId("editUserForm");
      form.elements.id.value = user.id;
      form.elements.name.value = user.name;
      form.elements.login.value = user.login;
      form.elements.password.value = "";
      form.elements.role.value = user.role;
      form.elements.active.checked = Boolean(user.active);
      byId("deleteUserFromCardButton").classList.toggle("hidden", String(user.id) === String(state.user.id));
      form.classList.remove("hidden");
      form.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
  document.querySelectorAll("[data-delete-user]").forEach((button) => {
    button.addEventListener("click", () => {
      const user = state.users.find((item) => String(item.id) === String(button.dataset.deleteUser));
      openDeleteUserConfirm(user);
    });
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function loadData() {
  const data = await api(`/api/bootstrap?month=${encodeURIComponent(state.month)}`);
  state.user = data.user;
  state.summary = data.summary;
  state.references = data.references || [];
  state.users = data.users || [];
  renderShell();
  renderDashboard();
  renderAccountingForms();
  renderUsers();
}

async function init() {
  const me = await api("/api/auth/me");
  if (!me.user) {
    byId("loginScreen").classList.remove("hidden");
    byId("app").classList.add("hidden");
    return;
  }
  state.user = me.user;
  byId("loginScreen").classList.add("hidden");
  byId("app").classList.remove("hidden");
  await loadData();
}

byId("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  byId("loginError").textContent = "";
  const form = new FormData(event.currentTarget);
  try {
    await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ login: form.get("login"), password: form.get("password") }),
    });
    await init();
  } catch (error) {
    byId("loginError").textContent = error.message;
  }
});

byId("logoutButton").addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST", body: "{}" });
  window.location.reload();
});

byId("monthInput").addEventListener("change", async (event) => {
  state.month = event.target.value;
  await loadData();
});

byId("entryForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  await api("/api/entries", {
    method: "POST",
    body: JSON.stringify(entryPayload(event.currentTarget)),
  });
  toast("Данные дня сохранены");
  await loadData();
});

byId("planForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  await api("/api/plans", {
    method: "POST",
    body: JSON.stringify(planPayload(event.currentTarget)),
  });
  state.month = form.get("month");
  toast("План сохранен");
  await loadData();
});

byId("userForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  setFormError("userFormError");
  if (formData.get("password") !== formData.get("password_confirm")) {
    setFormError("userFormError", "Пароли не совпадают");
    return;
  }
  const payload = Object.fromEntries(formData.entries());
  delete payload.password_confirm;
  try {
    await api("/api/users", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    form.reset();
    toast("Пользователь создан");
    await loadData();
  } catch (error) {
    setFormError("userFormError", error.message);
  }
});

byId("editUserForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const id = formData.get("id");
  const payload = {
    name: formData.get("name"),
    login: formData.get("login"),
    role: formData.get("role"),
    active: form.elements.active.checked,
  };
  const password = formData.get("password");
  if (password) payload.password = password;
  await api(`/api/users/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  form.reset();
  form.classList.add("hidden");
  toast("Пользователь обновлен");
  await loadData();
});

byId("cancelEditUserButton").addEventListener("click", () => {
  const form = byId("editUserForm");
  form.reset();
  form.classList.add("hidden");
});

byId("deleteUserFromCardButton").addEventListener("click", () => {
  openDeleteUserConfirm(selectedUserFromEditForm());
});

byId("confirmNoButton").addEventListener("click", closeDeleteUserConfirm);

byId("confirmYesButton").addEventListener("click", async () => {
  const id = byId("confirmDialog").dataset.userId;
  if (!id) return;
  try {
    await deleteUserById(id);
  } catch (error) {
    closeDeleteUserConfirm();
    toast(error.message);
  }
});

function bindPasswordToggles() {
  document.querySelectorAll("[data-toggle-password]").forEach((button) => {
    if (button.dataset.boundToggle) return;
    button.dataset.boundToggle = "true";
    button.addEventListener("click", () => {
      const form = button.closest("form");
      const input = form?.elements[button.dataset.togglePassword];
      if (!input) return;
      const shouldShow = input.type === "password";
      input.type = shouldShow ? "text" : "password";
      button.classList.toggle("active", shouldShow);
      button.setAttribute("aria-label", shouldShow ? "Скрыть пароль" : "Показать пароль");
    });
  });
}

init().catch((error) => {
  byId("loginError").textContent = error.message;
  byId("loginScreen").classList.remove("hidden");
});

bindFormattedNumberInputs();
bindPasswordToggles();
