import unittest,sys,json,tempfile,os
import asyncio
from datetime import datetime,timezone
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'server-bank'))
from credential import load_token
from connector import validate_call,SafeError,extract_body,BankMCP
from server_collect import prepare_snapshot,record_failure
from connector import BankAuthDenied
from publish_server import secure_write

class ServerBankTests(unittest.TestCase):
    def test_unsupported_tool_rejected_before_key_or_network(self):
        with patch('connector.load_token',side_effect=AssertionError('credential read')):
            with self.assertRaises(SafeError):BankMCP().call('postApiV1PaymentCreate',{})

    def test_window_and_page_bounds(self):
        with self.assertRaises(SafeError):validate_call('getApiV1Statement',{'accountNumber':'00000000000000009870','from':'2026-01-01T00:00:00Z','to':'2026-04-01T00:00:00Z','limit':200})

    def test_credential_only_from_systemd_directory(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'bank-token';p.write_text('x'*40)
            with patch.dict(os.environ,{'CREDENTIALS_DIRECTORY':d},clear=True):self.assertEqual(load_token(),'x'*40)
        with patch.dict(os.environ,{'TOKEN':'x'*40},clear=True):
            with self.assertRaises(RuntimeError):load_token()

    def test_bank_response_and_auth_error(self):
        body={'operations':[]}
        self.assertEqual(extract_body({'structuredContent':{'status':200,'body':body}}),body)
        self.assertEqual(extract_body({'content':[{'type':'text','text':json.dumps({'status':200,'body':body})}]}),body)
        with self.assertRaises(SafeError):extract_body({'isError':True,'content':[{'type':'text','text':'arbitrary private text'}]})
        for code in [401,403]:
            with self.assertRaises(BankAuthDenied):extract_body({'structuredContent':{'status':code,'body':{}}})

    def test_tool_auth_error_creates_persistent_latch_without_transport_flag(self):
        with tempfile.TemporaryDirectory() as directory:
            state=Path(directory);record_failure(state,BankAuthDenied('denied'),False)
            self.assertTrue((state/'auth-blocked.json').exists())
            self.assertEqual(json.loads((state/'last-run.json').read_text())['stage'],'failed')

    def test_root_publisher_ignores_predictable_temp_and_replaces_symlinks(self):
        with tempfile.TemporaryDirectory() as directory:
            d=Path(directory);destination=d/'last-good.json';attack=d/'last-good.json.tmp';attack.write_bytes(b'do not overwrite')
            secure_write(destination,b'verified',None,None)
            self.assertEqual(attack.read_bytes(),b'do not overwrite');self.assertEqual(destination.read_bytes(),b'verified')
            victim=d/'victim';victim.write_bytes(b'protected')
            destination.unlink()
            try:destination.symlink_to(victim)
            except OSError:return
            secure_write(destination,b'new verified',None,None)
            self.assertEqual(victim.read_bytes(),b'protected');self.assertFalse(destination.is_symlink())

    def test_server_collection_uses_full_accounts_and_preserves_last_good(self):
        approved=['0'*16+s for s in ['9870','6608','7731','4506']]
        class FakeClient:
            def call(self,name,args):
                if name=='getApiV4Bank-accounts':body=[{'accountNumber':a,'currency':'978' if a.endswith('7731') else '643'} for a in approved]
                else:body={'operations':[],'nextCursor':None,'balances':{'balanceBegin':10,'balanceEnd':10,'credit':0,'debit':0,'operationsCount':0}}
                return {'structuredContent':{'status':200,'body':body}}
        with tempfile.TemporaryDirectory() as directory:
            state=Path(directory);old=json.dumps({'months':{}});(state/'last-good.json').write_text(old)
            report=asyncio.run(prepare_snapshot(state,FakeClient(),approved,datetime(2026,11,16,tzinfo=timezone.utc)))
            self.assertEqual(report['months']['2026-11']['throughDate'],'2026-11-15')
            self.assertEqual(report['months']['2026-11']['totals']['cashBalance'],30)
            self.assertEqual((state/'last-good.json').read_text(),old)
            (state/'auth-blocked.json').write_text('{}')
            with self.assertRaises(SafeError):asyncio.run(prepare_snapshot(state,FakeClient(),approved))

if __name__=='__main__':unittest.main()
