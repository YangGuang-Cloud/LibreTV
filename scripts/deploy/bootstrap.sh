#!/usr/bin/env bash
set -euo pipefail
# Run once via the existing trusted administrator session.
[[ $EUID -eq 0 && $# -eq 1 ]] || { echo 'Usage: sudo bash bootstrap.sh /path/to/deploy-key.pub'; exit 1; }
[[ -f /etc/libretv/runtime.env && -d /opt/libretv/runtime ]] || { echo 'Existing LibreTV server required'; exit 1; }
ssh-keygen -l -f "$1" >/dev/null
public_key=$(cat "$1")
[[ "$public_key" == ssh-ed25519\ * && "$public_key" != *$'\n'* ]] || { echo 'Expected one Ed25519 public key'; exit 1; }
id libretv-deploy >/dev/null 2>&1 || useradd --create-home --home-dir /var/lib/libretv-deploy --shell /bin/bash libretv-deploy
install -d -o libretv-deploy -g libretv-deploy -m 700 /var/lib/libretv-deploy/.ssh
key_line="restrict $public_key"
touch /var/lib/libretv-deploy/.ssh/authorized_keys
grep -qxF "$key_line" /var/lib/libretv-deploy/.ssh/authorized_keys || printf '%s\n' "$key_line" >> /var/lib/libretv-deploy/.ssh/authorized_keys
chown libretv-deploy:libretv-deploy /var/lib/libretv-deploy/.ssh/authorized_keys
chmod 600 /var/lib/libretv-deploy/.ssh/authorized_keys
install -d -o libretv-deploy -g libretv-deploy -m 700 /var/lib/libretv-deploy/incoming
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
install -o root -g root -m 755 "$script_dir/install-release.py" /usr/local/sbin/libretv-deploy
sudo_rule=$(mktemp)
trap 'rm -f "$sudo_rule"' EXIT
printf '%s\n' 'libretv-deploy ALL=(root) NOPASSWD: /usr/local/sbin/libretv-deploy *' > "$sudo_rule"
visudo -cf "$sudo_rule"
install -o root -g root -m 440 "$sudo_rule" /etc/sudoers.d/libretv-deploy
printf '%s\n' 'Setup complete. Server host public key (verify this in the trusted console):'
cat /etc/ssh/ssh_host_ed25519_key.pub
