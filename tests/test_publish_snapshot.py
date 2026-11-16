import unittest,sys,copy
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from publish_snapshot import validate_snapshot

def snapshot():
    t={'externalIncome':1,'interest':0,'externalExpense':0.3,'refunds':0,'netFlow':0.7,'cashBalance':10.7}
    r={'date':'2026-11-01',**t,'cumulative':{k:v for k,v in t.items() if k!='cashBalance'}}
    accounts=[{'suffix':suffix,'currency':'643' if suffix!='7731' else '978','closing':10.7 if suffix=='9870' else 0,'operations':1 if suffix=='9870' else 0} for suffix in ['9870','6608','7731','4506']]
    return {'schemaVersion':1,'updatedAt':'2026-11-02T09:00:00Z','months':{'2026-11':{'month':'2026-11','throughDate':'2026-11-01','complete':True,'operationCount':1,'accounts':accounts,'rows':[r],'totals':t}}}

class PublisherTests(unittest.TestCase):
    def test_verified_snapshot(self):self.assertTrue(validate_snapshot(snapshot()))
    def test_corrupt_totals_or_partial_snapshot_rejected(self):
        for field,value in [('complete',False),('operationCount',2)]:
            s=snapshot();s['months']['2026-11'][field]=value
            with self.assertRaises(ValueError):validate_snapshot(s)
        s=snapshot();s['months']['2026-11']['totals']['netFlow']=999
        with self.assertRaises(ValueError):validate_snapshot(s)
