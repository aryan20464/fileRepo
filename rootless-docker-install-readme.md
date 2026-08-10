# Rootless Docker Installation — RHEL Jump Host Setup

Covers a from-scratch install of rootless Docker to a non-standard, user-owned path
(`/devtools/docker`), for jump hosts where the user has no root access and only specific mount
points (e.g. `/devtools`) are writable.

> For the Harbor CA / `x509: certificate signed by unknown authority` fix specifically, see
> **`rootless-docker-harbor-tls-fix.md`** — steps 8–9 below are the short version of that same
> fix, included here so this doc is a complete standalone install path.

## Prerequisites

- Non-root user (`tanzuuser` in this setup) with write access to a dedicated mount point
  (`/devtools` here).
- Docker rootless release tarballs staged on the host or reachable to copy over:
  - `docker-<version>.tgz` (e.g. `docker-29.4.2.tgz`)
  - `docker-rootless-extras-<version>.tgz` (e.g. `docker-rootless-extras-29.4.2.tgz`)
- `dbus` available for the user (rootless Docker's systemd unit requires `dbus.socket`).
- `systemd --user` support (lingering may need to be enabled — see Troubleshooting).

## 1. Create the install directory structure

```bash
mkdir -p /devtools/docker/bin
chmod -R 770 /devtools/docker
```

## 2. Extract the Docker binaries

```bash
cd /devtools/docker
tar -xvzf /devtools/docker-<version>.tgz --strip-components=1 -C bin
tar -xvzf /devtools/docker-rootless-extras-<version>.tgz --strip-components=1 -C bin
cd bin && chmod +x * && cd ..
```

## 3. Add Docker to `PATH` and set `DOCKER_HOST`

Add to `~/.bashrc`:

```bash
export PATH=/devtools/docker/bin:$PATH
export DOCKER_HOST=unix://$XDG_RUNTIME_DIR/docker.sock
```

```bash
source ~/.bashrc
```

## 4. Install the rootless Docker service

A `rootless.sh` install helper script needs to sit alongside the `docker/` directory (one level
up from `bin/`) before running:

```bash
cp /devtools/rootless.sh /devtools/docker/
cd /devtools/docker
chmod +x rootless.sh
./rootless.sh install
```

Then run Docker's own rootless setup tool, skipping iptables since it's unavailable/unneeded
without root:

```bash
cd /devtools/docker/bin
./dockerd-rootless-setuptool.sh install --skip-iptables
```

## 5. Configure `daemon.json`

Rootless dockerd reads its daemon config from `$XDG_CONFIG_HOME/docker` (defaults to
`~/.config/docker`):

```bash
mkdir -p /home/tanzuuser/.config/docker
cat > /home/tanzuuser/.config/docker/daemon.json <<'EOF'
{
  "data-root": "/devtools/docker/data",
  "iptables": false
}
EOF
```

`data-root` relocates all image/container storage to the writable `/devtools` mount instead of
the default home-directory location — do this before pulling any images, not after, to avoid
having to migrate data.

## 6. Enable and start the service

```bash
systemctl --user daemon-reload
systemctl --user enable --now docker
systemctl --user status docker
```

Confirm it's `active (running)` with `rootlesskit`, `dockerd`, and `containerd` all listed as
child processes before proceeding.

## 7. Verify Docker works before touching TLS/registry config

```bash
docker info
docker run hello-world   # if internet/registry reachable at this point, otherwise skip
```

## 8. Add the internal registry's CA certificate

```bash
mkdir -p /devtools/docker/certs.d/<registry-host>
cp <registry-host>.crt /devtools/docker/certs.d/<registry-host>/ca.crt
```

> **Note:** on hosts with no `/etc/docker` access (neither on the real filesystem nor inside the
> rootless daemon's own namespace), Docker's engine-hardcoded `/etc/docker/certs.d` lookup for
> registry TLS trust is unusable — this `certs.d` copy alone will **not** be picked up by the
> daemon. Step 9 is what actually makes the daemon trust the registry.

## 9. Build a combined CA bundle and point `SSL_CERT_FILE` at it

```bash
mkdir -p /devtools/docker/ssl-certs
cat /etc/pki/tls/certs/ca-bundle.crt \
    /devtools/docker/certs.d/<registry-host>/ca.crt \
    > /devtools/docker/ssl-certs/combined-ca-bundle.pem
```

Edit `~/.config/systemd/user/docker.service`, adding `SSL_CERT_FILE` as its **own**
`Environment=` line (not appended to the existing `PATH` line — systemd needs each variable on
its own `Environment=` line or separated by whitespace, not `:`):

```ini
[Service]
Environment=PATH=/devtools/docker/bin:...
Environment=SSL_CERT_FILE=/devtools/docker/ssl-certs/combined-ca-bundle.pem
```

```bash
systemctl --user daemon-reload
systemctl --user restart docker
systemctl --user status docker
```

## 10. Log in and verify registry access

```bash
docker login <registry-host> -u <username>
docker pull <registry-host>/<project>/<image>:<tag>
```

## Troubleshooting / Notes

- **`--skip-iptables`** is used because this user has no permission to manage iptables rules;
  `daemon.json`'s `"iptables": false` reinforces the same restriction at the daemon level.
- If `systemctl --user` commands fail after logout/login cycles, the user's systemd instance may
  need lingering enabled: `loginctl enable-linger tanzuuser` (requires root — request from infra
  team if the service doesn't survive SSH session end).
- `systemctl --user show docker -p Environment` can **truncate** in the terminal, making it look
  like an env var isn't set even when it is — verify with:
  `systemctl --user show docker -p Environment --no-pager | tr ' ' '\n'`
- `docker --tlscacert=...` does **not** help with registry TLS trust — that flag is for the
  CLI-to-daemon-socket connection only.
- If the registry's CA ever rotates, rebuild `combined-ca-bundle.pem` (step 9) and restart the
  service — nothing here refreshes automatically.
