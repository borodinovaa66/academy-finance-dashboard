const byId = (id) => document.getElementById(id);

const priorityNames = new Set([
  "Выручка всего, руб",
  "Всего продаж",
  "Уникальные регистрации",
  "Платные заявки",
  "Новых договоров на сумму",
  "Денег в кассе",
]);

async function api(url) {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) throw data;
  return data;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function statusClass(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized.includes("крас")) return "red";
  if (normalized.includes("желт")) return "amber";
  if (normalized.includes("зелен")) return "green";
  if (normalized.includes("ошиб")) return "error";
  return "muted";
}

function formatNumberWithSpaces(number, fractionDigits = 0) {
  return number.toLocaleString("ru-RU", {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
  });
}

function displayValue(value, type = "") {
  if (value === null || value === undefined || value === "") return "нет данных";
  const number = parseMetricNumber(value);
  if (number === null) return String(value);
  if (String(value).includes("%") || (Math.abs(number) > 0 && Math.abs(number) < 1 && type !== "количество")) {
    return `${Math.round(number * 100)}%`;
  }
  if (type === "деньги" || Math.abs(number) >= 1000) return formatNumberWithSpaces(number);
  if (!Number.isInteger(number)) return formatNumberWithSpaces(number, 2).replace(/,?0+$/, "");
  return formatNumberWithSpaces(number);
}

function parseMetricNumber(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const hasPercent = text.includes("%");
  const normalized = text
    .replace(/\s+/g, "")
    .replace(/[₽р.$]/gi, "")
    .replace("%", "")
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");
  if (!normalized || normalized === "-" || normalized === "." || normalized === "-.") return null;
  const number = Number(normalized);
  if (!Number.isFinite(number)) return null;
  return hasPercent ? number / 100 : number;
}

function shortNumber(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "0";
  const abs = Math.abs(number);
  if (abs >= 1000000) return `${(number / 1000000).toFixed(abs >= 10000000 ? 0 : 1).replace(".", ",")} млн`;
  if (abs >= 1000) return `${(number / 1000).toFixed(abs >= 10000 ? 0 : 1).replace(".", ",")} тыс`;
  return `${Math.round(number)}`;
}

function executionRatio(item) {
  const plan = parseMetricNumber(item.plan);
  const fact = parseMetricNumber(item.fact);
  if (plan === null || fact === null || plan === 0) return null;
  return fact / plan;
}

function executionPercent(item) {
  const ratio = executionRatio(item);
  if (ratio === null) return "нет данных";
  return `${(ratio * 100).toFixed(0).replace(".", ",")}%`;
}

function executionStatus(item) {
  const ratio = executionRatio(item);
  if (ratio === null) return "нет данных";
  return ratio >= 0.95 ? "зеленый" : "красный";
}

function getKpi(data, name) {
  return data.kpis.find((item) => item.name === name);
}

function renderGauge(item) {
  const ratio = item ? executionRatio(item) : null;
  const safeRatio = Math.max(0, Math.min(ratio ?? 0, 1));
  const angle = -90 + safeRatio * 180;
  const needle = byId("gaugeNeedle");
  needle.style.transform = `translate(-50%, -100%) rotate(${angle}deg)`;
  needle.classList.toggle("risk", ratio === null || ratio < 0.5);
  needle.classList.toggle("watch", ratio !== null && ratio >= 0.5 && ratio < 0.95);
  needle.classList.toggle("good", ratio !== null && ratio >= 0.95);
  byId("gaugeValue").textContent = ratio === null ? "нет данных" : `${Math.round(ratio * 100)}%`;
  byId("gaugeMeta").textContent = item ? `${displayValue(item.fact, item.type)} из ${displayValue(item.plan, item.type)}` : "нет данных";
  byId("gaugeCaption").textContent = item ? item.name : "Ключевой показатель не найден.";
}

