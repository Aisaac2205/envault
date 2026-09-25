# Conectar Bases de Datos On-Premise

> 🇬🇧 English version: [../en/connecting-on-premise-databases.md](../en/connecting-on-premise-databases.md)

Guía para DevOps cuyas bases de datos viven en **redes privadas** — data centers corporativos, VPCs aisladas, servers on-prem, ambientes air-gapped — donde la DB no tiene un endpoint público que EnVault Management pueda alcanzar directamente.

> **Spoiler**: no existe una "URL mágica" para on-prem. Tenés que poner a EnVault Management y la DB en el mismo scope de alcance de red. Este doc muestra las cuatro formas prácticas de hacerlo.

---

## 1. El problema central

Las DBs cloud resuelven la conectividad o siendo direccionables públicamente (con SSL + allowlist) o viviendo en la misma VPC que quien llama. Las DBs on-prem típicamente **no se pueden hacer direccionables públicamente** por compliance, seguridad, o "el equipo de firewall no lo aprueba". Así que EnVault Management necesita meter mano en la red privada desde afuera.

Los cuatro patrones prácticos, de más a menos común:

1. **Self-hostear EnVault Management dentro de la red privada** — el más limpio, sin tunneling.
2. **VPN site-to-site** — la red de EnVault Management se vuelve parte de la red corporativa.
3. **Túnel SSH vía bastion / jump host** — rápido de armar, requiere túnel externo.
4. **Reverse proxy / SOCKS proxy** — nicho, pero funciona.

EnVault Management **no** trae túnel SSH o cliente VPN nativos hoy. Todos los patrones de abajo asumen que el túnel/VPN se establece **fuera** del proceso de EnVault Management, a nivel OS o red. Ver [architecture-roadmap.md](architecture-roadmap.md) para el soporte nativo planificado.

---

## 2. Patrón A — Self-host EnVault Management dentro de la red privada (recomendado)

La opción más simple y limpia: deployar EnVault Management **en un host que ya vive dentro de la red privada** donde están las DBs target.

```
┌──────────── Red Corporativa / Privada ──────────────┐
│                                                     │
│   ┌──────────┐    TCP directo   ┌──────────────┐    │
│   │ EnVault Management  │ ────────────────▶│  DB on-prem  │    │
│   │ container│  (IPs privadas)  │ (10.0.x.y)   │    │
│   └──────────┘                  └──────────────┘    │
│        ▲                                            │
│        │ HTTPS (reverse proxy)                      │
└────────┼────────────────────────────────────────────┘
         │
   ┌─────┴──────┐
   │  Usuarios  │ (conectados por VPN o vía gateway WAF / SSO)
   └────────────┘
```

**Qué necesitás**:

- Un host Linux dentro de la red que pueda `nc -zv <db-host> <db-port>` con éxito.
- Docker instalado en ese host (o Kubernetes).
- Un reverse proxy con terminación HTTPS (nginx, Traefik, Caddy) delante del puerto web de EnVault Management.
- Opcional: un WAF o gateway SSO para gatear el acceso desde la intranet corporativa.

**Pros**:
- Sin complejidad de tunneling.
- Latencia sub-milisegundo.
- Las credenciales de DB nunca salen de la red privada en tránsito.
- Compliance-friendly (a los auditores les encanta).

**Cons**:
- Tenés que operar EnVault Management en infra interna (parches, monitoreo, log shipping).
- Las convivencias cloud-native (auto-deploy de Railway) requieren un pipeline CI que empuje imágenes hacia adentro.

**Cuándo elegirlo**: deploys de producción, industrias reguladas (banca, salud), o cualquier escenario donde podés correr EnVault Management on-prem.

---

## 3. Patrón B — VPN site-to-site

Establecés un túnel VPN permanente entre la red donde corre EnVault Management (una VPC cloud, la red de tu laptop, donde sea) y la red corporativa donde viven las DBs. EnVault Management ve la DB como si fuera local.

```
┌── Red EnVault Management ──────┐         ┌── Red Corporativa ────┐
│                     │  VPN    │                       │
│  ┌──────────┐       │ túnel   │  ┌────────────────┐   │
│  │ EnVault Management  │ ◀═══════════════════▶ DB (10.0.x.y) │   │
│  └──────────┘       │  IPSec  │  └────────────────┘   │
│                     │  /WG    │                       │
└─────────────────────┘         └───────────────────────┘
```

**Herramientas**:
- IPSec (estándar corporativo, soportado por AWS, Azure, GCP, Cisco, Fortinet).
- WireGuard (más ligero, moderno, más fácil de debuggear — `wg-quick`).
- OpenVPN (legacy pero ubicuo).

**Configuración del lado de EnVault Management**:

Al conectar desde EnVault Management, usá la **IP privada** de la DB (como se ve desde dentro de la red corporativa):

