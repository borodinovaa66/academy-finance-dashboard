const state = {
  user: null,
  launchId: null,
  summary: null,
  launches: [],
  activeLaunches: [],
  archivedLaunches: [],
  references: { products: [], streams: [] },
  users: [],
};

const roleLabels = {
  owner: "Руководитель",
  project: "Проджект",
  admin: "Админ",
  viewer: "Только дашборд",
};

const defaultContentChannels = ["Instagram", "Telegram", "Email", "ТГ бот", "VK-бот", "Сейл-бот", "VK", "YouTube", "Rutube", "Dzen"];

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

function percent(value) {
  return `${(Number(value || 0) * 100).toFixed(1).replace(".", ",")}%`;
}

function signedPercent(value) {
  const number = Number(value || 0);
  const sign = number > 0 ? "+" : "";
  return `${sign}${(number * 100).toFixed(1).replace(".", ",")}%`;
}

function formatDateShort(value) {
  if (!value) return "";
  const [year, month, day] = String(value).split("-");
  if (!year || !month || !day) return String(value);
  return `${day}.${month}`;
}

function yesterdayDateValue() {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return date.toISOString().slice(0, 10);
}

function buildLaunchDays(summary) {
  const launch = summary.launch;
  const reportsByDate = new Map(summary.reports.map((report) => [report.report_date, report]));
  const start = new Date(`${launch.start_date}T00:00:00`);
  const end = new Date(`${launch.webinar_date || launch.end_date}T00:00:00`);
  const days = [];
  for (let cursor = new Date(start), index = 1; cursor <= end; cursor.setDate(cursor.getDate() + 1), index += 1) {
    const date = cursor.toISOString().slice(0, 10);
    days.push(
      reportsByDate.get(date) || {
        report_date: date,
        launch_day: index,
        visits: 0,
        site_visitors: 0,
        registrations: 0,
        landing_pages: (summary.landing_pages || []).map((page) => ({ ...page, visitors: 0, registrations: 0, conversion: 0 })),
        channels: [],
        is_empty: true,
      },
    );
  }
  return days;
}

