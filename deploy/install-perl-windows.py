"""Download verified portable Strawberry Perl without changing system settings."""
import hashlib,json,pathlib,urllib.request,zipfile
root=pathlib.Path(__file__).resolve().parent.parent
target=root/'.local/strawberry'
if (target/'perl/bin/perl.exe').exists():
    print('Portable Perl is already installed.')
    raise SystemExit(0)
with urllib.request.urlopen('https://strawberryperl.com/releases.json',timeout=60) as response:
    releases=json.load(response)
release=next(r for r in releases if r['archname']=='MSWin32-x64-multi-thread' and r['edition']['portable']['url'].endswith('-portable.zip'))
item=release['edition']['portable']
root.joinpath('.local').mkdir(exist_ok=True)
archive=root/'.local/strawberry.zip'
urllib.request.urlretrieve(item['url'],archive)
assert hashlib.sha256(archive.read_bytes()).hexdigest()==item['sha256'],'Perl archive checksum mismatch'
with zipfile.ZipFile(archive) as z:
    z.extractall(target)
archive.unlink()
print('Installed verified portable Strawberry Perl',release['version'])
