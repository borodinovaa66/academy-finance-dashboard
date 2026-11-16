import sys, unittest, asyncio
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts'))
from bank_daily import classify, build_month, read_pages

def operation(key, direction, amount, purpose='', category='fee', day='2026-11-02'):
    return {'operationId':key,'operationDate':day+'T10:00:00Z','accountAmount':amount,
            'typeOfOperation':direction,'payPurpose':purpose,'category':category}

def account(ops, begin, end):
    return {'suffix':'1234','name':'Рублёвый','type':'Current','currency':'643','body':{
      'operations':ops,'balances':{'balanceBegin':begin,'balanceEnd':end,
      'credit':round(sum(o['accountAmount'] for o in ops if o['typeOfOperation']=='Credit'),2),
      'debit':round(sum(o['accountAmount'] for o in ops if o['typeOfOperation']=='Debit'),2),
      'operationsCount':len(ops)},'nextCursor':None}}

class BankDailyTests(unittest.TestCase):
    def test_deposit_interest_does_not_count_twice(self):
        self.assertEqual(classify(operation('a','Credit',10,'Выплата процентов по депозиту','income')),'interest')
        self.assertEqual(classify(operation('b','Credit',10,'Возврат процентов с депозита','income')),'transferIn')
        self.assertEqual(classify(operation('c','Debit',1000,'Перевод между счетами','selfTransferOuter')),'transferOut')

    def test_penny_precision_and_confirmed_zero_days(self):
        ops=[operation('a','Credit',0.1,category='acquiring'),operation('b','Credit',0.2,category='incomePeople'),operation('c','Debit',0.1)]
        m=build_month('2026-11','2026-11-03',[account(ops,10,10.2)])
        self.assertEqual(len(m['rows']),3)
        self.assertEqual(m['rows'][0]['externalIncome'],0)
        self.assertEqual(m['rows'][1]['externalIncome'],0.3)
        self.assertEqual(m['rows'][2]['cashBalance'],10.2)
        self.assertEqual(m['totals']['netFlow'],0.2)

    def test_incomplete_or_unreconciled_never_publishes(self):
        a=account([operation('a','Credit',10)],0,9)
        with self.assertRaises(ValueError):build_month('2026-11','2026-11-03',[a])
        a=account([operation('a','Credit',10),operation('a','Credit',10)],0,20)
        with self.assertRaises(ValueError):build_month('2026-11','2026-11-03',[a])

    def test_euros_not_added_to_rubles_and_refunds_are_subset(self):
        a=account([operation('a','Debit',2,'Возврат покупателю')],10,8)
        eur=account([],100,100);eur['currency']='978';eur['suffix']='9999'
        m=build_month('2026-11','2026-11-02',[a,eur])
        self.assertEqual(m['totals']['externalExpense'],2)
        self.assertEqual(m['totals']['refunds'],2)
        self.assertEqual(m['totals']['netFlow'],-2)
        self.assertEqual(m['totals']['cashBalance'],8)

    def test_repeated_cursor_is_error(self):
        async def run():
            async def call(args):return {'operations':[],'nextCursor':'same','balances':{}}
            with self.assertRaises(ValueError):await read_pages(call,{'limit':200})
        asyncio.run(run())

if __name__=='__main__':unittest.main()