function launchLabel(launch) {
  return `${launch.product_name || "Без продукта"} · ${launch.stream_name || "Без потока"}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function toast(message) {
  const el = byId("toast");
  el.textContent = message;
  el.classList.add("visible");
  window.setTimeout(() => el.classList.remove("visible"), 2600);
}

function bindFormattedNumberInputs(root = document) {
  root.querySelectorAll("[data-format-number]").forEach((input) => {
    if (input.dataset.boundNumberFormat) return;
    input.dataset.boundNumberFormat = "true";
    input.addEventListener("input", () => {
      input.value = formatInteger(input.value);
    });
    input.addEventListener("blur", () => {
      input.value = formatInteger(input.value);
    });
  });
}

function formPayload(form) {
  const payload = Object.fromEntries(new FormData(form).entries());
  form.querySelectorAll("[data-format-number]").forEach((input) => {
    payload[input.name] = normalizeNumber(input.value) || "0";
  });
  return payload;
}

function availableViews() {
  if (state.user.role === "admin") return [["dashboardView", "Дашборд"], ["inputView", "Ввод данных"], ["referencesView", "Справочники"], ["archiveView", "Архив"], ["usersView", "Пользователи"]];
  if (state.user.role === "project") return [["dashboardView", "Дашборд"], ["inputView", "Ввод данных"], ["referencesView", "Справочники"], ["archiveView", "Архив"]];
  return [["dashboardView", "Дашборд"], ["archiveView", "Архив"]];
}

function setView(viewId) {
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === viewId));
  document.querySelectorAll(".nav-button").forEach((button) => button.classList.toggle("active", button.dataset.view === viewId));
}

function renderShell() {
  const currentView = document.querySelector(".view.active")?.id;
  byId("roleLabel").textContent = roleLabels[state.user.role];
  byId("userName").textContent = state.user.name;
  byId("nav").innerHTML = "";
  const views = availableViews();
  views.forEach(([id, label]) => {
    const button = document.createElement("button");
    button.className = "nav-button";
    button.type = "button";
    button.dataset.view = id;
    button.textContent = label;
    button.addEventListener("click", () => setView(id));
    byId("nav").append(button);
  });
  setView(views.some(([id]) => id === currentView) ? currentView : views[0][0]);
  renderLaunchNav();
}

function renderLaunchNav() {
  const container = byId("launchNav");
  const active = state.activeLaunches || [];
  container.innerHTML = `<div class="launch-nav-title">Активные вебинары</div>`;
  if (!active.length) {
    container.innerHTML += `<div class="brand-subtitle">Нет активных запусков</div>`;
    return;
  }
  active.forEach((launch) => {
    const button = document.createElement("button");
    button.className = "launch-pill";
    button.type = "button";
    button.classList.toggle("active", Number(state.launchId) === Number(launch.id));
    button.innerHTML = `<strong>${escapeHtml(launch.title)}</strong><span>${escapeHtml(launchLabel(launch))} · ${formatDateShort(launch.webinar_date)}</span>`;
    button.addEventListener("click", async () => {
      state.launchId = launch.id;
      await loadData();
      setView("dashboardView");
    });
    container.append(button);
  });
}

function renderDashboard() {
  const summary = state.summary;
  if (!summary) return;
  const { launch, totals } = summary;
  const progress = Math.max(0, Math.min(100, summary.progress * 100));
  const isRisk = summary.goal_delta < 0;
  const yesterday = summary.yesterday || { visits: 0, site_visitors: 0, registrations: 0, conversion: 0, landing_pages: [], has_data: false };
  const archived = launch.computed_status === "archived";
  const dailyMode = yesterday.mode || (archived ? "final" : "yesterday");

  byId("launchTitle").textContent = launch.title;
  byId("launchMeta").textContent = `${launchLabel(launch)} · вебинар ${formatDateShort(launch.webinar_date)} · сбор ${formatDateShort(launch.start_date)} - ${formatDateShort(launch.end_date)}`;
  byId("statusBadge").textContent = archived ? "архив: сбор зафиксирован" : isRisk ? "есть риск недобора" : "темп нормальный";
  byId("statusBadge").classList.toggle("risk", !archived && isRisk);
  byId("dailySectionTitle").textContent = dailyMode === "final" ? "Финал сбора" : "За вчера";
  byId("yesterdayDateLabel").textContent =
    dailyMode === "final"
      ? `${formatDateShort(yesterday.report_date)} · данные сбора зафиксированы`
      : `${formatDateShort(yesterday.report_date)} · ${yesterday.has_data ? "данные внесены" : "данные не внесены"}`;
  byId("yesterdayVisits").textContent = formatInteger(yesterday.visits);
  byId("yesterdayVisitsMeta").textContent = yesterday.has_data ? "сумма по всем посадочным" : "нет данных";
  renderDailyPlanBadge("yesterdayVisitsPlan", yesterday.daily_plan?.visitors, yesterday.has_data);
  byId("yesterdayLandingCount").textContent = formatInteger(summary.landing_pages?.length || 0);
  byId("yesterdayLandingMeta").textContent = "активных посадочных";
  byId("yesterdayRegistrations").textContent = formatInteger(yesterday.registrations);
  byId("yesterdayRegistrationsMeta").textContent = yesterday.has_data ? (dailyMode === "final" ? "регистрации в финальном срезе" : "регистрации за день") : "нет данных";
  renderDailyPlanBadge("yesterdayRegistrationsPlan", yesterday.daily_plan?.registrations, yesterday.has_data);
  byId("yesterdayConversion").textContent = percent(yesterday.conversion);
  byId("yesterdayConversionMeta").textContent = yesterday.has_data ? (dailyMode === "final" ? "конверсия финального среза" : "дневная конверсия") : "нет данных";

  byId("registrationsNow").textContent = formatInteger(totals.registrations);
  byId("registrationsGoal").textContent = `цель ${formatInteger(launch.registration_goal)} · за период ${formatInteger(totals.period_registrations)} · выполнено ${percent(summary.progress)}`;
  byId("forecastTotal").textContent = formatInteger(summary.forecast);
  byId("forecastDelta").textContent = `${summary.goal_delta >= 0 ? "+" : ""}${formatInteger(summary.goal_delta)} к цели`;
  byId("conversionRate").textContent = percent(summary.conversion);
  byId("trafficQuality").textContent = `средняя за период`;
  byId("requiredPerDay").textContent = formatInteger(summary.required_per_day);
  byId("pacePerDay").textContent = `текущий темп ${formatInteger(summary.pace_per_day)} в день`;

  renderGauge(totals.registrations, launch.registration_goal);
  byId("factStat").textContent = formatInteger(totals.registrations);
  byId("goalStat").textContent = formatInteger(launch.registration_goal);
  byId("forecastStat").textContent = formatInteger(summary.forecast);
  byId("daysStat").textContent = `${summary.days_elapsed}/${summary.days_total}`;

  renderWebinarResult(summary.webinar_result || {});
  renderRisks(summary);
  renderLandingBreakdown(summary);
  renderChannels(summary);
  renderReports();
  renderLaunchForm();
  renderArchive();
  drawTrend(summary);
}

function renderDailyPlanBadge(id, plan, hasData) {
  const el = byId(id);
  if (!el) return;
  if (!plan?.has_plan) {
    el.className = "metric-plan-badge neutral";
    el.innerHTML = "";
    return;
  }
  const direction = Number(plan.delta || 0) >= 0 ? "good" : "bad";
  const arrow = Number(plan.delta || 0) >= 0 ? "▲" : "▼";
  el.className = `metric-plan-badge ${direction}`;
  el.innerHTML = `
    <small>план ${formatInteger(plan.plan)}</small>
    <span>${arrow} ${hasData ? signedPercent(plan.delta_percent) : "нет факта"}</span>
  `;
}

function renderGauge(fact, plan) {
  const safePlan = Math.max(1, Number(plan || 0));
  const ratio = Math.max(0, Math.min(Number(fact || 0) / safePlan, 1));
  const angle = -90 + ratio * 180;
  const needle = byId("gaugeNeedle");
  needle.style.transform = `translate(-50%, -100%) rotate(${angle}deg)`;
  needle.classList.toggle("risk", ratio < 0.5);
  needle.classList.toggle("watch", ratio >= 0.5 && ratio < 0.85);
  needle.classList.toggle("good", ratio >= 0.85);
  byId("gaugeFactValue").textContent = formatInteger(fact);
  byId("gaugeFactCaption").textContent = `${percent(ratio)} от плана`;
  byId("gaugePlanValue").textContent = `план ${formatInteger(plan)}`;
}

function renderRisks(summary) {
  byId("riskList").innerHTML = summary.risks
    .map((risk) => `<div class="risk-item ${risk.includes("нет") ? "good" : risk.includes("ниже") || risk.includes("недостаточно") ? "bad" : ""}">${escapeHtml(risk)}</div>`)
    .join("");
}

function renderWebinarResult(result) {
  const hasData = result.has_data;
  const rows = [
    ["Кол-во регистраций", result.registration_plan, result.registrations, "number"],
    ["Уникальные регистрации", result.unique_registration_plan, result.unique_registrations, "number"],
    ["Посетители", result.visitor_plan, result.visitors, "number"],
    ["CR регистрация → посетитель", 0.5, result.conversion_registration_to_visitor, "percent"],
    ["CR посетитель → заявка конс.", 0.1, result.conversion_participant_to_request, "percent"],
    ["Заявки на консультацию", result.consultation_request_plan, result.consultation_requests, "number"],
    ["CR посетитель → заказ", 0.05, result.conversion_visitor_to_order, "percent"],
    ["Заказы", result.order_plan, result.orders, "number"],
    ["CR посетитель → был более 30 мин", 0.75, result.conversion_visitor_to_lead, "percent"],
    ["Лиды", result.lead_plan, result.leads, "number"],
    ["CR заявка конс. → оплата", 0.2, result.conversion_request_to_payment, "percent"],
    ["Оплаты: заявка конс.", result.paid_consultation_plan, result.paid_consultations, "number"],
    ["CR заказ → оплата", 0.4, result.conversion_order_to_payment, "percent"],
    ["Оплаты: заказы", result.paid_order_plan, result.paid_orders, "number"],
    ["CR лид → оплата", 0.05, result.conversion_lead_to_payment, "percent"],
    ["Оплаты: лид", result.paid_lead_plan, result.paid_leads, "number"],
    ["Оплат всего", result.total_payment_plan, result.total_payments, "number"],
    ["Средний чек", result.average_check_plan, result.average_check, "money"],
    ["Сумма заказов всего", result.total_order_amount_plan, result.total_order_amount, "money"],
  ];
  byId("webinarResultDashboard").innerHTML = hasData
    ? `
      <div class="webinar-result-table">
        <div class="webinar-result-head"><span>Показатель</span><span>План</span><span>Факт</span><span>Вып.</span></div>
        ${rows.map(([label, plan, fact, type]) => webinarResultRow(label, plan, fact, type)).join("")}
      </div>
    `
    : `<div class="empty-state">Итоги вебинара еще не внесены.</div>`;
}

function webinarValue(value, type) {
  if (type === "percent") return percent(value);
  if (type === "money") return `${formatInteger(value || 0)} ₽`;
  return formatInteger(value || 0);
}

function webinarResultRow(label, plan, fact, type) {
  const planNumber = Number(plan || 0);
  const factNumber = Number(fact || 0);
  const performance = planNumber ? factNumber / planNumber : 0;
  const state = !planNumber ? "neutral" : performance >= 1 ? "good" : performance >= 0.7 ? "watch" : "bad";
  return `
    <div class="webinar-result-row ${state}">
      <span>${escapeHtml(label)}</span>
      <b>${webinarValue(plan, type)}</b>
      <strong>${webinarValue(fact, type)}</strong>
      <em>${planNumber ? percent(performance) : "—"}</em>
    </div>
  `;
}

function renderLandingBreakdown(summary) {
  const items = summary.landing_totals || [];
  byId("landingBreakdown").innerHTML = items.length
    ? items
        .map(
          (page) => `
            <div class="landing-breakdown-card">
              <strong>${escapeHtml(page.name)}</strong>
              <span>${escapeHtml(page.segment || "Сегмент не указан")}</span>
              <div class="landing-breakdown-metrics">
                <div><small>Посетители</small><b>${formatInteger(page.visitors)}</b></div>
                <div><small>Регистрации</small><b>${formatInteger(page.registrations)}</b></div>
                <div><small>Конверсия</small><b>${percent(page.conversion)}</b></div>
              </div>
            </div>
          `,
        )
        .join("")
    : `<div class="empty-state">Посадочные страницы еще не настроены.</div>`;
}

function renderChannels(summary) {
  const yesterdayItems = summary.content_yesterday || [];
  const totalItems = summary.content_totals || summary.channels || [];
  const dailyMode = summary.yesterday?.mode || (summary.launch?.computed_status === "archived" ? "final" : "yesterday");
  const snapshotItems = dailyMode === "final" ? totalItems : yesterdayItems;
  if (!snapshotItems.length && !totalItems.length) {
    byId("channelList").innerHTML = `<div class="empty-state">Контент по каналам еще не внесен.</div>`;
    return;
  }
  byId("channelList").innerHTML = `
    <div class="content-summary-section">
      <h3>${dailyMode === "final" ? "Финальный срез" : "За вчера"}</h3>
      ${
        snapshotItems.length
          ? snapshotItems.map((item) => contentSummaryRow(item, dailyMode === "final" ? "total" : "day")).join("")
          : `<div class="empty-state">${dailyMode === "final" ? "В финальном срезе публикации не внесены." : "За вчера публикации еще не внесены."}</div>`
      }
    </div>
    <div class="content-summary-section">
      <h3>Итого</h3>
      ${
        totalItems.length
          ? totalItems.map((item) => contentSummaryRow(item, "total")).join("")
          : `<div class="empty-state">Нарастающий итог пока пустой.</div>`
      }
    </div>
  `;
}

function contentSummaryRow(item, mode) {
  const count = Number(item.content_count || 0);
  const meta =
    mode === "total"
      ? `${formatInteger(count)} ед. · ${formatInteger(item.days || 0)} дн.`
      : `${formatInteger(count)} ед. за день`;
  const detail = mode === "total" ? item.items?.slice(-2).join(" / ") : item.items;
  return `
    <div class="content-summary-row">
      <div>
        <strong>${escapeHtml(item.channel)}</strong>
        <span>${escapeHtml(detail || "выход отмечен")}</span>
      </div>
      <b>${escapeHtml(meta)}</b>
    </div>
  `;
}

function drawTrend(summary) {
  const reports = buildLaunchDays(summary);
  const canvas = byId("trendCanvas");
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, width, height);

  const maxCount = Math.max(...reports.flatMap((report) => [report.visits, report.site_visitors, report.registrations]), 1);
  const left = 44;
  const top = 64;
  const bottom = height - 72;
  const right = width - 28;
  const chartHeight = bottom - top;
  const groupWidth = (right - left) / Math.max(1, reports.length);

  ctx.strokeStyle = "#d9e0e7";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = top + (chartHeight / 4) * i;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
  }
  const legend = [
    ["#2364aa", "Посетители посадочных"],
    ["#167a55", "Регистрации"],
    ["#a36f00", "Конверсия посадочной страницы"],
  ];
  let legendX = left;
  ctx.font = "800 13px Arial";
  legend.forEach(([color, label]) => {
    ctx.fillStyle = color;
    ctx.fillRect(legendX, 20, 12, 12);
    ctx.fillStyle = "#17202a";
    ctx.fillText(label, legendX + 18, 31);
    legendX += ctx.measureText(label).width + 42;
  });

  reports.forEach((report, index) => {
    const x = left + index * groupWidth + groupWidth * 0.08;
    const barWidth = Math.max(7, Math.min(22, groupWidth * 0.16));
    const gap = Math.max(3, Math.min(6, groupWidth * 0.04));
    const conversion = report.site_visitors ? report.registrations / report.site_visitors : 0;
    const values = [
      [report.visits, "#2364aa", "count"],
      [report.registrations, "#167a55", "count"],
      [conversion, "#a36f00", "percent"],
    ];
    values.forEach(([value, color, type], offset) => {
      const barHeight = type === "percent" ? value * chartHeight : (value / maxCount) * chartHeight;
      const barX = x + offset * (barWidth + gap);
      const label = type === "percent" ? (value ? `${Math.round(value * 100)}%` : "") : value ? formatInteger(value) : "";
      ctx.fillStyle = color;
      if (barHeight > 0) {
        ctx.fillRect(barX, bottom - barHeight, barWidth, barHeight);
        ctx.fillStyle = "#17202a";
        ctx.font = "800 10px Arial";
        ctx.textAlign = "center";
        ctx.fillText(label, barX + barWidth / 2, Math.max(top + 10, bottom - barHeight - 7));
      } else {
        ctx.strokeStyle = "#c8d3de";
        ctx.beginPath();
        ctx.moveTo(barX, bottom);
        ctx.lineTo(barX + barWidth, bottom);
        ctx.stroke();
      }
    });
    ctx.fillStyle = "#66727f";
    ctx.font = "700 12px Arial";
    ctx.textAlign = "center";
    ctx.fillText(formatDateShort(report.report_date), x + (barWidth + gap) * 1.7, bottom + 24);
    ctx.fillStyle = report.is_empty ? "#98a3ae" : "#66727f";
    ctx.font = "700 10px Arial";
    ctx.fillText(report.is_empty ? "нет данных" : `день ${report.launch_day}`, x + (barWidth + gap) * 1.7, bottom + 42);
  });
  ctx.textAlign = "left";
}

function renderLaunchForm() {
  const launch = state.summary?.launch;
  if (!launch) return;
  const form = byId("launchForm");
  renderReferenceOptions();
  form.elements.id.value = launch.id;
  form.elements.title.value = launch.title;
  form.elements.product_id.value = launch.product_id || "";
  form.elements.stream_id.value = launch.stream_id || "";
  form.elements.webinar_date.value = launch.webinar_date;
  form.elements.start_date.value = launch.start_date;
  form.elements.end_date.value = launch.end_date;
  form.elements.registration_goal.value = formatInteger(launch.registration_goal);
  form.elements.visitor_goal.value = formatInteger(launch.visitor_goal || 0);
  renderLandingPagesConfig(state.summary.landing_pages || []);
  renderLandingReportInputs(state.summary.landing_pages || []);
  renderContentPublicationInputs();
  renderWebinarResultForm(state.summary.webinar_result || {});
  byId("reportForm").elements.report_date.value ||= yesterdayDateValue();
  const archived = launch.computed_status === "archived";
  form.querySelectorAll("input, select, button").forEach((field) => {
    if (field.id === "newLaunchButton") return;
    field.disabled = archived;
  });
  byId("reportForm").querySelectorAll("input, textarea, button").forEach((field) => {
    field.disabled = archived;
  });
}

function renderWebinarResultForm(result) {
  const form = byId("webinarResultForm");
  if (!form) return;
  [
    "registration_plan",
    "registrations",
    "unique_registration_plan",
    "unique_registrations",
    "visitor_plan",
    "visitors",
    "qualified_leads",
    "unique_participants",
    "peak_participants",
    "over_30m_participants",
    "consultation_request_plan",
    "consultation_requests",
    "order_plan",
    "orders",
    "unpaid_orders",
    "prepay_clicks",
    "lead_plan",
    "leads",
    "paid_consultation_plan",
    "paid_consultations",
    "paid_order_plan",
    "paid_orders",
    "paid_lead_plan",
    "paid_leads",
    "total_payment_plan",
    "total_payments",
    "average_check_plan",
    "average_check",
    "total_order_amount_plan",
    "total_order_amount",
  ].forEach((name) => {
    form.elements[name].value = formatInteger(result[name] || 0);
  });
  bindFormattedNumberInputs(form);
}

function renderReferenceOptions() {
  const productSelect = byId("launchForm").elements.product_id;
  const streamSelect = byId("launchForm").elements.stream_id;
  productSelect.innerHTML = `<option value="">Выберите продукт</option>${state.references.products
    .map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`)
    .join("")}`;
  streamSelect.innerHTML = `<option value="">Выберите поток</option>${state.references.streams
    .map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`)
    .join("")}`;
}

function renderReferenceLists() {
  const productsList = byId("productsReferenceList");
  const streamsList = byId("streamsReferenceList");
  if (productsList) {
    productsList.innerHTML = state.references.products.length
      ? state.references.products.map((item) => `<span>${escapeHtml(item.name)}</span>`).join("")
      : `<em>Пока нет продуктов</em>`;
  }
  if (streamsList) {
    streamsList.innerHTML = state.references.streams.length
      ? state.references.streams.map((item) => `<span>${escapeHtml(item.name)}</span>`).join("")
      : `<em>Пока нет потоков</em>`;
  }
}

function clearLaunchFormForNew() {
  const form = byId("launchForm");
  form.reset();
  renderReferenceOptions();
  form.elements.id.value = "";
  form.elements.registration_goal.value = "0";
  form.elements.visitor_goal.value = "0";
  renderLandingPagesConfig([{ id: "", name: "Посадочная 1", segment: "" }, { id: "", name: "Посадочная 2", segment: "" }]);
  renderLandingReportInputs([]);
  form.querySelectorAll("input, select, button").forEach((field) => {
    field.disabled = false;
  });
  byId("reportForm").querySelectorAll("input, textarea, button").forEach((field) => {
    field.disabled = true;
  });
  toast("Заполните карточку нового вебинара и сохраните запуск");
}

function landingPagesPayload() {
  return [...document.querySelectorAll(".landing-config-row")]
    .map((row) => ({
      id: row.dataset.id || "",
      name: row.querySelector('[data-landing-field="name"]').value,
      segment: row.querySelector('[data-landing-field="segment"]').value,
    }))
    .filter((page) => page.name.trim());
}

function renderLandingPagesConfig(pages) {
  const list = byId("landingPagesConfig");
  const data = pages.length ? pages : [{ id: "", name: "Основная посадочная", segment: "Общий трафик" }];
  list.innerHTML = data
    .map(
      (page) => `
        <div class="landing-config-row" data-id="${escapeHtml(page.id || "")}">
          <label>Название <textarea data-landing-field="name" rows="2" required>${escapeHtml(page.name || "")}</textarea></label>
          <label>Сегмент / канал <textarea data-landing-field="segment" rows="2" placeholder="Например, Telegram / предприниматели">${escapeHtml(page.segment || "")}</textarea></label>
          <button class="danger-action" data-remove-landing type="button">Удалить</button>
        </div>
      `,
    )
    .join("");
  list.querySelectorAll("[data-remove-landing]").forEach((button) => {
    button.addEventListener("click", () => {
      if (list.querySelectorAll(".landing-config-row").length <= 1) {
        toast("Нужна хотя бы одна посадочная");
        return;
      }
      button.closest(".landing-config-row").remove();
    });
  });
}

function renderLandingReportInputs(pages, report = null) {
  const list = byId("landingReportInputs");
  if (!pages.length) {
    list.innerHTML = `<div class="empty-state">Сначала настройте посадочные страницы в карточке вебинара.</div>`;
    return;
  }
  list.innerHTML = pages
    .map((page) => {
      const detail = report?.landing_pages?.find((item) => Number(item.id) === Number(page.id));
      return `
        <div class="landing-report-card" data-id="${page.id}">
          <strong>${escapeHtml(page.name)}</strong>
          <span>${escapeHtml(page.segment || "Сегмент не указан")}</span>
          <div class="landing-report-grid">
            <label>Посетители <input data-landing-report="visitors" type="text" inputmode="numeric" data-format-number value="${formatInteger(detail?.visitors || 0)}" required /></label>
            <label>Регистрации <input data-landing-report="registrations" type="text" inputmode="numeric" data-format-number value="${formatInteger(detail?.registrations || 0)}" required /></label>
          </div>
        </div>
      `;
    })
    .join("");
  bindFormattedNumberInputs(list);
}

function landingReportPayload() {
  return [...document.querySelectorAll(".landing-report-card")].map((card) => ({
    id: card.dataset.id,
    visitors: normalizeNumber(card.querySelector('[data-landing-report="visitors"]').value) || "0",
    registrations: normalizeNumber(card.querySelector('[data-landing-report="registrations"]').value) || "0",
  }));
}

function renderContentPublicationInputs(items = null) {
  const list = byId("contentPublicationInputs");
  const data =
    items && items.length
      ? items
      : defaultContentChannels.slice(0, 3).map((channel) => ({ channel, content_count: 0, items: "" }));
  list.innerHTML = data
    .map(
      (item) => `
        <div class="content-publication-row">
          <label>Канал
            <input data-content-field="channel" list="contentChannelOptions" value="${escapeHtml(item.channel || "")}" placeholder="Например, Instagram" required />
          </label>
          <label>Единиц
            <input data-content-field="content_count" type="text" inputmode="numeric" data-format-number value="${formatInteger(item.content_count || 0)}" required />
          </label>
          <label>Что опубликовано
            <textarea data-content-field="items" rows="2" placeholder="Например, закреп, карусель, сторис">${escapeHtml(item.items || "")}</textarea>
          </label>
          <button class="danger-action" data-remove-content type="button">Удалить</button>
        </div>
      `,
    )
    .join("");
  list.querySelectorAll("[data-remove-content]").forEach((button) => {
    button.addEventListener("click", () => {
      if (list.querySelectorAll(".content-publication-row").length <= 1) {
        toast("Нужна хотя бы одна строка контента");
        return;
      }
      button.closest(".content-publication-row").remove();
    });
  });
  bindFormattedNumberInputs(list);
}

function contentPublicationsPayload() {
  return [...document.querySelectorAll(".content-publication-row")]
    .map((row) => ({
      channel: row.querySelector('[data-content-field="channel"]').value.trim(),
      content_count: normalizeNumber(row.querySelector('[data-content-field="content_count"]').value) || "0",
      items: row.querySelector('[data-content-field="items"]').value.trim(),
    }))
    .filter((item) => item.channel && (Number(item.content_count) > 0 || item.items));
}

function renderReports() {
  const reports = state.summary ? buildLaunchDays(state.summary) : [];
  const archived = state.summary?.launch?.computed_status === "archived";
  const list = byId("reportsList");
  if (!reports.length) {
    list.innerHTML = `<div class="empty-state">Данные по дням еще не внесены.</div>`;
    return;
  }
  list.innerHTML = reports
    .map(
      (report) => `
        <div class="report-row">
          <div>
            <strong>${escapeHtml(formatDateShort(report.report_date))} · День ${report.launch_day}</strong>
            <span>${
              report.is_empty
                ? "Данные за день еще не внесены"
                : `Посетители посадочных ${formatInteger(report.visits)} · регистрации ${formatInteger(report.registrations)} · конверсия ${percent(report.site_visitors ? report.registrations / report.site_visitors : 0)}`
            }</span>
          </div>
          <button class="secondary-action" data-edit-report="${escapeHtml(report.report_date)}" type="button" ${archived ? "disabled" : ""}>${
            archived ? (report.is_empty ? "Не внесено" : "Зафиксировано") : report.is_empty ? "Заполнить" : "Изменить"
          }</button>
        </div>
      `,
    )
    .join("");
  document.querySelectorAll("[data-edit-report]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.disabled) return;
      const report = reports.find((item) => item.report_date === button.dataset.editReport);
      if (!report) return;
      const form = byId("reportForm");
      byId("reportFormError").textContent = "";
      form.elements.report_date.value = report.report_date;
      renderLandingReportInputs(state.summary.landing_pages || [], report);
      renderContentPublicationInputs(report.channels);
      form.elements.notes.value = report.notes || "";
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
          ${String(user.id) === String(state.user.id) ? "" : `<button class="danger-action" data-delete-user="${user.id}" type="button">Удалить</button>`}
        </div>
      `,
    )
    .join("");
  document.querySelectorAll("[data-delete-user]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api(`/api/users/${button.dataset.deleteUser}`, { method: "DELETE" });
      toast("Пользователь удален");
      await loadData();
    });
  });
}