function drawPlanFactChart(items) {
  const canvas = byId("planFactCanvas");
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, width, height);

  const data = items
    .map((item) => ({ item, ratio: item ? executionRatio(item) : null }))
    .filter((entry) => entry.item && entry.ratio !== null);

  if (!data.length) {
    ctx.fillStyle = "#66727f";
    ctx.font = "800 22px Arial";
    ctx.fillText("Нет данных для визуализации", 40, 90);
    return;
  }

  const left = 48;
  const right = width - 28;
  const top = 58;
  const bottom = height - 78;
  const chartHeight = bottom - top;
  const max = Math.max(1.05, ...data.map((entry) => entry.ratio), 0.95);

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
    ["#2364aa", "Выполнение"],
    ["#b93737", "ниже 95%"],
    ["#167a55", "95% и выше"],
  ];
  let legendX = left;
  ctx.font = "800 13px Arial";
  legend.forEach(([color, label]) => {
    ctx.fillStyle = color;
    ctx.fillRect(legendX, 18, 12, 12);
    ctx.fillStyle = "#17202a";
    ctx.fillText(label, legendX + 18, 29);
    legendX += ctx.measureText(label).width + 44;
  });

  const groupWidth = (right - left) / data.length;
  const targetY = bottom - (0.95 / max) * chartHeight;
  ctx.strokeStyle = "#b93737";
  ctx.setLineDash([7, 7]);
  ctx.beginPath();
  ctx.moveTo(left, targetY);
  ctx.lineTo(right, targetY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#b93737";
  ctx.font = "800 12px Arial";
  ctx.textAlign = "left";
  ctx.fillText("95%", right - 36, targetY - 8);

  data.forEach(({ item, ratio }, index) => {
    const x = left + index * groupWidth + groupWidth * 0.24;
    const barWidth = Math.max(28, Math.min(58, groupWidth * 0.34));
    const barHeight = Math.max(2, (ratio / max) * chartHeight);
    const color = ratio >= 0.95 ? "#167a55" : "#2364aa";
    ctx.fillStyle = color;
    ctx.fillRect(x, bottom - barHeight, barWidth, barHeight);
    ctx.fillStyle = ratio >= 0.95 ? "#167a55" : "#b93737";
    ctx.font = "800 12px Arial";
    ctx.textAlign = "center";
    ctx.fillText(`${Math.round(ratio * 100)}%`, x + barWidth / 2, Math.max(top + 12, bottom - barHeight - 8));

    const label = item.name.length > 18 ? `${item.name.slice(0, 17)}...` : item.name;
    ctx.fillStyle = "#66727f";
    ctx.font = "800 12px Arial";
    ctx.textAlign = "center";
    ctx.fillText(label, x + barWidth / 2, bottom + 26);
    ctx.fillStyle = "#17202a";
    ctx.fillText(`${shortNumber(parseMetricNumber(item.fact))}/${shortNumber(parseMetricNumber(item.plan))}`, x + barWidth / 2, bottom + 46);
  });
  ctx.textAlign = "left";
}

function metricCard(item) {
  const status = executionStatus(item);
  return `
    <article class="metric-card ${statusClass(status)}">
      <div class="metric-label">${escapeHtml(item.name)}</div>
      <div class="metric-value">${escapeHtml(displayValue(item.fact, item.type))}</div>
      <div class="metric-meta">план ${escapeHtml(displayValue(item.plan, item.type))}</div>
      <div class="metric-status ${statusClass(status)}">${escapeHtml(executionPercent(item))}</div>
    </article>
  `;
}

function metricRow(item) {
  const status = executionStatus(item);
  return `
    <div class="metric-row">
      <div>
        <strong>${escapeHtml(item.name)}</strong>
        <span>${escapeHtml(item.owner || "")}</span>
      </div>
      <b>${escapeHtml(displayValue(item.plan, item.type))}</b>
      <b>${escapeHtml(displayValue(item.fact, item.type))}</b>
      <b class="execution-pill ${statusClass(status)}">${escapeHtml(executionPercent(item))}</b>
      <p>${escapeHtml(item.comment || "")}</p>
    </div>
  `;
}

