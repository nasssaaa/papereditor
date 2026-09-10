#!/usr/bin/env python3
"""Install a verified Node 24 LTS runtime on the project data disk."""
import hashlib, json, os, pathlib, subprocess, urllib.request
root = pathlib.Path(os.environ.get('PAPEREDITOR_ROOT', '/Volumes/KIOXIA/PaperEditor'))
runtime = root / 'runtime'
runtime.mkdir(parents=True, exist_ok=True)
if (runtime / 'node/bin/node').exists():
    print('Project Node runtime already installed.')
    raise SystemExit(0)
def fetch(url):
    with urllib.request.urlopen(url, timeout=120) as response: return response.read()
index = json.loads(fetch('https://nodejs.org/dist/index.json'))
version = next(r['version'] for r in index if r['version'].startswith('v24.') and r['lts'])
name = f'node-{version}-darwin-arm64.tar.gz'
base = f'https://nodejs.org/dist/{version}/'
checks = fetch(base + 'SHASUMS256.txt').decode()
expected = next(line.split()[0] for line in checks.splitlines() if line.split()[-1] == name)
archive = fetch(base + name)
assert hashlib.sha256(archive).hexdigest() == expected, 'Node checksum mismatch'
target = runtime / name
target.write_bytes(archive)
subprocess.run(['tar', '-xzf', str(target), '-C', str(runtime)], check=True)
(runtime / 'node').symlink_to(runtime / f'node-{version}-darwin-arm64', target_is_directory=True)
target.unlink()
print(f'Installed and verified Node {version}.')
