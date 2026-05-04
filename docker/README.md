# ITK — Docker Compose

Single-DFSP Mojaloop integration toolkit. Components: **MCM Agent**, **Vault**, **SDK Scheme Adapter**, **Redis**.

A `mojaloop-simulator` core-connector stand-in is included under the `test` profile for local testing.

## Prerequisites

- Docker Compose v2
- `openssl` (for the bootstrap-cert script)
- DFSP onboarded with a Mojaloop hub (you need `AUTH_CLIENT_ID` / `AUTH_CLIENT_SECRET` and the hub endpoints)

## Quick start

```bash
cd _ext-rs/integration-toolkit/docker

# 1. Configure
cp .env.sample .env
$EDITOR .env                          # fill in DFSP_ID, DFSP_FQDN, hub endpoints, auth creds

# 2. Generate bootstrap PEMs (throwaway self-signed; replaced at runtime by MCM Agent)
../scripts/gen-bootstrap-certs.sh ./secrets

# 3a. Local test (with bundled simulator)
docker compose -p dfsp-201  --profile test up -d

# 3b. Production (your core banking system; set BACKEND_ENDPOINT in .env first)
docker compose -p dfsp-201 up -d
```

Tear down:

```bash
docker compose -p dfsp-201 --profile test down -v   # -v also drops the vault volume
```

## Configuration (`.env`)

| Variable | Purpose |
| --- | --- |
| `DFSP_ID`, `DFSP_FQDN`, `DFSP_CURRENCIES` | DFSP identity |
| `MCM_SERVER_ENDPOINT`, `HUB_IAM_PROVIDER_URL`, `HUB_EXTAPI_FQDN` | Hub endpoints |
| `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET` | DFSP creds issued during enrollment |
| `BACKEND_ENDPOINT` | Core connector `host:port`. Defaults to `sim-backend:3000` for the `test` profile |
| `HOST_PORT_*` | Host port mappings (override defaults) |

The DFSP config is seeded into Vault on first boot only. To re-seed, run `docker compose down -v` to drop the `vault-data` volume.

## Ports (host)

| Port | Service | Notes |
| --- | --- | --- |
| `${HOST_PORT_SDK_INBOUND}` | SDK FSPIOP inbound (mTLS from hub) | default `443` |
| `${HOST_PORT_SDK_OUTBOUND}` | SDK outbound API | default `4001` |
| `${HOST_PORT_MCM}` | MCM Agent HTTP | default `3001` |
| `${HOST_PORT_VAULT}` | Vault UI / API | default `8200` |
| `${HOST_PORT_REDIS}` | Redis | default `6379` |
| `${HOST_PORT_SIM}` | Simulator backend API | `test` profile only |
| `${HOST_PORT_SIM_TEST}` | Simulator test API (`/repository/parties`) | `test` profile only |

## Notes

- **Bootstrap PEMs**: `secrets/inbound-{cacert,cert,key}.pem`, `secrets/jwsSigningKey.key`, and `secrets/jwsVerificationKeys/_placeholder.pub` exist only to satisfy the SDK's file-path requirements at boot. MCM Agent overrides the live TLS context and JWS keys via the PM4ML WebSocket once it connects. Don't reuse them as real material.
- **Vault auth**: AppRole only. The `vault-init` one-shot job writes `role-id` / `secret-id` into the `vault-creds` volume; the MCM Agent reads them from `/vault/role-id` and `/vault/secret-id`.
- **Vault recovery**: unseal key and root token live in the `vault-data` volume at `/vault/data/{unseal-key,root-token}`. Back these up if you care about Vault state across full teardowns.
