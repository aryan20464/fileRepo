# Rootless Docker: Fixing `x509: certificate signed by unknown authority` on Harbor Pulls

## Symptom

```
docker pull h06vksharbor.corp.ad.sbi/itss/kube-state-metrics:v2.13.0
Error response from daemon: failed to resolve reference "...": failed to authorize: failed to fetch oauth token:
Post "https://h06vksharbor.corp.ad.sbi/service/token": tls: failed to verify certificate: x509: certificate signed by unknown authority
```

## Root Cause

This host runs **rootless Docker** (`dockerd-rootless.sh` via a systemd user unit), installed to a
non-standard, user-owned path (e.g. `/devtools/docker`) with **no access to `/etc/docker`** —
not on the host filesystem, and not inside the rootless daemon's own namespace either (mount
points are restricted to specific paths like `/devtools` and `/tanzu` for this user).

Docker's standard fix for self-signed/internal registries — dropping a CA cert into
`/etc/docker/certs.d/<registry-host>/ca.crt` — is **hardcoded** in the Docker engine and cannot
be relocated via `daemon.json` or CLI flags. Since that path isn't writable (or even present) on
this host, placing the CA cert in `~/.docker/certs.d`, `~/.config/docker/certs.d`, or anywhere
else under the user's home directory **has no effect** — the daemon never reads those locations
for registry TLS trust.

## The Fix

`dockerd` is a Go binary. When Docker's own `certs.d` mechanism is unusable, you can instead feed
the CA into **Go's `crypto/x509` system trust store directly**, via the `SSL_CERT_FILE`
environment variable — set on the systemd user service, not the CLI. This requires no root
access and no `/etc/docker` access at all.

### Steps

**1. Locate the CA certificate for the registry.**

If you don't already have it, pull it from the live TLS handshake and verify the fingerprint:

```bash
openssl s_client -connect h06vksharbor.corp.ad.sbi:443 -showcerts </dev/null 2>/dev/null \
  | openssl x509 -noout -fingerprint -sha256
```

(Confirm this matches whatever `ca.crt` you have on hand, or get the correct one from the team
that manages the registry / TLS-inspecting proxy.)

**2. Locate the base system CA bundle on this host.**

```bash
cat /etc/os-release   # confirm distro family
ls -la /etc/ssl/certs/ca-certificates.crt /etc/pki/tls/certs/ca-bundle.crt 2>/dev/null
```

- Debian/Ubuntu → `/etc/ssl/certs/ca-certificates.crt`
- RHEL/CentOS/Rocky → `/etc/pki/tls/certs/ca-bundle.crt` (usually also symlinked as
  `/etc/ssl/certs/ca-bundle.crt`)

**3. Build a combined bundle in a path you own (e.g. under `/devtools`).**

```bash
mkdir -p /devtools/docker/ssl-certs
cat /etc/pki/tls/certs/ca-bundle.crt \
    /devtools/docker/certs.d/h06vksharbor.corp.ad.sbi/ca.crt \
    > /devtools/docker/ssl-certs/combined-ca-bundle.pem
```

(Adjust the system bundle path per step 2, and the Harbor `ca.crt` path to wherever you've
staged it.)

**4. Point the rootless Docker systemd user unit at the combined bundle.**

Edit `~/.config/systemd/user/docker.service`. Add `SSL_CERT_FILE` as **its own separate
`Environment=` line** — do **not** append it to the existing `PATH` line with a colon.
systemd separates multiple env vars with whitespace/new `Environment=` lines, not colons
(colons are only a valid separator *within* a single `PATH` value — appending
`:SSL_CERT_FILE=...` to the `PATH` line silently swallows it into the `PATH` string instead of
setting a real variable, and produces no error).

```ini
[Service]
Environment=PATH=/devtools/docker/bin:/sbin:/usr/sbin:...       # existing PATH, unchanged
Environment=SSL_CERT_FILE=/devtools/docker/ssl-certs/combined-ca-bundle.pem
```

**5. Reload and restart the daemon.**

Environment variables are only read at process start (unlike `certs.d`, which some builds read
per-connection), so a restart is required every time this changes.

```bash
systemctl --user daemon-reload
systemctl --user restart docker
```

**6. Verify the env var actually landed, then retry the pull.**

```bash
systemctl --user show docker -p Environment --no-pager | tr ' ' '\n'
```

`systemctl --user show ... -p Environment` on one line can get **truncated in the terminal**
and *look* like `SSL_CERT_FILE` didn't get set even when it did — piping through `tr ' ' '\n'`
splits each `KEY=value` onto its own line so nothing gets cut off. Confirm both `PATH=...` and
`SSL_CERT_FILE=...` appear as distinct entries, then:

```bash
docker pull h06vksharbor.corp.ad.sbi/itss/kube-state-metrics:v2.13.0
```

## Checklist for Replicating on a New VM

- [ ] Confirm this VM also runs rootless Docker with no `/etc/docker` access (if it has normal
      root-owned `/etc/docker`, just use the standard `certs.d` method instead — this workaround
      is only needed when that path is unavailable).
- [ ] Get/verify the Harbor CA cert fingerprint against the live server.
- [ ] Identify the system CA bundle path for this VM's distro.
- [ ] Build `combined-ca-bundle.pem` under a writable, persistent path (survives reboots/updates
      — avoid `/tmp`).
- [ ] Add `SSL_CERT_FILE` as its own `Environment=` line in the docker systemd user unit.
- [ ] `daemon-reload` + `restart` docker.
- [ ] Verify with `systemctl --user show docker -p Environment --no-pager | tr ' ' '\n'`.
- [ ] Test pull.
- [ ] If the registry's CA ever rotates, regenerate `combined-ca-bundle.pem` and restart the
      service again — nothing here auto-refreshes.

## Notes / Gotchas Hit During Original Troubleshooting

- `docker --tlscacert=...` does **not** help here — that flag configures the CLI's connection to
  the Docker daemon socket, not the daemon's outbound registry TLS verification. Easy to
  misapply by analogy with other TLS flags.
- `nsenter --mount` into the rootless daemon's namespace to try to create `/etc/docker/certs.d`
  is not a viable path if the environment restricts mount points to specific locations
  (`/devtools`, `/tanzu` in this case) — don't waste time on it if that's the constraint.
- Multiple stale copies of `ca.crt` were found across `~/.docker/certs.d`,
  `~/.config/docker/certs.d`, and `/devtools/docker/certs.d` during initial troubleshooting —
  **none of these matter for the daemon's registry trust** on a host without `/etc/docker`
  access, so don't waste time reconciling them if you're on this fix path.