function renderArchive() {
  renderArchiveFilters();
  const filters = {
    year: byId("archiveYearFilter").value,
    month: byId("archiveMonthFilter").value,
    product: byId("archiveProductFilter").value,
    stream: byId("archiveStreamFilter").value,
  };
  const items = (state.archivedLaunches || []).filter((launch) => {
    const [year, month] = String(launch.webinar_date || "").split("-");
    if (filters.year && year !== filters.year) return false;
    if (filters.month && month !== filters.month) return false;
    if (filters.product && String(launch.product_id) !== filters.product) return false;
    if (filters.stream && String(launch.stream_id) !== filters.stream) return false;
    return true;
  });
  byId("archiveList").innerHTML = items.length
    ? items
        .map(
          (launch) => `
            <article class="archive-card">
              <strong>${escapeHtml(launch.title)}</strong>
              <span>${escapeHtml(launchLabel(launch))}</span>
              <span>Вебинар ${formatDateShort(launch.webinar_date)}</span>
              <button class="secondary-action" data-open-archive="${launch.id}" type="button">Открыть дашборд</button>
            </article>
          `,
        )
        .join("")
    : `<div class="empty-state">Архивных вебинаров по выбранным фильтрам нет.</div>`;
  document.querySelectorAll("[data-open-archive]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.launchId = button.dataset.openArchive;
      await loadData();
      setView("dashboardView");
    });
  });
}

