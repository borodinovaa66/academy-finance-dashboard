(()=>{
 const root=document.getElementById('finance-cabinet-v2'),q=s=>root.querySelector(s);
 const money=v=>v===null||v===undefined?'—':Number(v).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₽';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const fmt=d=>d?d.split('-').reverse().join('.'):'—';
 const moscow=d=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
 const currentMonth=moscow(new Date()).slice(0,7),yesterday=moscow(new Date(Date.now()-86400000));
 let report=null,generation=0;
 q('#daily-month').value=currentMonth;q('#daily-month').max=currentMonth;
 async function api(url,options){const r=await fetch(url,{credentials:'same-origin',...options});if(r.status===401){location.replace('/');throw Error('Требуется вход');}const data=await r.json();if(!r.ok)throw Error(data.error||'Источник не ответил');return data;}
 function card(title,value,caption){return `<article><p>${esc(title)}</p><strong>${money(value)}</strong><small>${esc(caption)}</small></article>`;}
 function render(){
   if(!report)return;
   const bank=report.source==='bank',rows=report.rows||[],last=rows.at(-1),t=report.totals;
   q('#daily-scope').textContent=JSON.parse(q('#real-data').textContent).entity+' · '+(report.scope||'')+(report.asOf?' · Проверено '+new Date(report.asOf).toLocaleString('ru-RU',{timeZone:'Asia/Dubai'})+' Дубай':'');
   q('#daily-status').textContent=bank?(t?`${report.bankScope==='combined'?'Т-Банк + ВТБ':report.bankScope==='vtb'?'ВТБ':'Т-Банк'} по ${fmt(report.throughDate)} включительно. Полный охват компании не подтверждён.`:'За выбранный месяц банковского снимка нет.'):
     (t?`Ручной ввод по ${fmt(report.throughDate)}. Нарастание только по внесённым дням; полнота месяца не подтверждена.`:`За выбранный месяц записей бухгалтерии нет.${report.latestAvailableDate?' Последняя запись источника: '+fmt(report.latestAvailableDate)+'.':''}`);
   if(bank&&report.month===currentMonth&&report.throughDate&&report.throughDate<yesterday)q('#daily-status').textContent+=' Обновление отстаёт: дата данных раньше вчерашнего дня.';
   if(report.sourceWarning)q('#daily-status').textContent+=' '+report.sourceWarning;
   q('#daily-latest').hidden=bank||!report.latestAvailableDate||report.latestAvailableDate.startsWith(report.month);
   const period=t?'С 1-го числа по '+fmt(report.throughDate):'Нет подтверждённых данных';
   q('#daily-totals').innerHTML=card('Поступления за месяц',t?.externalIncome,period)+card('Списания за месяц',t?.externalExpense,'Включают опознанные возвраты')+card('Денежный поток за месяц',t?.netFlow,'Поступления + проценты − списания')+
     card('Возвраты за месяц',t?.refunds,'Уже включены в списания')+card('Проценты за месяц',t?.interest,bank?'Однократно, без возврата уже начисленных процентов':'Из ручного ввода')+card('Остатки учтённых счетов',t?.cashBalance,report.throughDate?fmt(report.throughDate)+' · депозит ВТБ не включён':'—');
   q('#daily-day-title').textContent='Последний подтверждённый день'+(last?' · '+fmt(last.date):'');
   const dayNote=last?(bank?`${last.operationCount} операций в выписке`:'Ручная запись'):'Нет подтверждённых данных';
   q('#daily-day-totals').innerHTML=card('Поступления за день',last?.externalIncome,dayNote)+card('Списания за день',last?.externalExpense,dayNote)+card('Проценты за день',last?.interest,dayNote)+card('Денежный поток за день',last?.netFlow,dayNote);
   if(t?.ownerWithdrawal!==undefined)q('#daily-totals').innerHTML+=card('Вывод собственнику',t.ownerWithdrawal,'Отдельно от расходов бизнеса')+card('Чистое размещение ВТБ',(t.depositPlaced||0)-(t.depositReturned||0),'По движениям; доступный депозитный остаток не подтверждён');
   renderBudget();renderEvidence();
   q('#daily-rows').innerHTML=[...rows].reverse().map(r=>`<tr><td>${fmt(r.date)}</td>${[r.externalIncome,r.interest,r.externalExpense,r.refunds,r.netFlow,r.cashBalance,r.cumulative.externalIncome,r.cumulative.externalExpense,r.cumulative.netFlow].map(v=>`<td class="num">${money(v)}</td>`).join('')}</tr>`).join('')+(t?`<tr><td>Итого</td>${[t.externalIncome,t.interest,t.externalExpense,t.refunds,t.netFlow,t.cashBalance,t.externalIncome,t.externalExpense,t.netFlow].map(v=>`<td class="num">${money(v)}</td>`).join('')}</tr>`:'<tr><td colspan="10">Нет данных за этот месяц</td></tr>');
   q('#daily-table-title').textContent='День и нарастающий итог · '+(bank?'подтверждённые банковские операции':'записи бухгалтерии');
   q('#daily-definition').textContent='¹ Возвраты входят в списания; второй раз не вычитаются. '+(report.classification||'');
   q('#daily-checks').textContent=bank?(t?`${report.operationCount} операций в выбранном банковском периметре. Снимки сверены с выписками; 1С служит контролем и повторно не прибавляется к деньгам. Евро в рублёвые итоги не сложены.`:'Предыдущие подтверждённые данные сохраняются при сбое обновления.'):
      (report.missingDays?.length?`До последней записи отсутствуют ${report.missingDays.length} календарных дней. Не заполнены нулями. `:'')+'Ручные записи не изменены автоматизацией. Их периметр и полнота требуют сверки с выписками.';
   q('#daily-accounts').innerHTML=(report.accounts||[]).map(a=>`<tr><td>${esc(a.name)} · ${esc(a.suffix)} · ${fmt(a.closingDate||report.throughDate)}</td><td>${a.currency==='643'?'RUB':'EUR'}</td><td class="num">${a.operations}</td><td class="num">${Number(a.closing).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})}</td></tr>`).join('');
   charts();
 }
 function renderBudget(){
   const p=report.budget,show=!!p;
   q('#daily-budget-status').textContent=show?`${p.version} · проверено ${fmt(p.asOf)} · не окончательное утверждение`:(report.budgetWarning||'Для выбранного месяца бюджетный снимок не загружен.');
   q('#daily-source-details').hidden=!show;
   for(const id of ['daily-budget-kpis','daily-budget-income','daily-budget-expense','daily-source-rows'])q('#'+id).replaceChildren();
   q('#daily-budget-expense-note').textContent=show?p.expense.note:'';
   q('#daily-budget-gap').textContent=show?'План на день и нарастающий план пока отсутствуют: нет дат и подтверждений оплат. Процент исполнения общего плана не рассчитан: факт охватывает выбранные счета, план — все каналы поступлений. Линейное распределение по дням не применяется.':'Плановые значения не заменены нулями.';
   if(!show)return;
   q('#daily-budget-kpis').innerHTML=card('Цель поступлений на месяц',p.income.total,'Все каналы · цель продаж')+card('Из них сбор дебиторки',p.income.receivables,'Не весь остаток долга, а план сбора')+card('Остальные продажи',p.income.newSales,'Даты поступлений ещё не подтверждены');
   q('#daily-budget-income').innerHTML=p.income.rows.map(r=>`<tr><td>${esc(r.name)}</td><td class="num">${money(r.amount)}</td></tr>`).join('')+`<tr><td><strong>Итого цель поступлений</strong></td><td class="num"><strong>${money(p.income.total)}</strong></td></tr>`;
   q('#daily-budget-expense').innerHTML=p.expense.blocks.map(r=>`<tr><td>${esc(r.name)}</td><td class="num">${money(r.amount)}</td></tr>`).join('')+`<tr><td><strong>Итого проект</strong></td><td class="num"><strong>${money(p.expense.total)}</strong></td></tr>`;
   q('#daily-source-rows').innerHTML=p.sources.filter(r=>!report.evidence||!/ВТБ|1С|дебитор/i.test(r.name)).map(r=>`<tr><td>${/^https:\/\//.test(r.url)?`<a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.name)}</a>`:esc(r.name)}</td><td>${esc(r.status)}</td><td>${esc(r.detail)}</td></tr>`).join('');
   const link=document.createElement('a');link.href=p.sourceUrl;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Открыть исходный бюджет ↗';q('#daily-budget-status').append(' · ',link);
 }
 function renderEvidence(){
   const box=q('#daily-evidence'),e=report.evidence;box.hidden=!e;if(!e)return;
   const d=e.receivables,c=e.onec;
   const names={tbank:'Т-Банк',vtb:'ВТБ',receivables:'Дебиторка',onec:'1С',raiffeisen:'Райффайзен'};
   box.innerHTML='<h3>Источники и сверка</h3><p class="ov-note">Экран проверяет сервер каждую минуту. Это не означает непрерывное обновление исходных систем.</p><div class="fc-table-wrap"><table><thead><tr><th>Источник</th><th>Режим и свежесть</th></tr></thead><tbody>'+Object.entries(e.status||{}).map(([k,v])=>`<tr><td>${esc(names[k]||k)}</td><td>${esc(v)}</td></tr>`).join('')+'</tbody></table></div>';
   if(c)box.innerHTML+=`<h4>Контроль по 1С · ${fmt(c.asOf)}</h4><p>${esc(c.rows)} банковских документов: Т-Банк ${esc(c.bankCounts.tbank)}, ВТБ ${esc(c.bankCounts.vtb)}. Сеанс завершён.</p>`+(c.notes||[]).map(n=>`<p class="ov-note">${esc(n)}</p>`).join('');
   if(d)box.innerHTML+=`<h4>Дебиторка и ожидаемые поступления</h4><p>${e.receivablesSync?'Серверное чтение: '+esc(e.receivablesSync.state==='ok'?'успешно':'ошибка')+' · '+esc(e.receivablesSync.checkedAt||'нет даты')+' · '+esc(e.receivablesSync.errorCode||''):''}</p><p>Срез ${fmt(d.asOfExport)}; последняя явная отметка обновления ${fmt(d.lastExplicitUpdate)}. <a href="${esc(d.sourceUrl)}" target="_blank" rel="noopener noreferrer">Исходная таблица ↗</a></p><p class="real-warning">Полный остаток и просрочка не определены. ${esc(d.scope)}</p><div class="fc-table-wrap"><table><thead><tr><th>Поток</th><th>Строк выборки</th><th class="num">Стоимость минус оплаты</th><th>Обновление</th></tr></thead><tbody>`+(d.cohorts||[]).map(r=>`<tr><td>${esc(r.name)}</td><td>${r.records}</td><td class="num">${money(r.nominalOutstanding)}</td><td>${fmt(r.updatedAt)}</td></tr>`).join('')+'</tbody></table></div>'+(d.expected||[]).map(r=>`<p class="real-warning">Ожидание из заметки: ${money(r.amount)} к ${fmt(r.date)}. ${esc(r.status)}; год выведен из названия потока. Источник: ${esc(r.sourceSheet)}, ${esc(r.sourceCell)}.</p>`).join('')+(d.notes||[]).map(n=>`<p class="ov-note">${esc(n)}</p>`).join('')+'<details><summary>Ошибки исходных формул и ограничения</summary>'+(d.issues||[]).map(n=>`<p>${esc(n)}</p>`).join('')+'</details>';
 }
 function charts(){
   const rows=report?.rows||[];for(const id of ['daily-bars','daily-curve'])q('#'+id).replaceChildren();if(!rows.length||q('#fc-daily').hidden)return;
   const ns='http://www.w3.org/2000/svg',node=(name,attrs={},text)=>{const e=document.createElementNS(ns,name);for(const [k,v]of Object.entries(attrs))e.setAttribute(k,v);if(text!==undefined)e.textContent=text;return e;};
   function setup(id,label,min,max){const box=q('#'+id),w=box.clientWidth,h=220,L=43,R=12,T=14,B=27;if(w<100)return null;const low=Math.min(min,0),high=Math.max(max,0),span=high-low||1;
    const dates=rows.map(r=>Date.parse(r.date+'T00:00:00Z')),first=Date.parse(report.month+'-01T00:00:00Z'),last=dates.at(-1),x=i=>L+(dates[i]-first)/Math.max(last-first,86400000)*(w-L-R),y=v=>T+(high-v)/span*(h-T-B);
    const svg=node('svg',{viewBox:`0 0 ${w} ${h}`,class:'dc-chart',role:'img','aria-label':label});
    const ticks=[...new Set(low<0&&high>0?[low,0,high]:[low,(low+high)/2,high])];
    for(const v of ticks){svg.append(node('line',{x1:L,x2:w-R,y1:y(v),y2:y(v),stroke:'#e2e7ed'}),node('text',{x:L-6,y:y(v)+4,'text-anchor':'end'},(v/1e6).toLocaleString('ru-RU',{maximumFractionDigits:2})));}
    svg.append(node('text',{x:L,y:10},'млн ₽'));
    [...new Set([0,Math.floor((rows.length-1)/2),rows.length-1])].forEach(i=>svg.append(node('text',{x:x(i),y:h-5,'text-anchor':i===0?'start':i===rows.length-1?'end':'middle'},rows[i].date.slice(8)+'.'+rows[i].date.slice(5,7))));
    box.append(svg);return {svg,node,x,y,w,L,R};
   }
   const b=setup('daily-bars','Банковские поступления и списания по дням в миллионах рублей',-Math.max(...rows.map(r=>r.externalExpense)),Math.max(...rows.map(r=>r.externalIncome+r.interest)));
   if(b){const bw=Math.max(2,Math.min(10,(b.w-b.L-b.R)/Math.max(1,Number(rows.at(-1).date.slice(-2)))*.3));rows.forEach((r,i)=>{for(const [amount,offset,color] of [[r.externalIncome+r.interest,-bw,'#527f9e'],[-r.externalExpense,1,'#929eaa']]){if(!amount)continue;const rect=b.node('rect',{x:b.x(i)+offset,y:Math.min(b.y(amount),b.y(0)),width:bw,height:Math.max(1,Math.abs(b.y(amount)-b.y(0))),fill:color});rect.append(b.node('title',{},fmt(r.date)+': '+money(amount)));b.svg.append(rect);}});}
   const values=rows.map(r=>r.cumulative.netFlow),c=setup('daily-curve','Денежный поток нарастающим итогом с начала месяца, миллионы рублей',Math.min(...values),Math.max(...values));
   if(c){let d='';rows.forEach((r,i)=>{const gap=i&&Date.parse(r.date)-Date.parse(rows[i-1].date)>86400000;d+=(i&&!gap?'L':'M')+c.x(i)+' '+c.y(r.cumulative.netFlow);});c.svg.append(c.node('path',{d,fill:'none',stroke:'#265e86','stroke-width':2}));rows.forEach((r,i)=>{const circle=c.node('circle',{cx:c.x(i),cy:c.y(r.cumulative.netFlow),r:3,fill:'#265e86'});circle.append(c.node('title',{},fmt(r.date)+': '+money(r.cumulative.netFlow)));c.svg.append(circle);});}
 }
 async function load(){const id=++generation;q('#daily-status').textContent='Получение данных…';try{const value=await api('/api/cabinet/daily?month='+encodeURIComponent(q('#daily-month').value)+'&source='+q('#daily-source').value);if(id!==generation)return;report=value;render();}catch(e){if(id===generation)q('#daily-status').textContent='Не удалось обновить экран: '+e.message+'. Предыдущая проверенная версия не изменена.';}}
 q('#daily-source').addEventListener('change',load);q('#daily-month').addEventListener('change',load);q('#daily-refresh').addEventListener('click',load);
 q('#daily-latest').addEventListener('click',()=>{if(report?.latestAvailableDate){q('#daily-month').value=report.latestAvailableDate.slice(0,7);load();}});
 root.addEventListener('click',e=>{if(e.target.closest('[data-screen="daily"]')){location.hash='daily';load();}});
 q('#cabinet-logout').addEventListener('click',async()=>{await api('/api/auth/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});location.replace('/');});
 api('/api/auth/me').then(data=>{q('#daily-legacy').hidden=data.user?.role!=='accountant';}).catch(()=>{});
 if(location.hash==='#daily')q('#fc-tab-daily').click();else if(!q('#fc-daily').hidden)load();
 let width=0;new ResizeObserver(()=>{if(q('#fc-daily').clientWidth!==width){width=q('#fc-daily').clientWidth;charts();}}).observe(q('#fc-daily'));
 setInterval(()=>{if(!document.hidden&&!q('#fc-daily').hidden)load();},60000);
})();
