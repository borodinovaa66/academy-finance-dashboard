"""One-off explicitly requested migration: DPAPI memory -> SSH stdin -> encrypted credential."""
from pathlib import Path
import importlib.util,json,subprocess,sys

def main():
    vault_path=Path('C:/Users/User/.codex/integrations/tbank-readonly/vault.py')
    spec=importlib.util.spec_from_file_location('existing_bank_vault',vault_path);vault=importlib.util.module_from_spec(spec);spec.loader.exec_module(vault)
    token=vault.load_token().encode('utf-8')
    command=['ssh','-o','BatchMode=yes','-o','ConnectTimeout=15','-o','IdentitiesOnly=yes','-i','C:/Users/User/.ssh/codex-hr-yandex','ubuntu@93.77.178.9',
      "sudo -n sh -c 'test ! -e /etc/credstore.encrypted/finance-bank-token && umask 077 && systemd-creds encrypt --name=bank-token --with-key=host - /etc/credstore.encrypted/finance-bank-token'"]
    result=subprocess.run(command,input=token,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    token=b''
    if result.returncode:raise RuntimeError('Encrypted credential migration did not complete; secret output suppressed')
    print(json.dumps({'transferred':True,'transport':'SSH stdin','serverStorage':'systemd encrypted credential','plaintextFileCreated':False,'secretPrinted':False}))

if __name__=='__main__':
    try:main()
    except Exception as error:print(type(error).__name__+': migration stopped without printing secret',file=sys.stderr);sys.exit(1)
