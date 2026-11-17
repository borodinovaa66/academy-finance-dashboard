"""Build aggregate-only supplemental evidence; raw exports stay in local-state."""
from pathlib import Path
from datetime import datetime,timezone
from decimal import Decimal
import json

ROOT=Path(__file__).resolve().parents[1]
def load(relative):return json.loads((ROOT/relative).read_text(encoding='utf-8'))
def number(value):return float(Decimal(str(value)))
def main():
    proof=load('local-state/vtb-import-20261117/reconciliation-private.json')
    if not all(proof['checks'][k] for k in ['all_rows_covered','debit_matches_source','credit_matches_source','balance_equation','daily_rollforward_matches']):raise ValueError('VTB verification incomplete')
    daily=load('local-state/vtb-import-20261117/daily-private.json');rows=[]
    keys=['externalIncome','interest','externalExpense','refunds','transferIn','transferOut','depositPlaced','depositReturned','ownerWithdrawal'];totals={k:Decimal(0) for k in keys}
    for day in daily:
        categories=day['categories']
        def amount(kind,side):return Decimal(categories.get(kind,{}).get(side,'0'))
        values={k:Decimal(0) for k in keys}
        values.update(interest=amount('deposit_interest','credit'),externalExpense=amount('bank_fee','debit'),depositPlaced=amount('deposit_placement','debit'),depositReturned=amount('deposit_return','credit'),ownerWithdrawal=amount('owner_withdrawal','debit'))
        for key in keys:totals[key]+=values[key]
        rows.append({'date':day['date'],**{k:number(v) for k,v in values.items()},'netFlow':number(values['interest']-values['externalExpense']),'cashBalance':number(day['closing_balance']),'operationCount':day['operation_count'],'confirmed':True,
          'cumulative':{**{k:number(v) for k,v in totals.items()},'netFlow':number(totals['interest']-totals['externalExpense'])}})
    vtb={'month':'2026-11','source':'bank','bankScope':'vtb','scope':'ВТБ · проверенная ручная выписка одного рублёвого счёта','throughDate':'2026-11-16','asOf':datetime.now(timezone.utc).isoformat(),'complete':True,'fullCompanyCoverage':False,'operationCount':30,'rows':rows,
         'totals':{**{k:number(v) for k,v in totals.items()},'netFlow':number(totals['interest']-totals['externalExpense']),'cashBalance':number(proof['closing_balance'])},
         'accounts':[{'suffix':'1826','name':'ВТБ · расчётный счёт','currency':'643','operations':30,'closing':number(proof['closing_balance']),'closingDate':'2026-11-16'}],
         'classification':'Проценты начислены однократно. Тело депозитов и вывод владельцу исключены из внешних поступлений/списаний. Остаток расчётного счёта не включает депозит.',
         'sourceSha256':proof['source_sha256'],'depositMovementNet':number(totals['depositPlaced']-totals['depositReturned'])}
    debt=load('local-state/receivables-20261117/summary-private.json')
    cohorts=[]
    for sheet in debt['sheets']:
        group=sheet['groups']['limited_active_new'];updates=sheet['update_cells']
        cohorts.append({'name':sheet['title'].strip(),'records':group['row_count'],'nominalOutstanding':number(group['positive_difference']),'updatedAt':updates[0]['date'] if updates else None,'sourceSheet':sheet['sheet_number']})
    receivables={'asOfExport':'2026-11-17','lastExplicitUpdate':'2026-11-13','sourceUrl':debt['source_url'],'scope':'Ограниченная выборка новых покупок: 6 из 76 листов. Переносы, возвраты и неопределённые строки исключены; межлистовые совпадения не разрешены.',
        'fullReceivables':None,'overdue':None,'cohorts':cohorts,
        'expected':[{'date':'2026-11-20','amount':116000,'status':'Рабочая заметка; договор и банк не сверены','sourceCell':'V29','sourceSheet':'Тренерский курс ( онлайн ноябрь 26)','yearInferred':True}],
        'issues':['Тренерский онлайн: S42=SUM(S8:S40) пропускает строки 6–7 (стоимость 700 000 ₽, оплачено 340 000 ₽).','УЦ47: Q179 ссылается на пустую Q155 вместо подытога Q156.','61 группа совпадений идентификаторов между листами: возможны переносы и разные продукты; полный итог не рассчитан.'],
        'notes':['Оплачено — накопительно, без дат платежей: фактические поступления ноября по этому полю не определяются.','Даты занятий/модулей не являются сроками взносов. Остаток не считается просрочкой.','Дата экспорта не заменяет дату обновления. Для двух листов дата обновления не установлена.','116 000 ₽ к20 ноября — ожидание из заметки; год2026 выведен из потока. Это не полный или утверждённый план.']}
    ledger=load('local-state/onec-check-20261117/reconciliation-private.json')
    if not all(ledger['parser_checks'].values()) or not ledger['tbank']['all_daily_counts_and_amounts_match']:raise ValueError('1C verification incomplete')
    onec={'asOf':'2026-11-17','user':'АндрейБ','loggedOut':True,'scope':'Банковские документы 1–16.11.2026; две операции17.11 исключены','rows':129,'bankCounts':{'tbank':102,'vtb':27},'missingBankRows':{'vtb':3},'lastSyncText':'17.11.2026 в13:06',
          'notes':['Т-Банк:102 операции сверены с банковским снимком по каждому дню;86 ранее сохранённых операций дополнительно сопоставлены построчно.','ВТБ:27 из30 строк совпали. Трёх операций16.11 пока нет в выгрузке1С; используем банковскую выписку.','Экранный итог списаний1С за16.11 отличается на16 666 ₽; сама строка присутствует, сумма строк497 003 ₽ совпала с банком. Причина расхождения экранного итога не установлена.','Документы1С не прибавляются к тем же банковским деньгам. Сеанс штатно завершён, подтверждён exit.html с кнопкойВойти.']}
    snapshot={'schemaVersion':1,'updatedAt':datetime.now(timezone.utc).isoformat(),'vtb':{'months':{'2026-11':vtb}},'receivables':receivables,'onec':onec,
      'status':{'tbank':'Серверное обновление ежедневно11:00МСК, данные по вчера','vtb':'Ручная выписка через Андрея, по16.11','receivables':'Проверенный экспорт под рабочим аккаунтом; постоянный серверный доступ не настроен','onec':'Вход и выгрузка проверены; серверный read-only API пока не включён','raiffeisen':'Только ручные выписки от Андрея; вход отложен'},
      'notes':['Нет исходящих сообщений Анне/бухгалтерии. Банковские интеграции с оплатой/сертификатами не активировались.']}
    target=ROOT/'private/daily-supplement.json';target.write_text(json.dumps(snapshot,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'written':str(target),'vtbOperations':30,'cohorts':len(cohorts),'ledgerRows':129,'containsPersonalRows':False}))

if __name__=='__main__':main()