| Campo | Valor |
|-------|-------|
| Host | `10.42.1.50` (o la IP privada que sea) |
| Port | `5432` |
| Database | nombre de la DB corporativa |
| Username | usuario dedicado de backup |
| Password | secret rotado |
| DB Type | `postgres` o `mysql` |

**Verificación antes de guardar la conexión**:

```bash
# Desde el host que corre EnVault Management:
ping 10.42.1.50                           # confirma ruta VPN
nc -zv 10.42.1.50 5432                    # confirma alcanzabilidad TCP
psql -h 10.42.1.50 -U backup_user -d corp # confirma credenciales
```

**Pros**:
- Long-lived, estable, transparente para EnVault Management.
- Múltiples DBs alcanzables por un solo túnel.
- Gestionado centralmente por el equipo de red.

**Cons**:
- Requiere coordinación con el equipo de red corporativa.
- Las caídas son invisibles para EnVault Management hasta que falla un intento de conexión.

---

## 4. Patrón C — Túnel SSH vía bastion / jump host

Establecés un túnel SSH desde el host de EnVault Management a un jump host dentro de la red corporativa. El port forwarding local hace que la DB remota aparezca en `localhost:<port>` del host de EnVault Management.

```
┌── Host EnVault Management ──┐    ┌─ Jump Host ─┐    ┌── DB ──┐
│ EnVault Management          │    │             │    │        │
│   │              │    │             │    │        │
│   └─▶ localhost:5432  │             │    │        │
│       │          │    │             │    │        │
│       │ vía SSH  │    │             │    │        │
│       └──────────┼─── túnel SSH ───▶│ ──▶│ :5432  │
└──────────────────┘    └─────────────┘    └────────┘
```

**Setup en el host de EnVault Management** (fuera del proceso de EnVault Management):

```bash
# Túnel persistente (usá autossh o un systemd unit para producción)
ssh -L 5432:db.internal.corp:5432 \
    -N -f \
    -i ~/.ssh/envault_bastion_key \
    envault@bastion.corp.example.com

# O con autossh para auto-reconexión
autossh -M 0 -f -N \
    -o "ServerAliveInterval=30" \
    -o "ServerAliveCountMax=3" \
    -L 5432:db.internal.corp:5432 \
    -i ~/.ssh/envault_bastion_key \
    envault@bastion.corp.example.com
```

**Para EnVault Management en Docker**: el túnel tiene que terminar en el namespace de red del **host**, no dentro del container. Después en EnVault Management, registrá la conexión apuntando al host:

| Campo | Valor |
|-------|-------|
| Host | `host.docker.internal` (Docker Desktop) o la IP del bridge del host (Linux) |
| Port | `5432` (el puerto local del túnel) |
| Database | nombre de la DB corporativa |
| Username | usuario DB |
| Password | password DB |
| DB Type | `postgres` o `mysql` |

> **Importante**: el túnel SSH cifra el salto de EnVault Management al bastion. **No** cifra el salto bastion → DB. Si la red corporativa requiere cifrado end-to-end, activá SSL del lado de la DB y combiná con §3 (VPN) o esperá SSL nativo en EnVault Management.

**Ejemplo de systemd unit** (para estabilidad de producción):

```ini
# /etc/systemd/system/envault-ssh-tunnel.service
[Unit]
Description=Túnel SSH de EnVault Management al Postgres corporativo
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
- Rápido de armar, sin equipo de firewall más allá del acceso SSH al bastion.
- Bueno para evaluación, demos, o uso de bajo volumen.
- Auditable (cada sesión SSH deja rastro).

**Cons**:
- Túnel gestionado fuera de EnVault Management — si se cae, las conexiones fallan hasta que se restaure.
- Suma complejidad operativa (un servicio más que monitorear).
- Single point of failure a menos que corras múltiples túneles.

---

## 5. Patrón D — Reverse proxy / SOCKS proxy

Nicho, pero vale mencionarlo. Si la red corporativa tiene postura outbound-only (no se permite SSH inbound, VPN imposible), un **reverse tunnel** se puede iniciar desde dentro hacia afuera.

Herramientas: `frp`, `ngrok` (con caveats de compliance), `bore`, túneles de `cloudflared`.

```
Red Corporativa (inicia)             Red EnVault Management
┌─────────────────┐                  ┌──────────────┐
│   DB            │                  │              │
│   ▲             │                  │   EnVault Management    │
│   │             │                  │      ▲       │
│   cliente reverse tunnel           │      │       │
│   │             │ ──── outbound ─▶ │   server     │
│                 │     a endpoint   │   túnel      │
└─────────────────┘     público      └──────────────┘
```

**Usar solo cuando**:

- VPN bidireccional es imposible.
- SSH inbound está bloqueado.
- Compliance permite el túnel outbound (muchas empresas prohíben herramientas tipo `ngrok` — chequear primero).

En EnVault Management, registrás el endpoint público del túnel server como host.

---

## 6. Matriz de decisión

| | Self-host (A) | VPN site-to-site (B) | Túnel SSH (C) | Reverse tunnel (D) |
|---|---|---|---|---|
| Tiempo de setup | Días (infra) | Días (equipo de red) | Horas | Horas |
| Complejidad operativa | Media | Baja (una vez armado) | Alta | Alta |
| Compliance | ⭐⭐⭐ Mejor | ⭐⭐⭐ Bueno | ⭐⭐ Mixto | ⭐ Riesgoso |
| Performance | ⭐⭐⭐ Mejor | ⭐⭐⭐ Buena | ⭐⭐ OK | ⭐ Variable |
| Resiliencia | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ | ⭐ |
| Mejor para | Producción, regulado | Multi-DB, largo plazo | Eval, bajo volumen | Último recurso |

---

## 7. Checklist de troubleshooting de conectividad

Antes de abrir un ticket "EnVault Management no conecta", corré esto desde el host donde corre EnVault Management:

```bash
# 1. ¿Puedo resolver el hostname?
nslookup db.internal.corp
dig db.internal.corp