function compactRow(item) {
  const status = executionStatus(item);
  return `
    <div class="compact-row">
      <div>
        <strong>${escapeHtml(item.name)}</strong>
        <span>план ${escapeHtml(displayValue(item.plan, item.type))} · факт ${escapeHtml(displayValue(item.fact, item.type))} · выполнение ${escapeHtml(executionPercent(item))}</span>
      </div>
      <em class="${statusClass(status)}">${escapeHtml(status)}</em>
    </div>
  `;
}

function actionRow(item) {
  return `
    <article class="action-card">
      <div class="action-priority">${escapeHtml(item.priority)}</div>
      <div>
        <strong>${escapeHtml(item.problem || "Не заполнено")}</strong>
        <span>${escapeHtml(item.signal || "")}</span>
        <p>${escapeHtml(item.action || item.reason || "Нужно заполнить решение недели в таблице.")}</p>
        <small>${escapeHtml(item.owner || "")}${item.due ? ` · срок ${escapeHtml(item.due)}` : ""}</small>
      </div>
      <em class="${statusClass(item.status)}">${escapeHtml(item.status)}</em>
    </article>
  `;
}

function render(data) {
  byId("dashboard").classList.remove("hidden");
  byId("errorPanel").classList.add("hidden");
  byId("sourceLabel").textContent = data.meta.source;
  byId("periodLabel").textContent = `Месяц ${data.meta.period} · сервисный срез ${data.meta.productPeriod}`;
  byId("updatedAt").textContent = `обновлено ${data.meta.updatedAt || "нет данных"}`;
  const computedStatuses = data.kpis.map(executionStatus).filter((status) => status !== "нет данных");
  const overallStatus = computedStatuses.includes("красный") ? "красный" : computedStatuses.length ? "зеленый" : "нет данных";
  byId("overallStatus").textContent = overallStatus;
  byId("overallStatus").className = `status-badge ${statusClass(overallStatus)}`;

  const top = data.kpis.filter((item) => priorityNames.has(item.name)).slice(0, 6);
  byId("topKpiGrid").innerHTML = top.map(metricCard).join("");
  renderGauge(getKpi(data, "Выручка всего, руб"));
  drawPlanFactChart([...priorityNames].map((name) => getKpi(data, name)));
  byId("kpiTable").innerHTML = `
    <div class="metric-row header">
      <div>KPI</div><b>План</b><b>Факт</b><b>Выполнение</b><p>Комментарий</p>
    </div>
    ${data.kpis.map(metricRow).join("")}
  `;
  byId("productList").innerHTML = data.product.length ? data.product.map(compactRow).join("") : `<div class="empty-state">Нет данных по продукту и сервису.</div>`;
  byId("actionsList").innerHTML = data.actions.length ? data.actions.map(actionRow).join("") : `<div class="empty-state">Решения недели еще не заполнены.</div>`;
}

function showError(error) {
  byId("dashboard").classList.add("hidden");
  const panel = byId("errorPanel");
  panel.classList.remove("hidden");
  panel.innerHTML = `
    <h2>Данные из Google Sheets пока не подключены</h2>
    <p>${escapeHtml(error.error || "Не удалось загрузить данные.")}</p>
    ${error.setup ? `<pre>${escapeHtml(error.setup)}</pre>` : ""}
  `;
  byId("overallStatus").textContent = "нет подключения";
  byId("overallStatus").className = "status-badge red";
}

async function load(refresh = false) {
  try {
    const data = await api(`/api/dashboard${refresh ? "?refresh=1" : ""}`);
    render(data);
  } catch (error) {
    showError(error);
  }
}

byId("refreshButton").addEventListener("click", () => load(true));
load();
