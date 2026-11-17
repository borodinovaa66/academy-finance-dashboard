const fs = require('node:fs');
const path = require('node:path');
const {generationFile,syncStatus}=require('./budget-generation');

function validateBudgetSnapshot(data) {
  if (data?.schemaVersion !== 1 || !data.months || typeof data.months !== 'object') throw new Error('Invalid budget schema');
  for (const [month, report] of Object.entries(data.months)) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Invalid budget month');
    const ids = new Set();
    function walk(node, depth = 0) {
      if (!node || depth > 12 || typeof node.id !== 'string' || typeof node.name !== 'string') throw new Error('Invalid budget node');
      if (ids.has(node.id)) throw new Error('Duplicate budget node ID');
      ids.add(node.id);
      if (node.amount === null) {
        if (!node.unknown || node.children?.length) throw new Error('Unknown amount must remain an explicit unknown leaf');
        return 0;
      }
      if (typeof node.amount !== 'number' || !Number.isFinite(node.amount) || node.amount < 0 || Math.abs(node.amount * 100 - Math.round(node.amount * 100)) > 0.0001) throw new Error('Invalid budget amount');
      if (node.source?.url) {
        let url;
        try { url = new URL(node.source.url); } catch { throw new Error('Invalid budget source URL'); }
        if (url.protocol !== 'https:' || !['docs.google.com', 'drive.google.com'].includes(url.hostname)) throw new Error('Unsafe budget source');
      }
      const amount = Math.round(node.amount * 100);
      if (node.children) {
        if (!Array.isArray(node.children)) throw new Error('Invalid budget children');
        const sum = node.children.reduce((total, child) => total + walk(child, depth + 1), 0);
        if (sum !== amount) throw new Error(`Budget sum mismatch at ${node.id}`);
      }
      return amount;
    }
    walk(report.income); walk(report.expense);
  }
  return data;
}

function readBudget(privateDir, month, role) {
  if (!['owner', 'accountant', 'viewer'].includes(role)) throw Object.assign(new Error('Недостаточно прав'), {statusCode: 403});
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw Object.assign(new Error('Некорректный месяц'), {statusCode: 400});
  const file = generationFile(privateDir, 'budget-explorer.json');
  if (!fs.existsSync(file)) return null;
  const report = validateBudgetSnapshot(JSON.parse(fs.readFileSync(file, 'utf8'))).months[month];
  if (!report) return null;
  function visible(node) {
    if (role !== 'owner' && node.personalDetail) {
      const {children, source, formula, ...aggregate} = node;
      return {...aggregate, restricted: true, detail: 'Персональная детализация доступна собственнику. В этом представлении показан итог группы.'};
    }
    return {...node, ...(node.children ? {children: node.children.map(visible)} : {})};
  }
  return {...report, month, income: visible(report.income), expense: visible(report.expense), personalDetailVisible: role === 'owner',sync:syncStatus(privateDir)};
}

function injectBudgetAssets(html) {
  if (html.includes('id="cabinet-budget-module"')) return html;
  return html.replace('</head>', '<link rel="stylesheet" href="/cabinet-budget.css?v=20261117-sync1"></head>')
    .replace('</body>', '<script id="cabinet-budget-module" src="/cabinet-budget.js?v=20261117-sync1"></script></body>');
}

module.exports = {validateBudgetSnapshot, readBudget, injectBudgetAssets};
