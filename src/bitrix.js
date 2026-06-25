const APP_URL = process.env.APP_URL || "https://finance.academy-management.ru";

function normalizeWebhookUrl(url) {
  const clean = String(url || "").trim();
  if (!clean) return "";
  if (/\/im\.message\.add(?:\.json)?$/i.test(clean)) return clean;
  return `${clean.replace(/\/+$/, "")}/im.message.add`;
}

function isBitrixConfigured() {
  return Boolean(process.env.BITRIX_WEBHOOK_URL && process.env.BITRIX_DIALOG_ID);
}

function money(value) {
  const number = Number(value || 0);
  const sign = number < 0 ? "-" : "";
  const digits = String(Math.abs(Math.round(number)));
  return `${sign}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ")}`;
}

function formatDate(value) {
  if (!value) return "-";
  const [year, month, day] = String(value).split("-");
  if (!year || !month || !day) return String(value);
  return `${day}.${month}.${year}`;
}

function signedMoney(value) {
  return `${Number(value || 0) >= 0 ? "+" : ""}${money(value)}`;
}

function productLines(summary) {
  const items = (summary.product_totals || []).filter((item) => Number(item.amount || 0) > 0);
  if (!items.length) return "По продуктам: данных пока нет";
  return ["По продуктам:", ...items.map((item) => `- ${item.product_name}: ${money(item.amount)}`)].join("\n");
}

function buildDailySummaryMessage(summary) {
  const latest = summary.latest_entry;
  const dailyIncome = latest ? latest.client_income + latest.deposit_income : 0;
  const dailyExpense = latest ? latest.expense : 0;
  const dailyBalance = latest ? latest.cash_balance : summary.totals.cash_balance;

  return [
    "Ежедневный финансовый отчет",
    `Дата данных: ${formatDate(latest?.report_date || summary.totals.last_date)}`,
    "",
    "За день:",
    `- Поступления: ${money(dailyIncome)}`,
    `- Доход по депозитам: ${money(latest?.deposit_income || 0)}`,
    `- Расходы: ${money(dailyExpense)}`,
    `- Остаток на счетах: ${money(dailyBalance)}`,
    "",
    "Итого за месяц:",
    `- Поступления: ${money(summary.total_income)} / план ${money(summary.plan.client_income_plan)}`,
    `- Расходы: ${money(summary.totals.expense)} / план ${money(summary.plan.expense_plan)}`,
    `- ЧДП факт: ${signedMoney(summary.net_cash_flow)} / план ${money(summary.plan.net_cash_flow_plan)}`,
    `- Прогноз ЧДП: ${signedMoney(summary.net_cash_flow_forecast)}`,
    `- До плана ЧДП: ${signedMoney(summary.net_cash_flow_delta)}`,
    "",
    productLines(summary),
    "",
    `Дашборд: ${APP_URL}`,
  ].join("\n");
}

async function sendBitrixMessage(message) {
  if (!isBitrixConfigured()) return { skipped: true, reason: "Bitrix integration is not configured" };

  const payload = {
    DIALOG_ID: process.env.BITRIX_DIALOG_ID,
    MESSAGE: message,
    SYSTEM: process.env.BITRIX_SYSTEM_MESSAGE || "N",
    URL_PREVIEW: "N",
  };
  if (process.env.BITRIX_BOT_ID) payload.BOT_ID = Number(process.env.BITRIX_BOT_ID);
  if (process.env.BITRIX_CLIENT_ID) payload.CLIENT_ID = process.env.BITRIX_CLIENT_ID;

  const response = await fetch(normalizeWebhookUrl(process.env.BITRIX_WEBHOOK_URL), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    const messageText = data.error_description || data.error || `HTTP ${response.status}`;
    throw new Error(`Bitrix message failed: ${messageText}`);
  }
  return data;
}

async function sendDailySummaryToBitrix(summary) {
  return sendBitrixMessage(buildDailySummaryMessage(summary));
}

module.exports = {
  buildDailySummaryMessage,
  isBitrixConfigured,
  sendDailySummaryToBitrix,
};
