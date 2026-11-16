param([switch]$RefreshHistory)
$ErrorActionPreference = 'Stop'
$financeProject = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$financePython = 'C:/Users/User/.codex/integrations/tbank-readonly/.venv/Scripts/python.exe'
$financeSshKey = 'C:/Users/User/.ssh/codex-hr-yandex'
$financeSnapshot = Join-Path $financeProject 'private/bank-daily.json'
$financeLockPath = Join-Path $financeProject 'local-state/bank-sync.lock'
New-Item -ItemType Directory -Force -Path (Split-Path $financeLockPath) | Out-Null
$financeLock = [IO.File]::Open($financeLockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
try {
    $financeArgs = @('-X','utf8',(Join-Path $PSScriptRoot 'bank_daily.py'))
    if ($RefreshHistory) { $financeArgs += '--refresh-history' }
    & $financePython @financeArgs
    if ($LASTEXITCODE -ne 0) { throw 'Bank collection or reconciliation failed; production snapshot preserved.' }
    $financeChecksum = (Get-FileHash -LiteralPath $financeSnapshot -Algorithm SHA256).Hash.ToLowerInvariant()
    $financeRunName = 'finance-bank-daily-' + (Get-Date -Format 'yyyyMMddHHmmss') + '-' + [guid]::NewGuid().ToString('N') + '.json'
    & scp -o BatchMode=yes -o ConnectTimeout=15 -o IdentitiesOnly=yes -i $financeSshKey $financeSnapshot ('ubuntu@93.77.178.9:/tmp/' + $financeRunName)
    if ($LASTEXITCODE -ne 0) { throw 'Snapshot upload failed; production snapshot preserved.' }
    & ssh -o BatchMode=yes -o ConnectTimeout=15 -o IdentitiesOnly=yes -i $financeSshKey ubuntu@93.77.178.9 ('sudo -n python3 /opt/finance-dashboard/scripts/publish_snapshot.py /tmp/' + $financeRunName + ' ' + $financeChecksum)
    if ($LASTEXITCODE -ne 0) { throw 'Server verification failed; previous confirmed snapshot remains active.' }
} finally {
    $financeLock.Dispose()
}
