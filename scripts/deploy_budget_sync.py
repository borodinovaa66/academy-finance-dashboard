"""Deploy only budget synchronization files; never transfer credentials."""
from pathlib import Path
import hashlib, io, json, subprocess, tarfile
ROOT=Path(__file__).resolve().parents[1]
SSH=['ssh','-i','C:/Users/User/.ssh/codex-hr-yandex','-o','BatchMode=yes','-o','ConnectTimeout=15','-o','IdentitiesOnly=yes','ubuntu@93.77.178.9']
SCP=['scp','-i','C:/Users/User/.ssh/codex-hr-yandex','-o','BatchMode=yes','-o','ConnectTimeout=15','-o','IdentitiesOnly=yes']
FILES=['src/budget.js','src/cash-plan.js','src/budget-generation.js','public/cabinet-budget.js','server-budget/collect.js','server-budget/transform.js','server-budget/publish.js','server-budget/finance-budget-sync.service','server-budget/finance-budget-publish.service','server-budget/finance-budget-sync.timer']
manifest={'expectedServerHashes':{
 'src/budget.js':'a5dd705c62a87e6d6f542d4e5b6b22dcbe608cb60a9664775b8554d138129a88',
 'src/cash-plan.js':'2c3d707db529802587b507c3410337482105ec8e4abfe2de56580af726e1aaf4',
 'src/budget-generation.js':None,
 'public/cabinet-budget.js':'d5d838de2f14e65bd7c0b7b6de258aeebfea3af5d6e2e8aae1aa3d6c11b365c8'}}
def run(args):return subprocess.run(args,check=True,capture_output=True,text=True,encoding='utf-8').stdout.strip()
def main():
 archive=ROOT/'local-state/budget-sync-release.tgz'
 with tarfile.open(archive,'w:gz') as tar:
  for name in FILES:tar.add(ROOT/name,arcname=name)
  blob=json.dumps(manifest).encode();info=tarfile.TarInfo('manifest.json');info.size=len(blob);tar.addfile(info,io.BytesIO(blob))
 digest=hashlib.sha256(archive.read_bytes()).hexdigest()
 run(SCP+[str(archive),'ubuntu@93.77.178.9:/tmp/finance-budget-sync-release.tgz'])
 run(SCP+[str(ROOT/'server-budget/install_server.py'),'ubuntu@93.77.178.9:/tmp/finance-budget-sync-install.py'])
 result=json.loads(run(SSH+['sudo -n python3 /tmp/finance-budget-sync-install.py /tmp/finance-budget-sync-release.tgz '+digest]))
 result.update({'archiveSha256':digest,'fileHashes':{name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in FILES}})
 (ROOT/'local-state/budget-sync-deployment.json').write_text(json.dumps(result,indent=2),encoding='utf-8');print(json.dumps(result))
if __name__=='__main__':main()