# 2. ¿Puedo alcanzar el puerto?
nc -zv db.internal.corp 5432
# o
timeout 5 bash -c 'cat < /dev/tcp/db.internal.corp/5432'

# 3. ¿Postgres/MySQL realmente está escuchando?
pg_isready -h db.internal.corp -p 5432
# (mysql: mysqladmin ping -h db.internal.corp)

# 4. ¿Puedo autenticar con esas credenciales?
PGPASSWORD='...' psql -h db.internal.corp -U backup_user -d corp -c '\conninfo'
# (mysql: mysql -h ... -u ... -p ... -e 'SELECT 1')

# 5. Desde dentro del container de EnVault Management, ¿puedo alcanzar el host?
docker exec envault-api nc -zv host.docker.internal 5432
docker exec envault-api nc -zv db.internal.corp 5432
```

Si los pasos 1–4 funcionan desde el host pero el paso 5 falla, el problema es Docker networking — probablemente el túnel/VPN está en el host pero el container usa una bridge network que no lo alcanza. Soluciones:

- Usar `--network host` para el container de EnVault Management (perdés algo de aislamiento).
- Armar el túnel **dentro** del container como sidecar (requiere keys SSH montadas).
- Correr el túnel como container separado en la misma red Docker.

---

## 8. Checklist de Hardening para Producción

Para una conexión corporativa productiva:

- [ ] Cero exposición TCP pública (la base de datos jamás debe escuchar en interfaces de internet público).
- [ ] Conectividad mediante túnel cifrado privado (WireGuard, Tailscale o VPN IPsec).
- [ ] Usuario de base de datos dedicado, nunca la cuenta root o superusuario.
- [ ] Privilegios mínimos requeridos (`SELECT` y `LOCK TABLES` para MySQL; `CONNECT` y `SELECT` por tabla para PostgreSQL).
- [ ] SSL activo en el motor de base de datos como defensa en profundidad.
- [ ] Rotación periódica de credenciales documentada.
- [ ] Monitorización del túnel con alertas ante caídas de enlace.
- [ ] Respaldo inicial probado de extremo a extremo.
- [ ] Restauración probada contra un destino de desarrollo o pruebas (los restores a producción están bloqueados por diseño).

### Política Inmutable: Cero Exposición TCP Pública
Abrir los puertos 5432 o 3306 directamente a internet con usuario y contraseña constituye una vulnerabilidad grave ante ataques de fuerza bruta y denegación de servicio. 

El servidor de base de datos debe escuchar únicamente en `127.0.0.1` o en la dirección IP asignada por el adaptador de red virtual privada.

Ejemplo de configuración de interfaz WireGuard (`/etc/wireguard/wg0.conf`) para enlazar el servidor de base de datos con el host de EnVault:

```ini
[Interface]
Address = 10.100.0.2/24
PrivateKey = CLAVE_PRIVADA_DEL_SERVIDOR_DB
ListenPort = 51820

[Peer]
PublicKey = CLAVE_PUBLICA_DEL_HOST_ENVAULT
AllowedIPs = 10.100.0.1/32
Endpoint = ip.publica.envault:51820
PersistentKeepalive = 25
```

En la configuración del firewall corporativo (UFW o iptables), bloquee cualquier paquete entrante a los puertos de base de datos proveniente de interfaces públicas:

```bash
# Permitir tráfico PostgreSQL únicamente a través de la interfaz WireGuard wg0
sudo ufw allow in on wg0 to any port 5432 proto tcp
sudo ufw deny 5432/tcp
```

---

## 9. Qué viene (roadmap)

Ver [architecture-roadmap.md](architecture-roadmap.md) para el diseño planificado.

Headline: una abstracción `Transport` en el código que va a dejar que EnVault Management gestione SSH tunnels y configuración SSL por conexión nativamente. Hasta entonces, tratá el tunneling como **preocupación operativa externa**, no como feature de EnVault Management.
