# Connecting to On-Premise Databases

> 🇪🇸 Versión en español: [../es/connecting-on-premise-databases.md](../es/connecting-on-premise-databases.md)

This guide is for DevOps users whose target databases live in **private networks** — corporate data centers, isolated VPCs, on-prem servers, air-gapped environments — where the DB has no public endpoint EnVault Management can reach directly.

> **Spoiler**: there is no "magic URL" for on-prem. You need to bring EnVault Management and the DB into the same network reachability scope. This doc shows the four practical ways to do that.

---

## 1. The core problem

Cloud DBs solve connectivity by either being publicly addressable (with SSL + allowlist) or living in the same VPC as the caller. On-prem DBs typically **cannot be made publicly addressable** for compliance, security, or just "the firewall team won't approve it" reasons. So EnVault Management needs to reach into the private network from outside.

The four practical patterns, ordered from most to least common:

1. **Self-host EnVault Management inside the private network** — cleanest, no tunneling needed.
2. **Site-to-site VPN** — EnVault Management's network becomes part of the corporate network.
3. **SSH tunnel via a bastion / jump host** — fast to set up, requires manual external tunnel.
4. **Reverse proxy / SOCKS proxy** — niche, but works.

EnVault Management does **not** ship native SSH tunnel or VPN client functionality today. All of the patterns below assume the tunnel/VPN is established **outside** the EnVault Management process, at the OS or network level. See [architecture-roadmap.md](architecture-roadmap.md) for the planned native support.

---

## 2. Pattern A — Self-host EnVault Management inside the private network (recommended)

The simplest and most production-clean option: deploy EnVault Management **on a host that already lives inside the private network** where the target DBs are.

```
┌──────────── Corporate / Private Network ────────────┐
│                                                     │
│   ┌──────────┐    direct TCP    ┌──────────────┐    │
│   │ EnVault Management  │ ────────────────▶│  On-prem DB  │    │
│   │ container│  (private IPs)   │ (10.0.x.y)   │    │
│   └──────────┘                  └──────────────┘    │
│        ▲                                            │
│        │ HTTPS (reverse proxy)                      │
└────────┼────────────────────────────────────────────┘
         │
   ┌─────┴──────┐
   │   Users    │ (VPN-connected or via WAF / SSO gateway)
   └────────────┘
```

**What you need**:

- A Linux host inside the network that can `nc -zv <db-host> <db-port>` successfully.
- Docker installed on that host (or Kubernetes).
- An HTTPS-terminating reverse proxy (nginx, Traefik, Caddy) in front of EnVault Management's web port.
- Optional: a WAF or SSO gateway to gate access from the corporate intranet.

**Pros**:
- No tunneling complexity.
- Network latency is sub-millisecond.
- DB credentials never leave the private network in transit.
- Compliance-friendly (auditors love it).