function renderArchiveFilters() {
  const years = [...new Set((state.archivedLaunches || []).map((launch) => String(launch.webinar_date || "").slice(0, 4)).filter(Boolean))].sort().reverse();
  const months = [
    ["01", "Январь"],
    ["02", "Февраль"],
    ["03", "Март"],
    ["04", "Апрель"],
    ["05", "Май"],
    ["06", "Июнь"],
    ["07", "Июль"],
    ["08", "Август"],
    ["09", "Сентябрь"],
    ["10", "Октябрь"],
    ["11", "Ноябрь"],
    ["12", "Декабрь"],
  ];
  fillFilter("archiveYearFilter", [["", "Все годы"], ...years.map((year) => [year, year])]);
  fillFilter("archiveMonthFilter", [["", "Все месяцы"], ...months]);
  fillFilter("archiveProductFilter", [["", "Все продукты"], ...state.references.products.map((item) => [String(item.id), item.name])]);
  fillFilter("archiveStreamFilter", [["", "Все потоки"], ...state.references.streams.map((item) => [String(item.id), item.name])]);
}

function fillFilter(id, options) {
  const select = byId(id);
  const current = select.value;
  select.innerHTML = options.map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join("");
  if (options.some(([value]) => value === current)) select.value = current;
}

async function loadData() {
  const suffix = state.launchId ? `?launch_id=${encodeURIComponent(state.launchId)}` : "";
  const data = await api(`/api/bootstrap${suffix}`);
  state.user = data.user;
  state.summary = data.summary;
  state.launches = data.launches || [];
  state.activeLaunches = data.active_launches || [];
  state.archivedLaunches = data.archived_launches || [];
  state.references = data.references || { products: [], streams: [] };
  state.users = data.users || [];
  state.launchId = state.summary?.launch?.id || null;
  renderShell();
  renderDashboard();
  renderReferenceLists();
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
    await api("/api/auth/login", { method: "POST", body: JSON.stringify({ login: form.get("login"), password: form.get("password") }) });
    await init();
  } catch (error) {
    byId("loginError").textContent = error.message;
  }
});

