"""Read only the credential delivered to this service by systemd."""
from pathlib import Path
import os

def load_token():
    directory=os.environ.get('CREDENTIALS_DIRECTORY')
    if not directory:raise RuntimeError('systemd bank credential is not available')
    path=Path(directory)/'bank-token'
    if path.is_symlink() or not path.is_file():raise RuntimeError('systemd bank credential is not available')
    value=path.read_text(encoding='utf-8').strip()
    if not 20<=len(value)<=16384 or any(c.isspace() for c in value) or value=='TBankSandboxToken':
        raise RuntimeError('systemd bank credential is invalid')
    return value
