#!/usr/bin/python3 -I
"""Root-owned deployment entry point. Only a validated commit ID is accepted."""
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request


def extract_release(archive, destination):
    with tarfile.open(fileobj=archive, mode='r:gz') as bundle:
        bundle.extractall(destination, filter='data')
    if not (destination / 'server.js').is_file() or not (destination / '.next/BUILD_ID').is_file():
        raise ValueError('Archive is not a Next.js standalone release')


def healthy(release):
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open('http://127.0.0.1:8080/api/status', timeout=3) as response:
            state = json.load(response)
            return state.get('buildId') == release and state.get('passwordRequired') is True
    except (OSError, ValueError):
        return False


def activate(candidate, runtime, run, check):
    """Keep the exact previous runtime for rollback, including the initial directory install."""
    previous = runtime.resolve() if runtime.is_symlink() else None
    if previous is None:
        previous = runtime.parent / ('runtime-backup-' + str(time.time_ns()))
    was_directory = not runtime.is_symlink()
    stopped = False
    switched = False
    moved = False
    link = runtime.parent / '.runtime-next'
    try:
        run('stop')
        stopped = True
        if was_directory:
            runtime.rename(previous)
            moved = True
        link.unlink(missing_ok=True)
        link.symlink_to(candidate, target_is_directory=True)
        os.replace(link, runtime)
        switched = True
        run('start')
        if not check():
            raise RuntimeError('New release failed health check')
    except BaseException:
        if stopped:
            run('stop')
            if switched:
                link.unlink(missing_ok=True)
                link.symlink_to(previous, target_is_directory=True)
                os.replace(link, runtime)
            elif moved:
                previous.rename(runtime)
            run('start')
        raise
    finally:
        link.unlink(missing_ok=True)


def main():
    if os.geteuid() != 0 or len(sys.argv) != 2 or not re.fullmatch(r'[a-f0-9]{40}', sys.argv[1]):
        raise SystemExit('Usage: sudo libretv-deploy <40-character commit SHA>')
    release = sys.argv[1]
    runtime = Path('/opt/libretv/runtime')
    if not runtime.exists():
        raise SystemExit('Existing LibreTV installation is required')
    with open('/run/lock/libretv-deploy.lock', 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        releases = Path('/opt/libretv/releases')
        releases.mkdir(mode=0o755, exist_ok=True)
        candidate = Path(tempfile.mkdtemp(prefix=release + '-', dir=releases))
        # Copy to a root-owned snapshot so the upload cannot change during extraction.
        source = Path('/var/lib/libretv-deploy/incoming') / (release + '.tar.gz')
        try:
            with tempfile.TemporaryFile() as snapshot:
                with os.fdopen(os.open(source, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as incoming:
                    shutil.copyfileobj(incoming, snapshot)
                snapshot.seek(0)
                extract_release(snapshot, candidate)
            # Application files stay root-owned and read-only to the service user.
            # Persistent writes already go to /var/lib/libretv via the existing unit.
            os.chmod(candidate, 0o755)
            for parent, dirs, files in os.walk(candidate, followlinks=False):
                os.chmod(parent, 0o755)
                for name in files:
                    path = Path(parent) / name
                    if not path.is_symlink():
                        os.chmod(path, 0o755 if path.stat().st_mode & 0o111 else 0o644)
            def run(action):
                subprocess.run(['/usr/bin/systemctl', action, 'libretv.service'], check=True)
            def check():
                for _ in range(30):
                    if healthy(release):
                        return True
                    time.sleep(2)
                return False
            activate(candidate, runtime, run, check)
            source.unlink(missing_ok=True)
            print('Deployed ' + release, flush=True)
        except BaseException:
            if runtime.resolve() != candidate:
                shutil.rmtree(candidate)
            raise


if __name__ == '__main__':
    main()