byId("logoutButton").addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST", body: "{}" });
  window.location.reload();
});

byId("launchForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = { ...formPayload(event.currentTarget), landing_pages: landingPagesPayload(), baseline_registrations: "0", current_registrations: "0" };
  const response = await api("/api/launch", { method: "POST", body: JSON.stringify(payload) });
  state.launchId = response.id;
  toast("Параметры запуска сохранены");
  await loadData();
});

byId("newLaunchButton").addEventListener("click", clearLaunchFormForNew);

byId("addLandingPageButton").addEventListener("click", () => {
  const rows = [...document.querySelectorAll(".landing-config-row")];
  renderLandingPagesConfig([...landingPagesPayload(), { id: "", name: `Посадочная ${rows.length + 1}`, segment: "" }]);
});

byId("addContentChannelButton").addEventListener("click", () => {
  renderContentPublicationInputs([...contentPublicationsPayload(), { channel: "", content_count: 0, items: "" }]);
});

byId("reportForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  byId("reportFormError").textContent = "";
  const payload = formPayload(event.currentTarget);
  payload.launch_id = state.summary.launch.id;
  payload.landing_pages = landingReportPayload();
  payload.channels = contentPublicationsPayload();
  try {
    await api("/api/reports", { method: "POST", body: JSON.stringify(payload) });
    event.currentTarget.reset();
    renderContentPublicationInputs();
    toast(`Данные за ${formatDateShort(payload.report_date)} сохранены`);
    await loadData();
    setView("inputView");
  } catch (error) {
    byId("reportFormError").textContent = error.message;
  }
});

