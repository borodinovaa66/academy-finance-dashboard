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

function productReferences() {
  return state.references.filter((item) => item.group_key === "products");
}

function formatDate(value) {
  if (!value) return "-";
  const [year, month, day] = String(value).split("-");
  if (!year || !month || !day) return String(value);
  return `${day}.${month}.${year}`;
}

function todayIso() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formPayload(form) {
  const payload = Object.fromEntries(new FormData(form).entries());
  form.querySelectorAll("[data-format-number]").forEach((input) => {
    payload[input.name] = normalizeNumber(input.value) || "0";
  });
  return payload;
}

function entryPayload(form) {
  const payload = formPayload(form);
  return {
    ...payload,
    bank: "",
    product_incomes: productReferences()
      .map((product) => ({
        product_id: product.id,
        amount: payload[`product_income_${product.id}`] || "0",
      }))
      .filter((item) => Number(item.amount) > 0),
  };
}

function calculatePlanNetCashFlow(form) {
  const income = Number(normalizeNumber(form.elements.client_income_plan.value) || 0);
  const expense = Number(normalizeNumber(form.elements.expense_plan.value) || 0);
  return income - expense;
}

function refreshPlanNetCashFlow(form) {
  const input = form.elements.net_cash_flow_plan;
  input.value = formatInputValue(calculatePlanNetCashFlow(form), true);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function setGauge(needleId, arcId, valueId, ratio, options = {}) {
  const min = options.min ?? 0;
  const max = options.max ?? 1;
  const bounded = clamp(ratio, min, max);
  const progress = max === min ? 0.5 : (bounded - min) / (max - min);
  const angle = -90 + progress * 180;
  const radians = (angle * Math.PI) / 180;
  const arcLength = clamp(progress * 100, 0, 100);
  const isRisk = Boolean(options.risk);
  byId(needleId).style.transform = `translateX(-50%) rotate(${angle}deg)`;
  byId(arcId).style.strokeDasharray = `${arcLength} 100`;
  byId(arcId).classList.toggle("risk", isRisk);
  byId(needleId).classList.toggle("risk", isRisk);
  const valueLabel = byId(valueId);
  valueLabel.textContent = options.label || "";
  valueLabel.style.left = `${clamp(120 + Math.sin(radians) * 72, 58, 182)}px`;
  valueLabel.style.top = "22px";
  valueLabel.classList.toggle("risk", isRisk);
}

function placeGaugeMarker(markerId, labelId, ratio, options = {}) {
  const min = options.min ?? 0;
  const max = options.max ?? 1;
  const bounded = clamp(ratio, min, max);
  const progress = max === min ? 0.5 : (bounded - min) / (max - min);
  const angle = -90 + progress * 180;
  const radians = (angle * Math.PI) / 180;
  const x = 120 + Math.sin(radians) * 96;
  const y = 118 - Math.cos(radians) * 96;
  const marker = byId(markerId);
  marker.style.setProperty("--marker-x", `${x}px`);
  marker.style.setProperty("--marker-y", `${y}px`);
  marker.classList.toggle("risk", Boolean(options.risk));
  byId(labelId).textContent = options.label || "";
}

function planPayload(form) {
  const payload = formPayload(form);
  payload.net_cash_flow_plan = String(calculatePlanNetCashFlow(form));
  return {
    ...payload,
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

function bindPlanCalculation() {
  const form = byId("planForm");
  ["client_income_plan", "expense_plan"].forEach((name) => {
    form.elements[name].addEventListener("input", () => refreshPlanNetCashFlow(form));
    form.elements[name].addEventListener("blur", () => refreshPlanNetCashFlow(form));
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
  const isRisk = summary.forecast_status === "risk";
  const isNetFlowRisk = summary.net_cash_flow_status === "risk";
  const isNetFlowNegative = summary.net_cash_flow < 0;
  const latestEntry = summary.latest_entry;
  const today = todayIso();
  const dailyIncome = latestEntry ? latestEntry.client_income + latestEntry.deposit_income : 0;
  const dailyRefunds = latestEntry?.client_refunds || 0;
  const dailyDateLabel = latestEntry?.report_date ? formatDate(latestEntry.report_date) : "нет данных";
  const dailyMeta = latestEntry?.report_date
    ? latestEntry.report_date === today
      ? "данные за сегодня"
      : `последние данные, сегодня ${formatDate(today)}`
    : `сегодня ${formatDate(today)}`;

  byId("dailyDataDate").textContent = dailyDateLabel;
  byId("dailyTodayDate").textContent = latestEntry?.report_date ? `сегодня ${formatDate(today)}` : "данные еще не внесены";
  byId("dailyIncome").textContent = rub(dailyIncome);
  byId("dailyIncomeMeta").textContent = dailyMeta;
  byId("dailyDepositIncome").textContent = rub(latestEntry?.deposit_income || 0);
  byId("dailyDepositShare").textContent = `доля ${percent(latestEntry?.deposit_income || 0, dailyIncome)} в приходах дня`;
  byId("dailyExpense").textContent = rub(latestEntry?.expense || 0);
  byId("dailyExpenseMeta").textContent = `${dailyMeta}; в том числе возвраты клиентам ${rub(dailyRefunds)}`;
  byId("dailyClientRefunds").textContent = rub(dailyRefunds);
  byId("dailyClientRefundsMeta").textContent = latestEntry?.report_date ? "в составе расходов за день" : "данные еще не внесены";

  byId("clientIncome").textContent = rub(summary.total_income);
  byId("clientPlan").textContent = `план приходов ${rub(plan.client_income_plan)}`;
  byId("depositIncome").textContent = rub(totals.deposit_income);
  byId("depositShare").textContent = `доля ${percent(totals.deposit_income, summary.total_income)} в приходах`;
  byId("expense").textContent = rub(totals.expense);
  byId("expensePlan").textContent = `план расходов ${rub(plan.expense_plan)}, в том числе возвраты клиентам ${rub(totals.client_refunds || 0)}`;
  byId("clientRefunds").textContent = rub(totals.client_refunds || 0);
  byId("cashBalance").textContent = rub(totals.cash_balance);
  byId("balanceDate").textContent = totals.last_date ? `на ${totals.last_date}` : "нет данных";
  renderProductIncomeDashboard();

  byId("incomePlanTotal").textContent = rub(planIncome);
  byId("incomeFactTotal").textContent = rub(summary.total_income);
  byId("incomeFactPercent").textContent = `${percent(summary.total_income, planIncome)} от плана`;
  byId("incomeForecast").textContent = rub(summary.income_forecast);
  byId("forecastDelta").textContent = `${summary.forecast_delta >= 0 ? "+" : ""}${rub(summary.forecast_delta)}`;
  const incomeGaugeMax = Math.max(planIncome || 0, summary.total_income || 0, 1);
  setGauge("incomeGaugeNeedle", "incomeGaugeArc", "incomeGaugeValue", summary.total_income / incomeGaugeMax, {
    min: 0,
    max: 1,
    risk: isRisk,
    label: rub(summary.total_income),
  });
  placeGaugeMarker("incomeGaugePlanMarker", "incomeGaugePlanLabel", planIncome / incomeGaugeMax, {
    min: 0,
    max: 1,
    risk: isRisk,
    label: rub(planIncome),
  });

  const badge = byId("forecastBadge");
  badge.textContent = isRisk ? "риск недовыполнения" : "прогноз выше плана";
  badge.classList.toggle("risk", isRisk);

  const net = byId("netCashFlow");
  net.textContent = rub(summary.net_cash_flow);
  net.classList.toggle("positive", summary.net_cash_flow >= 0);
  net.classList.toggle("negative", summary.net_cash_flow < 0);
  byId("netFlowPlan").textContent = rub(plan.net_cash_flow_plan);
  byId("netCashFlowPercent").textContent = `${percent(summary.net_cash_flow, plan.net_cash_flow_plan)} от плана`;
  byId("netFlowForecast").textContent = rub(summary.net_cash_flow_forecast);
  byId("netFlowDelta").textContent = `${summary.net_cash_flow_delta >= 0 ? "+" : ""}${rub(summary.net_cash_flow_delta)}`;
  const netScaleMax = Math.max(Math.abs(plan.net_cash_flow_plan || 0), Math.abs(summary.net_cash_flow || 0), 1);
  setGauge("netGaugeNeedle", "netGaugeArc", "netGaugeValue", summary.net_cash_flow / netScaleMax, {
    min: -1,
    max: 1,
    risk: isNetFlowNegative,
    label: rub(summary.net_cash_flow),
  });
  placeGaugeMarker("netGaugePlanMarker", "netGaugePlanLabel", plan.net_cash_flow_plan / netScaleMax, {
    min: -1,
    max: 1,
    risk: isNetFlowNegative,
    label: rub(plan.net_cash_flow_plan),
  });
  const netBadge = byId("netFlowForecastBadge");
  netBadge.textContent = isNetFlowRisk ? "риск недовыполнения" : "прогноз выше плана";
  netBadge.classList.toggle("risk", isNetFlowRisk);
  byId("flowCaption").textContent =
    summary.net_cash_flow_forecast >= plan.net_cash_flow_plan
      ? "При текущем темпе план по чистому денежному потоку будет выполнен."
      : "При текущем темпе чистый денежный поток не дотягивает до плана.";

  drawTrend(summary.entries);
}

function renderProductIncomeDashboard() {
  const items = state.summary?.product_totals || [];
  const grid = byId("productIncomeGrid");
  if (!items.length) {
    grid.innerHTML = `<article class="metric-card"><div class="metric-label">Продукты</div><div class="metric-meta">Добавьте продукты в справочник, чтобы видеть разбивку поступлений.</div></article>`;
    return;
  }
  grid.innerHTML = items
    .filter((item) => item.amount > 0 || item.product_id)
    .map(
      (item) => `
        <article class="metric-card income">
          <div class="metric-label">${escapeHtml(item.product_name)}</div>
          <div class="metric-value">${rub(item.amount)}</div>
          <div class="metric-meta">${percent(item.amount, state.summary.totals.client_income)} от приходов от клиентов</div>
        </article>
      `,
    )
    .join("");
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
  const planForm = byId("planForm");
  planForm.elements.month.value = state.month;
  ["client_income_plan", "expense_plan", "net_cash_flow_plan"].forEach((key) => {
    const input = planForm.elements[key];
    input.value = formatInputValue(plan[key] || 0, input.hasAttribute("data-signed-number"));
  });
  refreshPlanNetCashFlow(planForm);
  const today = todayIso();
  byId("entryForm").elements.report_date.value = today;
  ["client_income", "deposit_income", "expense", "client_refunds", "cash_balance"].forEach((key) => {
    const input = byId("entryForm").elements[key];
    if (!input.value) input.value = key === "cash_balance" ? String(state.summary.totals.cash_balance || 0) : "0";
    input.value = formatInputValue(input.value, input.hasAttribute("data-signed-number"));
  });
  renderProductIncomeInputs();
  renderEntriesHistory();
  renderProductsList();
}

function renderProductIncomeInputs(values = new Map()) {
  const products = productReferences();
  const container = byId("productIncomeInputs");
  if (!products.length) {
    container.innerHTML = `<div class="empty-state">Добавьте продукт в блоке «Список продуктов», после этого здесь появятся поля для ввода сумм.</div>`;
    return;
  }
  container.innerHTML = products
    .map((product) => {
      const value = values.get(Number(product.id)) || 0;
      return `
        <label>${escapeHtml(product.name)}
          <input name="product_income_${product.id}" type="text" inputmode="numeric" data-format-number value="${formatInputValue(value)}" />
        </label>
      `;
    })
    .join("");
  bindFormattedNumberInputs(container);
}

function renderProductsList() {
  const products = productReferences();
  const list = byId("productsList");
  if (!products.length) {
    list.innerHTML = `<div class="empty-state">Продукты еще не добавлены.</div>`;
    return;
  }
  list.innerHTML = products.map((product) => `<span class="chip">${escapeHtml(product.name)}</span>`).join("");
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
            <span>Приходы ${rub(income)} · депозиты ${rub(entry.deposit_income)} (${percent(entry.deposit_income, income)}) · Расходы ${rub(entry.expense)} · Возвраты ${rub(entry.client_refunds || 0)} · Остаток ${rub(entry.cash_balance)}</span>
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
      form.elements.client_refunds.value = formatInputValue(entry.client_refunds || 0);
      form.elements.cash_balance.value = formatInputValue(entry.cash_balance);
      renderProductIncomeInputs(new Map((entry.product_incomes || []).map((item) => [Number(item.product_id), item.amount])));
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
  const result = await api("/api/entries", {
    method: "POST",
    body: JSON.stringify(entryPayload(event.currentTarget)),
  });
  if (result.bitrix?.ok) {
    toast("Данные дня сохранены и отправлены в Bitrix24");
  } else if (result.bitrix?.skipped) {
    toast("Данные дня сохранены, но отправка в Bitrix24 не настроена");
  } else if (result.bitrix?.error) {
    toast(`Данные дня сохранены, но сообщение в Bitrix24 не отправлено: ${result.bitrix.error}`);
  } else {
    toast("Данные дня сохранены");
  }
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

async function addProductByName(name) {
  const productName = String(name || "").trim();
  if (!productName) {
    toast("Введите название продукта");
    return;
  }
  await api("/api/references", {
    method: "POST",
    body: JSON.stringify({ group_key: "products", name: productName }),
  });
  toast("Продукт добавлен");
  await loadData();
}

byId("productForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  await addProductByName(formData.get("name"));
  form.reset();
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
bindPlanCalculation();
bindPasswordToggles();
