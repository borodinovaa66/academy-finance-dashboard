(() => {
  'use strict';
  const root = document.getElementById('finance-cabinet-v2');
  if (!root || document.getElementById('fc-budget')) return;
  const q = s => root.querySelector(s);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = n => n === null || n === undefined ? 'Не определено' : Number(n).toLocaleString('ru-RU', {maximumFractionDigits: 2}) + ' ₽';
  const percent = (n, total) => n === null || !total ? '—' : (n / total * 100).toLocaleString('ru-RU', {maximumFractionDigits: 2}) + '%';
  const palette = ['#2f6478','#7d9f93','#c2a36d','#8b86a7','#7093aa','#a77878','#a4ad76'];
  const labels = {plan:'План', estimate:'Расчётная оценка', reserve:'Условный резерв', prior_period:'Прошлый период', unknown:'Не определено'};
  let report = null, mode = 'expense', selected = 'expense', generation = 0;
  const tab = document.createElement('button');
  tab.type = 'button'; tab.className = 'fc-tab'; tab.id = 'fc-tab-budget'; tab.textContent = 'Бюджет'; tab.setAttribute('aria-selected','false');
  q('nav').append(tab);
  const section = document.createElement('section');
  section.id = 'fc-budget'; section.hidden = true; section.setAttribute('aria-labelledby','fc-tab-budget');
  section.innerHTML = `
    <div class="ov-heading"><div><p class="ov-eyebrow">ПЛАНИРОВАНИЕ</p><h2>Бюджет</h2><p class="ov-note">От крупных блоков до составляющих и исходных строк.</p></div><label class="be-month">Месяц<input id="budget-month" type="month" value="2026-11" min="2026-01"></label></div>
    <p id="budget-status" class="real-warning" role="status" aria-live="polite">Получение бюджета…</p>
    <p id="budget-sync-status" class="ov-note" role="status" aria-live="polite"></p>
    <div id="budget-content" hidden>
      <div class="be-kpis" id="budget-kpis"></div>
      <div class="be-controls"><div class="be-modes" role="group" aria-label="Часть бюджета"><button type="button" data-budget-mode="expense">Расходы</button><button type="button" data-budget-mode="income">Поступления</button></div><label class="be-scenario"><input type="checkbox" id="budget-include-prior" checked>Включать переходящие резервы прошлых периодов <strong id="budget-prior-amount"></strong></label></div>
      <p id="budget-scenario-note" class="ov-note"></p>
      <nav id="budget-crumbs" class="be-crumbs" aria-label="Уровни бюджета"></nav>
      <section class="ov-panel be-detail"><div class="ov-panel-head be-selection"><div><p class="ov-eyebrow" id="budget-level-label"></p><h2 id="budget-node-name"></h2><p id="budget-node-note" class="ov-note"></p></div><div class="be-selected-total"><strong id="budget-node-amount"></strong><small id="budget-node-share"></small></div></div>
        <div class="be-explore"><div id="budget-chart" class="be-chart"></div><div id="budget-children"></div></div>
        <div id="budget-source" class="be-source"></div>
      </section>
      <details class="ov-panel be-method"><summary>Допущения и недостающие данные</summary><ul id="budget-notes"></ul><div id="budget-gaps"></div></details>
      <details class="ov-panel be-method"><summary>Источники и дата версии</summary><p id="budget-version-note"></p><div id="budget-sources" class="be-source-links"></div></details>
    </div>`;
  q('main').append(section);
  const bq = s => section.querySelector(s);
  function show() {
    for (const child of q('main').children) if (child.tagName === 'SECTION') child.hidden = child !== section;
    for (const b of root.querySelectorAll('.fc-tab')) b.setAttribute('aria-selected', String(b === tab));
    for (const selector of ['.fc-meta','.fc-demo']) if (q(selector)) q(selector).hidden = true;
    section.hidden = false;
    if (location.hash !== '#budget') history.replaceState(null, '', '#budget');
    if (!report) load();
  }
  tab.addEventListener('click', show);
  // The existing cabinet owns its four screens. Do not alter its state or renderer.
  root.addEventListener('click', event => {
    const button = event.target.closest('button[data-screen]');
    if (button && button !== tab) {
      section.hidden = true; tab.setAttribute('aria-selected','false');
      history.replaceState(null, '', '#' + button.dataset.screen);
    }
  }, true);
  window.addEventListener('hashchange', () => {
    if (location.hash === '#budget') show();
    else if (!section.hidden) { const button = document.getElementById('fc-tab-' + location.hash.slice(1)); if (button && button !== tab) button.click(); }
  });
  function filtered(node) {
    if (!bq('#budget-include-prior').checked && node.priorPeriod) return null;
    if (!node.children) return {...node};
    const children = node.children.map(filtered).filter(Boolean);
    return {...node, children, amount: Math.round(children.reduce((s, child) => s + (child.amount ?? 0), 0) * 100) / 100};
  }
  function findPath(node, id, parents = []) {
    if (node.id === id) return [...parents, node];
    for (const child of node.children || []) { const result = findPath(child, id, [...parents, node]); if (result) return result; }
    return null;
  }
  function sourceLink(source) {
    if (!source?.url) return '';
    try { const url = new URL(source.url); if (url.protocol !== 'https:' || !['docs.google.com','drive.google.com'].includes(url.hostname)) return ''; } catch { return ''; }
    return `<a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.label || 'Исходная строка')} ↗</a>`;
  }
  const badge = node => node.status && labels[node.status] ? `<span class="be-badge be-${esc(node.status)}">${esc(labels[node.status])}</span>` : '';
  function renderChart(children, total) {
    const positive = children.filter(c => c.amount > 0);
    if (!positive.length || !total) { bq('#budget-chart').innerHTML = '<p class="ov-note">На этом уровне нет распределения для диаграммы.</p>'; return; }
    let offset = 0;
    const circles = positive.map((c,i) => {
      const length = c.amount / total * 100;
      const element = `<circle cx="100" cy="100" r="73" pathLength="100" fill="none" stroke="${palette[i % palette.length]}" stroke-width="23" stroke-dasharray="${length} ${100-length}" stroke-dashoffset="${-offset}" transform="rotate(-90 100 100)" data-budget-node="${esc(c.id)}" tabindex="0" role="button" aria-label="Открыть ${esc(c.name)}: ${esc(money(c.amount))}, ${percent(c.amount,total)}"><title>${esc(c.name)} · ${esc(money(c.amount))} · ${percent(c.amount,total)}</title></circle>`;
      offset += length; return element;
    }).join('');
    bq('#budget-chart').innerHTML = `<svg viewBox="0 0 200 200" class="be-donut" role="group" aria-label="Состав выбранного блока">${circles}<text x="100" y="97" text-anchor="middle" class="be-donut-number">100%</text><text x="100" y="117" text-anchor="middle" class="be-donut-label">этого уровня</text></svg><p class="ov-note">Нажми на долю или строку справа.</p>`;
  }
  function render() {
    if (!report) return;
    bq('#budget-content').hidden = false;
    const withPrior = bq('#budget-include-prior').checked;
    const income = report.income, expense = filtered(report.expense);
    const currentRoot = mode === 'expense' ? expense : income;
    let path = findPath(currentRoot, selected);
    if (!path) { selected = currentRoot.id; path = [currentRoot]; }
    const node = path.at(-1), children = node.children || [];
    bq('#budget-status').textContent = `${report.version} · ${report.asOf.split('-').reverse().join('.')} · проект, не окончательное утверждение`;
    const debt = income.children?.find(child => child.id === 'income-debt')?.amount;
    bq('#budget-prior-amount').textContent = money(report.priorPeriodReserve);
    bq('#budget-kpis').innerHTML = `<button type="button" class="be-kpi" data-budget-mode="income"><span>План поступлений</span><strong>${money(income.amount)}</strong><small>Включая сбор дебиторки ${money(debt)}</small></button><button type="button" class="be-kpi" data-budget-mode="expense"><span>${withPrior ? 'Проект с резервами' : 'Сценарий без прошлых периодов'}</span><strong>${money(expense.amount)}</strong><small>${withPrior ? 'Переходящие '+money(report.priorPeriodReserve)+' уже внутри' : 'Обязательства не отменены'}</small></button><button type="button" class="be-kpi be-kpi-muted" data-budget-select="pay-pending"><span>Условные вознаграждения</span><strong>${money(withPrior ? report.namedConditionalCompensation : report.namedConditionalCompensation-report.priorPeriodReserve)}</strong><small>Лимиты, не подтверждённый долг</small></button>`;
    bq('#budget-scenario-note').textContent = withPrior ? 'Общий проект включает условные суммы и прошлые периоды. Это не календарь оплат и не расчёт прибыли.' : 'Справочный сценарий: исключены '+money(report.priorPeriodReserve)+' прошлых периодов. Это не утверждённая экономия и не отмена обязательств; текущие резервы остаются.';
    section.querySelectorAll('[data-budget-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.budgetMode === mode)));
    bq('#budget-crumbs').innerHTML = path.map((n,i) => `<button type="button" data-budget-node="${esc(n.id)}" ${i===path.length-1?'aria-current="page"':''}>${esc(n.name)}</button>`).join('<span aria-hidden="true">›</span>');
    bq('#budget-level-label').textContent = mode === 'expense' ? 'СОСТАВ РАСХОДНОГО ПРОЕКТА' : 'СТРУКТУРА ПЛАНА ПОСТУПЛЕНИЙ';
    bq('#budget-node-name').textContent = node.name;
    bq('#budget-node-amount').textContent = money(node.amount);
    bq('#budget-node-share').textContent = `${percent(node.amount,currentRoot.amount)} ${mode==='expense'?'всего проекта расходов':'всех поступлений'}${path.length>1?' · '+percent(node.amount,path.at(-2).amount)+' родительского блока':''}`;
    bq('#budget-node-note').textContent = node.detail || (children.length ? 'Доли рассчитаны от суммы выбранного уровня. Каждый блок можно раскрыть.' : 'Последний доступный уровень. Основание и допущения показаны ниже.');
    renderChart(children, node.amount);
    bq('#budget-children').innerHTML = children.length ? `<div class="be-table-head"><span>Состав</span><span>Сумма / доля</span></div><div class="be-rows">${children.map((child,i) => `<button type="button" class="be-row" data-budget-node="${esc(child.id)}"><span class="be-row-name"><i style="background:${palette[i%palette.length]}"></i><span>${esc(child.name)} ${badge(child)}<small>${child.restricted?'Персональная детализация ограничена':child.children?.length?child.children.length+' составляющих':'Исходная строка'}</small></span></span><span class="be-row-value"><strong>${money(child.amount)}</strong><small>${percent(child.amount,node.amount)} этого уровня <b aria-hidden="true">→</b></small></span><span class="be-share-bar" style="width:${child.amount===null||!node.amount?0:child.amount/node.amount*100}%"></span></button>`).join('')}</div>` : `<div class="be-leaf"><span class="be-leaf-icon" aria-hidden="true">✓</span><h3>${node.restricted?'Показан итог группы':'Последний уровень'}</h3><p>${node.restricted?'Индивидуальные суммы доступны в роли собственника.':'Эта сумма входит в родительский блок один раз. Источник можно открыть ниже.'}</p></div>`;
    bq('#budget-source').innerHTML = `${badge(node)}${node.formula?'<p><strong>Расчёт:</strong> '+esc(node.formula)+'</p>':''}${node.code?'<p>Код бюджета: '+esc(node.code)+'</p>':''}${node.source?sourceLink(node.source):sourceLink(report.sources?.[0])}${node.source?.cell?'<small>'+esc(node.source.cell)+'</small>':''}`;
    bq('#budget-notes').innerHTML = report.notes.map(note => '<li>'+esc(note)+'</li>').join('');
    bq('#budget-gaps').innerHTML = (report.gaps || []).map(gap => `<p><strong>${esc(gap.name)} — не определено.</strong> ${esc(gap.detail)}</p>`).join('');
    const sync=report.sync||{},date=value=>value?new Date(value).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})+' МСК':'ещё нет';
    const stale=!sync.lastSuccessAt||sync.stale===true;
    const errors={GOOGLE_ACCESS_DENIED:'нужно восстановить доступ учётной записи синхронизации',SOURCE_EDIT_IN_PROGRESS:'таблица менялась во время чтения',SHEET_ERROR:'в исходной таблице есть ошибка формулы',SOURCE_TOTAL_MISMATCH:'не сходятся итоги исходного бюджета',BLOCK_TOTAL_MISMATCH:'не сходятся суммы блоков',SOURCE_SCHEMA_CHANGED:'изменена структура исходной таблицы'};
    bq('#budget-sync-status').textContent=sync.state==='not_configured'?'Показана сохранённая версия; серверная синхронизация ещё не подключена.':sync.state==='error'||stale?`Показана последняя проверенная версия. ${errors[sync.errorCode]||'Обновление источника временно не подтверждено'}. Успешная проверка: ${date(sync.lastSuccessAt)}.`:`Синхронизация Google: ежедневно в 09:00 и 16:00 МСК · проверено ${date(sync.lastSuccessAt)} · следующая проверка ${date(sync.nextCheckAt)}.`;
    bq('#budget-version-note').textContent = `Версия источников на ${report.asOf.split('-').reverse().join('.')}. Опубликована ${date(sync.publishedAt)}. ${report.personalDetailVisible?'Персональные строки доступны в твоей роли собственника.':'Доступны агрегаты; персональные зарплаты скрыты.'}`;
    bq('#budget-sources').innerHTML = (report.sources || []).map(sourceLink).join('');
  }
  section.addEventListener('click', event => {
    const modeButton = event.target.closest('[data-budget-mode]');
    if (modeButton) { mode = modeButton.dataset.budgetMode; selected = mode; render(); return; }
    const pending = event.target.closest('[data-budget-select]');
    if (pending) { mode = 'expense'; selected = pending.dataset.budgetSelect; render(); return; }
    const node = event.target.closest('[data-budget-node]');
    if (node) { selected = node.dataset.budgetNode; render(); bq('#budget-node-name').scrollIntoView({block:'nearest'}); }
  });
  section.addEventListener('keydown', event => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('circle[data-budget-node]')) { event.preventDefault(); event.target.dispatchEvent(new MouseEvent('click',{bubbles:true})); }
  });
  bq('#budget-include-prior').addEventListener('change', render);
  bq('#budget-month').addEventListener('change', () => load());
  async function load(preserve=false) {
    const id = ++generation;
    if(!preserve){report = null; bq('#budget-content').hidden = true; bq('#budget-status').textContent = 'Получение бюджета…';}
    try {
      const response = await fetch('/api/cabinet/budget?month='+encodeURIComponent(bq('#budget-month').value),{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(15000)});
      if (response.status === 401) { location.replace('/'); return; }
      const payload = await response.json(); if (id !== generation) return;
      if (!response.ok) throw Error(payload.error || 'Не удалось прочитать источник');
      report = payload.budget;
      if (!report) { bq('#budget-content').hidden=true;bq('#budget-sync-status').textContent='';bq('#budget-status').textContent = 'Для выбранного месяца проверенный бюджет ещё не опубликован. Отсутствующие суммы не считаются нулевыми.'; return; }
      if(!preserve){mode = 'expense'; selected = 'expense';} render();
    } catch (error) { if (id === generation) {if(report)bq('#budget-sync-status').textContent='Не удалось проверить обновление страницы. Сохранена последняя загруженная версия; следующая проверка — через минуту.';else bq('#budget-status').textContent = 'Бюджет не загружен: '+error.message;} }
  }
  setInterval(()=>{if(!section.hidden&&!document.hidden)load(true);},60000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!section.hidden)load(true);});
  if (location.hash === '#budget') show();
})();