**Cons**:
- You need to operate EnVault Management on internal infrastructure (patching, monitoring, log shipping).
- Cloud-native conveniences (Railway's auto-deploy) require a CI pipeline that pushes images into the private network.

**When to choose this**: production deployments, regulated industries (banking, healthcare), or whenever you can run EnVault Management on-prem.

---

## 3. Pattern B — Site-to-site VPN

You establish a permanent VPN tunnel between the network where EnVault Management runs (a cloud VPC, your laptop's network, anywhere) and the corporate network where the DBs live. EnVault Management then sees the DB as if it were local.

```
┌── EnVault Management Network ──┐         ┌── Corporate Network ──┐
│                     │  VPN    │                       │
│  ┌──────────┐       │ tunnel  │  ┌────────────────┐   │
│  │ EnVault Management  │ ◀═══════════════════▶ DB (10.0.x.y) │   │
│  └──────────┘       │  IPSec  │  └────────────────┘   │
│                     │  /WG    │                       │
└─────────────────────┘         └───────────────────────┘
```

**Tools**:
- IPSec (corporate standard, supported by AWS, Azure, GCP, Cisco, Fortinet).
- WireGuard (lighter, modern, easier to debug — `wg-quick`).
- OpenVPN (legacy but widespread).

**Configuration on EnVault Management's side**:

When connecting from EnVault Management, use the DB's **private IP** (as seen from inside the corporate network):

| Field | Value |
|-------|-------|
| Host | `10.42.1.50` (or whatever private IP) |
| Port | `5432` |
| Database | corporate DB name |
| Username | dedicated EnVault Management backup user |
| Password | rotated secret |
| DB Type | `postgres` or `mysql` |

**Verification before saving the connection**:

```bash
# From the host running EnVault Management:
ping 10.42.1.50                           # confirms VPN route
nc -zv 10.42.1.50 5432                    # confirms TCP reachability
psql -h 10.42.1.50 -U backup_user -d corp # confirms credentials
```

**Pros**:
- Long-lived, stable, transparent to EnVault Management.
- Multiple DBs reachable through one tunnel.
- Centrally managed by the network team.

**Cons**:
- Requires coordination with the corporate network team.
- Failures are operationally invisible to EnVault Management until a connection attempt fails.

---

## 4. Pattern C — SSH tunnel via bastion / jump host

You establish an SSH tunnel from the host running EnVault Management to a jump host inside the corporate network. Local port forwarding makes the remote DB appear on `localhost:<port>` of the EnVault Management host.

```
┌── EnVault Management Host ──┐    ┌─ Jump Host ─┐    ┌── DB ──┐
│ EnVault Management          │    │             │    │        │
│   │              │    │             │    │        │
│   └─▶ localhost:5432  │             │    │        │
│       │          │    │             │    │        │
│       │ via SSH  │    │             │    │        │
│       └──────────┼─── SSH tunnel ──▶│ ──▶│ :5432  │
└──────────────────┘    └─────────────┘    └────────┘
```

**Setup on the EnVault Management host** (outside the EnVault Management process):

```bash
# Persistent tunnel (use autossh or a systemd unit for production)
ssh -L 5432:db.internal.corp:5432 \
    -N -f \
    -i ~/.ssh/envault_bastion_key \
    envault@bastion.corp.example.com

# Or with autossh for auto-reconnect
autossh -M 0 -f -N \
    -o "ServerAliveInterval=30" \
    -o "ServerAliveCountMax=3" \
    -L 5432:db.internal.corp:5432 \
    -i ~/.ssh/envault_bastion_key \
    envault@bastion.corp.example.com
```

**For Docker-hosted EnVault Management**: the tunnel must terminate on the **host's** network namespace, not inside the EnVault Management container. Then in EnVault Management, register the connection pointing at the host:

| Field | Value |
|-------|-------|
| Host | `host.docker.internal` (Docker Desktop) or the host's bridge IP (Linux) |
| Port | `5432` (the tunnel's local port) |
| Database | corporate DB name |
| Username | DB user |
| Password | DB password |
| DB Type | `postgres` or `mysql` |

> **Important**: the SSH tunnel encrypts the hop from EnVault Management to the bastion. It does **not** encrypt the bastion → DB hop. If the corporate network requires end-to-end encryption, enable SSL on the DB side and combine with §3 (VPN) or wait for native SSL in EnVault Management.

**Systemd unit example** (for production stability):

```ini
# /etc/systemd/system/envault-ssh-tunnel.service
[Unit]
Description=EnVault Management SSH tunnel to corporate Postgres
After=network-online.target
Wants=network-online.target

[Service]
User=envault
ExecStart=/usr/bin/autossh -M 0 -N \
  -o "ServerAliveInterval=30" \
  -o "ServerAliveCountMax=3" \
  -o "ExitOnForwardFailure=yes" \
  -L 5432:db.internal.corp:5432 \
  -i /home/envault/.ssh/bastion_key \
  envault@bastion.corp.example.com
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

**Pros**:
- Fast to set up, no firewall team needed beyond SSH access to the bastion.
- Good for evaluation, demos, or low-volume use.
- Auditable (every SSH session leaves a trail).

**Cons**:
- Tunnel managed outside EnVault Management — if it drops, connections fail until it's restored.
- Adds operational complexity (one more service to monitor).
- Single point of failure unless you run multiple tunnels.

---

## 5. Pattern D — Reverse proxy / SOCKS proxy

Niche, but worth mentioning. If the corporate network has an outbound-only stance (no inbound SSH allowed, no VPN possible), a **reverse tunnel** can be initiated from inside the corporate network outward.

Tools: `frp`, `ngrok` (with caveats around compliance), `bore`, `cloudflared` tunnels.

```
Corporate Network (initiates)        EnVault Management Network
┌─────────────────┐                  ┌──────────────┐
│   DB            │                  │              │
│   ▲             │                  │   EnVault Management    │
│   │             │                  │      ▲       │
│   reverse tunnel client            │      │       │
│   │             │ ────outbound───▶ │   tunnel     │
│                 │     to public    │   server     │
└─────────────────┘     endpoint     └──────────────┘
```

**Use this only when**:

- Bidirectional VPN is impossible.
- Inbound SSH is blocked.
- Compliance permits the outbound tunnel (many enterprises forbid `ngrok`-class tools — check first).

In EnVault Management, register the public endpoint of the tunnel server as the host.

---

## 6. Decision matrix

| | Self-host (A) | Site-to-site VPN (B) | SSH tunnel (C) | Reverse tunnel (D) |
|---|---|---|---|---|
| Setup time | Days (infra) | Days (network team) | Hours | Hours |
| Operational complexity | Medium | Low (once set) | High | High |
| Compliance friendliness | ⭐⭐⭐ Best | ⭐⭐⭐ Good | ⭐⭐ Mixed | ⭐ Risky |
| Performance | ⭐⭐⭐ Best | ⭐⭐⭐ Good | ⭐⭐ OK | ⭐ Variable |
| Resilience | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ | ⭐ |
| Best for | Production, regulated | Multi-DB, long-term | Eval, low volume | Last resort |

---

## 7. Connectivity troubleshooting checklist

Before opening a "EnVault Management can't connect" ticket, run these from the host where EnVault Management runs:

```bash
# 1. Can I resolve the hostname?
nslookup db.internal.corp
dig db.internal.corp

# 2. Can I reach the port?
nc -zv db.internal.corp 5432
# or
timeout 5 bash -c 'cat < /dev/tcp/db.internal.corp/5432'

# 3. Is Postgres/MySQL actually listening?
pg_isready -h db.internal.corp -p 5432
# (mysql equivalent: mysqladmin ping -h db.internal.corp)

# 4. Can I auth with these credentials?
PGPASSWORD='...' psql -h db.internal.corp -U backup_user -d corp -c '\conninfo'
# (mysql: mysql -h ... -u ... -p ... -e 'SELECT 1')

# 5. From inside the EnVault Management container, can I reach the host?
docker exec envault-api nc -zv host.docker.internal 5432
docker exec envault-api nc -zv db.internal.corp 5432
```

If steps 1–4 work from the host but step 5 fails, the issue is Docker networking — likely the tunnel/VPN is on the host but the container is using a bridge network that can't reach it. Solutions:

- Use `--network host` for the EnVault Management container (loses some isolation).
- Set up the tunnel **inside** the container as a sidecar (requires SSH keys mounted in).
- Run the tunnel as a separate container on the same Docker network.

---

## 8. Production Hardening Checklist

For a production enterprise database connection:

- [ ] Zero public TCP exposure (database servers must never listen on public internet interfaces).
- [ ] Connectivity routed through encrypted private tunnels (WireGuard, Tailscale, or IPsec VPN).
- [ ] Dedicated database user, never the root or superuser account.
- [ ] Minimum required privileges (`SELECT` and `LOCK TABLES` for MySQL; `CONNECT` and table-level `SELECT` for PostgreSQL).
- [ ] SSL enabled at the database layer as defense in depth.
- [ ] Documented credential rotation schedule.
- [ ] Tunnel monitoring with automatic alerts on connection loss.
- [ ] End-to-end backup pipeline verified.
- [ ] Restore operations verified against non-production targets (production restores are blocked by design).

### Immutable Standard: Zero Public TCP Exposure
Exposing ports 5432 or 3306 directly to the public internet with password authentication leaves systems vulnerable to brute-force credential stuffing and distributed denial-of-service attacks.

Database daemons must bind exclusively to `127.0.0.1` or the assigned IP address of a private virtual network adapter.

Example WireGuard interface configuration (`/etc/wireguard/wg0.conf`) connecting the database server with the EnVault host:

```ini
[Interface]
Address = 10.100.0.2/24
PrivateKey = DATABASE_SERVER_PRIVATE_KEY
ListenPort = 51820

[Peer]
PublicKey = ENVAULT_HOST_PUBLIC_KEY
AllowedIPs = 10.100.0.1/32
Endpoint = public.envault.ip:51820
PersistentKeepalive = 25
```

In the host firewall (UFW or iptables), drop all incoming database traffic arriving on public network interfaces:

```bash
# Allow PostgreSQL connections strictly via WireGuard interface wg0
sudo ufw allow in on wg0 to any port 5432 proto tcp
sudo ufw deny 5432/tcp
```

---

## 9. What's coming (roadmap)

See [architecture-roadmap.md](architecture-roadmap.md) for the planned design.

Headline: a `Transport` abstraction in the codebase that will let EnVault Management natively manage SSH tunnels and SSL configuration per connection. Until then, treat tunneling as **external operational concern**, not a EnVault Management feature.
