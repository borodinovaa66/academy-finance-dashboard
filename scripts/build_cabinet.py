"""Add the daily report to the reviewed cabinet; output stays outside public/Git."""
from pathlib import Path
import argparse,re,json
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--source',type=Path,default=ROOT.parent/'finance-cabinet-overview-2026-11-15/index.html');args=p.parse_args()
html=args.source.read_text(encoding='utf-8')
assert 'REAL-OCTOBER-RECONCILIATION-2026-11-16' in html
# The monthly cash tab and daily tab must use the same reviewed budget version.
budget_path=ROOT/'private/cash-plan.json'
if budget_path.exists():
    budget=json.loads(budget_path.read_text(encoding='utf-8'))['months']['2026-11']
    assert sum(r['amount'] for r in budget['income']['rows'])==budget['income']['total']
    assert sum(r['amount'] for r in budget['expense']['blocks'])==budget['expense']['total']
    match=re.search(r'(<script[^>]*id="real-data"[^>]*>)(.*?)(</script>)',html,re.S)
    data=json.loads(match.group(2))
    data['budget']={'inflows':budget['income']['total'],'expenses':budget['expense']['total'],'conditionalDifference':None,
        'debtCollection':sum(r['amount'] for r in budget['income']['rows'] if r['kind']=='receivables'),
        'blocks':[{'label':r['name'],'amount':r['amount']} for r in budget['expense']['blocks']],
        'incomeRows':budget['income']['rows'],'status':budget['version']+' · не утверждён'}
    data['sources']['budget']['note']=budget['expense']['note']
    data['sources']['budget']['url']=budget['sourceUrl']
    html=html[:match.start(2)]+json.dumps(data,ensure_ascii=False,separators=(',',':')).replace('</','<\\/')+html[match.end(2):]
    html=html.replace("['Условная разница',D.budget.conditionalDifference]","['Сбор дебиторки',D.budget.debtCollection]")
    html=html.replace('Условная разница 6,187 млн ₽ не является прибылью или прогнозом остатка. В плане поступлений 3,500 млн ₽ сбора долгов; расходная база неполна.',
        'Проект v3 от 16.11: 7,194 млн ₽, включая условные прошлые периоды 472 тыс. ₽ и резерв УСН 530 тыс. ₽. Не утверждён; не денежный календарь и не прибыль. План поступлений включает 3,500 млн ₽ сбора дебиторки.')
    html=html.replace('Налоговые уточнения не прибавлены автоматически, чтобы не создать дубли. План не является фактом оплаты.',budget['expense']['note'])
