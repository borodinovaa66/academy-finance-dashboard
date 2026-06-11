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

const formatRub = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
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
  return formatRub.format(Number(value || 0));
}

function toast(message) {
  const el = byId("toast");
  el.textContent = message;
  el.classList.add("visible");
  window.setTimeout(() => el.classList.remove("visible"), 2600);
}

function setView(viewId) {
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === viewId));
  document.querySelectorAll(".nav-button").forEach((button) => button.classList.toggle("active", button.dataset.view === viewId));
}

function availableViews() {
  if (state.user.role === "admin") return [["usersView", "Пользователи"]];
  if (state.user.role === "accountant") {
    return [
      ["dashboardView", "Дашборд"],
      ["accountingView", "Ввод и планы"],
    ];
  }
  return [["dashboardView", "Дашборд"]];
}

function renderShell() {
  byId("roleLabel").textContent = roleLabels[state.user.role];
  byId("userName").textContent = state.user.name;
  byId("monthInput").value = state.month;
  byId("nav").innerHTML = "";
  availableViews().forEach(([id, label]) => {
    const button = document.createElement("button");
    button.className = "nav-button";
    button.type = "button";
    button.dataset.view = id;
    button.textContent = label;
    button.addEventListener("click", () => setView(id));
    byId("nav").append(button);
  });
  setView(availableViews()[0][0]);
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

  byId("clientIncome").textContent = rub(totals.client_income);
  byId("clientPlan").textContent = `план ${rub(plan.client_income_plan)}`;
  byId("depositIncome").textContent = rub(totals.deposit_income);
  byId("depositPlan").textContent = `план ${rub(plan.deposit_income_plan)}`;
  byId("expense").textContent = rub(totals.expense);
  byId("expensePlan").textContent = `план ${rub(plan.expense_plan)}`;
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

  if (!entries.length) {
    ctx.fillStyle = "#66727f";
    ctx.font = "700 18px Arial";
    ctx.fillText("Нет данных за выбранный месяц", 32, 170);
    return;
  }

  const rows = entries.map((entry) => ({
    label: entry.report_date.slice(8, 10),
    income: entry.client_income + entry.deposit_income,
    expense: entry.expense,
    balance: entry.cash_balance,
  }));
  const max = Math.max(...rows.flatMap((row) => [row.income, row.expense]), 1);
  const chartLeft = 64;
  const chartTop = 36;
  const chartWidth = width - 100;
  const chartHeight = height - 88;
  const barGap = chartWidth / rows.length;

  ctx.strokeStyle = "#d9e0e7";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = chartTop + (chartHeight / 4) * i;
    ctx.beginPath();
    ctx.moveTo(chartLeft, y);
    ctx.lineTo(width - 28, y);
    ctx.stroke();
  }

  rows.forEach((row, index) => {
    const x = chartLeft + index * barGap + 10;
    const incomeHeight = (row.income / max) * chartHeight;
    const expenseHeight = (row.expense / max) * chartHeight;
    ctx.fillStyle = "#167a55";
    ctx.fillRect(x, chartTop + chartHeight - incomeHeight, Math.max(10, barGap * 0.28), incomeHeight);
    ctx.fillStyle = "#b93737";
    ctx.fillRect(x + Math.max(14, barGap * 0.32), chartTop + chartHeight - expenseHeight, Math.max(10, barGap * 0.28), expenseHeight);
    ctx.fillStyle = "#66727f";
    ctx.font = "700 12px Arial";
    ctx.fillText(row.label, x, height - 28);
  });

  ctx.fillStyle = "#17202a";
  ctx.font = "800 14px Arial";
  ctx.fillText("зеленый - поступления, красный - расходы", chartLeft, 20);
}

function renderAccountingForms() {
  if (!state.summary) return;
  const plan = state.summary.plan;
  byId("planForm").elements.month.value = state.month;
  ["client_income_plan", "deposit_income_plan", "expense_plan", "net_cash_flow_plan", "cash_balance_plan"].forEach((key) => {
    byId("planForm").elements[key].value = plan[key] || 0;
  });
  const today = new Date().toISOString().slice(0, 10);
  byId("entryForm").elements.report_date.value ||= today;
  byId("entryForm").elements.bank.value ||= state.references.find((item) => item.group_key === "banks")?.name || "ТБанк";
  byId("bankList").innerHTML = state.references
    .filter((item) => item.group_key === "banks")
    .map((item) => `<option value="${escapeHtml(item.name)}"></option>`)
    .join("");
  byId("referencesList").innerHTML = state.references
    .filter((item) => item.group_key === "banks")
    .map((item) => `<span class="chip">${escapeHtml(item.name)}</span>`)
    .join("");
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
          ${user.active ? `<button class="danger-action" data-delete-user="${user.id}" type="button">Отключить</button>` : ""}
        </div>
      `,
    )
    .join("");
  document.querySelectorAll("[data-delete-user]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api(`/api/users/${button.dataset.deleteUser}`, { method: "DELETE" });
      toast("Пользователь отключен");
      await loadData();
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
  const form = new FormData(event.currentTarget);
  await api("/api/entries", {
    method: "POST",
    body: JSON.stringify(Object.fromEntries(form.entries())),
  });
  toast("Данные дня сохранены");
  await loadData();
});

byId("planForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  await api("/api/plans", {
    method: "POST",
    body: JSON.stringify(Object.fromEntries(form.entries())),
  });
  state.month = form.get("month");
  toast("План сохранен");
  await loadData();
});

byId("referenceForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  await api("/api/references", {
    method: "POST",
    body: JSON.stringify({ group_key: "banks", name: form.get("name") }),
  });
  event.currentTarget.reset();
  toast("Справочник обновлен");
  await loadData();
});

byId("userForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  await api("/api/users", {
    method: "POST",
    body: JSON.stringify(Object.fromEntries(form.entries())),
  });
  event.currentTarget.reset();
  toast("Пользователь создан");
  await loadData();
});

init().catch((error) => {
  byId("loginError").textContent = error.message;
  byId("loginScreen").classList.remove("hidden");
});