byId("webinarResultForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  byId("webinarResultFormError").textContent = "";
  const payload = formPayload(event.currentTarget);
  payload.launch_id = state.summary.launch.id;
  try {
    await api("/api/webinar-result", { method: "POST", body: JSON.stringify(payload) });
    toast("Итоги вебинара сохранены");
    await loadData();
    setView("inputView");
  } catch (error) {
    byId("webinarResultFormError").textContent = error.message;
  }
});

byId("productForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  await submitReferenceForm(event.currentTarget, "products", "productFormError", "Продукт");
});

byId("streamForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  await submitReferenceForm(event.currentTarget, "streams", "streamFormError", "Поток");
});

async function submitReferenceForm(form, type, errorId, label) {
  const error = byId(errorId);
  error.textContent = "";
  const name = new FormData(form).get("name");
  try {
    const result = await api("/api/references", { method: "POST", body: JSON.stringify({ type, name }) });
    form.reset();
    toast(result.created ? `${label} добавлен` : `${label} уже есть в справочнике`);
    await loadData();
    setView("referencesView");
  } catch (err) {
    error.textContent = err.message;
  }
}

["archiveYearFilter", "archiveMonthFilter", "archiveProductFilter", "archiveStreamFilter"].forEach((id) => {
  byId(id).addEventListener("change", renderArchive);
});

byId("userForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  byId("userFormError").textContent = "";
  try {
    await api("/api/users", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget).entries())) });
    event.currentTarget.reset();
    toast("Пользователь создан");
    await loadData();
  } catch (error) {
    byId("userFormError").textContent = error.message;
  }
});

init().catch((error) => {
  byId("loginError").textContent = error.message;
  byId("loginScreen").classList.remove("hidden");
});

bindFormattedNumberInputs();