policy="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'"
html=re.sub(r'<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>', '<meta http-equiv="Content-Security-Policy" content="'+policy+'">', html, count=1)
html=html.replace("['overview','pnl','cash']","['overview','pnl','cash','daily']")
html=html.replace('function screen(name,persist=true){state.screen=name;', 'function screen(name,persist=true){state.screen=name;q(".fc-meta").hidden=name==="daily";q(".fc-demo").hidden=name==="daily";',1)
button='<button type="button" class="fc-tab" data-screen="daily" aria-selected="false" id="fc-tab-daily">Ежедневный отчёт</button>'
html=html.replace('</nav>',button+'</nav>',1)
section='''
<section id="fc-daily" aria-labelledby="fc-tab-daily" hidden>
 <div class="ov-heading"><div><p class="ov-eyebrow">ДЕНЕЖНЫЙ ПОТОК</p><h2>Ежедневный отчёт</h2></div><a class="fc-btn" id="daily-legacy" href="/?legacy=1" hidden>Ввод бухгалтерии →</a></div>
 <div class="dc-controls"><label>Источник<select id="daily-source"><option value="bank">Т-Банк + ВТБ · общий период</option><option value="tbank">Т-Банк · автоматически</option><option value="vtb">ВТБ · загруженная выписка</option><option value="accountant">Ввод бухгалтерии · история</option></select></label><label>Месяц<input id="daily-month" type="month" min="2026-06"></label><button class="fc-btn" type="button" id="daily-refresh">Обновить экран</button><button class="fc-btn" type="button" id="daily-latest" hidden>Последняя запись</button></div>
 <p id="daily-status" class="real-warning" role="status" aria-live="polite">Получение данных…</p>
 <p class="ov-note" id="daily-scope"></p>
 <h3 class="dc-section-heading">С начала месяца</h3><div id="daily-totals" class="dc-kpis"></div>
 <h3 class="dc-section-heading" id="daily-day-title">Последний подтверждённый день</h3><div id="daily-day-totals" class="dc-kpis dc-day-kpis"></div>
 <section class="ov-panel real-section" id="daily-budget"><h3>План месяца и календарь поступлений</h3><p class="ov-note" id="daily-budget-status"></p><div id="daily-budget-kpis" class="dc-kpis"></div><p class="real-warning" id="daily-budget-gap"></p><div class="dc-charts"><div><h4>Поступления по направлениям</h4><div class="fc-table-wrap"><table><thead><tr><th>Направление</th><th class="num">План месяца</th></tr></thead><tbody id="daily-budget-income"></tbody></table></div></div><div><h4>Бюджет затрат · проект</h4><div class="fc-table-wrap"><table><thead><tr><th>Блок</th><th class="num">Лимит проекта</th></tr></thead><tbody id="daily-budget-expense"></tbody></table></div><p class="ov-note" id="daily-budget-expense-note"></p></div></div><details><summary>Как получить календарь поступлений</summary><p class="ov-note">Продажи и отгрузка: по каждому взносу — ID заказа/договора, сумма, дата по договору, ожидаемая дата оплаты, уже оплачено, остаток, банк/касса, ответственный и подтверждение клиента. Старую дебиторку, следующие взносы и новые продажи вести раздельно. По новым продажам без конкретного заказа — отдельный прогноз по продукту и неделе с допущениями.</p><p class="ov-note">Бухгалтерия: сверка полученных денег и возвратов по всем счетам, комиссиям и задержкам эквайринга. Один платёж из GetCourse и банковская выписка описывают одни деньги. Финансовый ответственный сводит календарь и ежедневно заменяет прогноз фактом. План признанной выручки считается отдельно по оказанным услугам.</p></details></section>
 <section class="ov-panel real-section" id="daily-evidence" hidden></section>
 <details class="ov-panel real-section" id="daily-source-details"><summary>Источники и что ещё требуется подключить</summary><div class="fc-table-wrap"><table><thead><tr><th>Источник</th><th>Состояние</th><th>Охват и ограничения</th></tr></thead><tbody id="daily-source-rows"></tbody></table></div></details>
 <div class="dc-charts"><section class="ov-panel"><h3>Поступления и списания по дням</h3><p class="ov-note">Синие — поступления с процентами; серые — списания.</p><div id="daily-bars"></div></section><section class="ov-panel"><h3>Денежный поток с начала месяца</h3><p class="ov-note">Поступления + проценты − списания. Не прибыль.</p><div id="daily-curve"></div></section></div>
 <section class="ov-panel real-section"><h3 id="daily-table-title">Дневные данные</h3><div class="fc-table-wrap"><table><thead><tr><th>Дата</th><th class="num">Поступления</th><th class="num">Проценты</th><th class="num">Списания</th><th class="num">Возвраты¹</th><th class="num">Денежный поток</th><th class="num">Остаток</th><th class="num">Поступления с начала месяца</th><th class="num">Списания с начала месяца</th><th class="num">Поток с начала месяца</th></tr></thead><tbody id="daily-rows"></tbody></table></div><p class="ov-note" id="daily-definition"></p></section>
 <section class="real-section"><h3>Полнота и сверка</h3><p class="ov-note" id="daily-checks"></p><div class="fc-table-wrap"><table><thead><tr><th>Счёт</th><th>Валюта</th><th class="num">Операций</th><th class="num">Остаток на дату</th></tr></thead><tbody id="daily-accounts"></tbody></table></div><p class="ov-note">Переводы между своими счетами, движение тела депозитов и переводы собственнику отделены от внешнего потока. Эти суммы не являются начисленной выручкой или расходами месяца.</p></section>
</section>
'''
html=html.replace('</main>',section+'</main>',1)
html=html.replace('<span class="fc-sub">Обзор собственника</span>','<span class="fc-sub">Обзор собственника</span><button class="fc-btn" id="cabinet-logout" type="button">Выйти</button>',1)
html=html.replace('Локальный кабинет; многопользовательский доступ ещё не настроен.','Доступ по действующим ролям. Ежедневный отчёт обновляется отдельно от месячной сверки.')
html=html.replace('</head>','<link rel="stylesheet" href="/cabinet-daily.css?v=20261117-sources1">\n</head>',1)
html=html.replace('</body>','<script src="/cabinet-daily.js?v=20261117-sources1"></script>\n</body>',1)
private=ROOT/'private';private.mkdir(exist_ok=True)
(private/'cabinet.html').write_text(html,encoding='utf-8')
print(f'Built private authenticated cabinet: {len(html.encode())} bytes')
