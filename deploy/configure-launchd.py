#!/usr/bin/env python3
"""Configure only Paper Editor's own services. Existing frpc instances stay intact."""
import os, pathlib, plistlib, subprocess
root = pathlib.Path(os.environ.get('PAPEREDITOR_ROOT', '/Volumes/KIOXIA/PaperEditor'))
for name in ['config', 'logs', 'tmp', 'data']:
    (root / name).mkdir(parents=True, exist_ok=True)
source = pathlib.Path.home() / 'frp/frpc-public.toml'
header = source.read_text().split('[[proxies]]', 1)[0]
keys = ('serverAddr', 'serverPort', 'auth.', 'transport.')
selected = [line for line in header.splitlines() if line.strip().startswith(keys)]
assert any('119.23.54.57' in line for line in selected), 'Unexpected FRP server'
config = root / 'config/frpc.toml'
if not config.exists():
    config.write_text('\n'.join(selected) + '\n\n[[proxies]]\nname = "papereditor-http"\ntype = "tcp"\nlocalIP = "127.0.0.1"\nlocalPort = 18080\nremotePort = 18080\n')
    config.chmod(0o600)
agents = pathlib.Path.home() / 'Library/LaunchAgents'
agents.mkdir(parents=True, exist_ok=True)
bootstrap_logs = pathlib.Path.home() / 'Library/Logs/PaperEditor'
bootstrap_logs.mkdir(parents=True, exist_ok=True)
services = {
    'com.papereditor.app': ['/bin/bash', str(root / 'app/deploy/start-mac.sh')],
    'com.papereditor.frpc': [str(pathlib.Path.home() / 'frp/frpc'), '-c', str(config)],
}
for label, args in services.items():
    p = agents / (label + '.plist')
    values = {'Label': label, 'ProgramArguments': args, 'RunAtLoad': True, 'KeepAlive': True,
              'ThrottleInterval': 15, 'WorkingDirectory': str(pathlib.Path.home()),
              'StandardOutPath': str(bootstrap_logs / (label + '.log')),
              'StandardErrorPath': str(bootstrap_logs / (label + '.error.log'))}
    p.write_bytes(plistlib.dumps(values))
    subprocess.run(['launchctl', 'bootout', f'gui/{os.getuid()}/{label}'], capture_output=True)
    subprocess.run(['launchctl', 'bootstrap', f'gui/{os.getuid()}', str(p)], check=True)
    print('Started', label)
