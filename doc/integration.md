# Integration

[README](../README.md) / Integration

**Audience:** participant (DFSP) operator

This guide takes a participant from the values the Hub operator hands over to a live, verified connection. Examples show a hub deployed with the [ML Deployment Toolkit](https://github.com/mojaloop/ml-deployment-toolkit) (MDK); any compatible Mojaloop hub exposes the same contract — Connection Manager (MCM) API, OAuth2 `client_credentials`, FSPIOP over mTLS — so the shapes shown here stay valid.

Why the stack looks the way it does: [Architecture](architecture.md). Onboarding itself is a two-party exchange — some steps are the participant's, some are the Hub operator's, and knowing which is which saves troubleshooting waits that are by design. Before starting, read [the choreography](https://github.com/mojaloop/ml-deployment-toolkit/blob/main/doc/architecture/participant-integration.md#the-choreography) once, end to end; the hub side of the journey is owned by MDK's [Participant guide](https://github.com/mojaloop/ml-deployment-toolkit/blob/main/doc/participant/index.md).

- [Prerequisites](#prerequisites)
- [1. Get credentials and choose the FQDN](#1-get-credentials-and-choose-the-fqdn)
- [2. Configure `.env`](#2-configure-env)
- [3. Generate bootstrap certificates](#3-generate-bootstrap-certificates)
- [4. Start the stack](#4-start-the-stack)
- [5. Enrol — the pause is not a failure](#5-enrol--the-pause-is-not-a-failure)
- [6. Verify](#6-verify)
- [Reference: ports](#reference-ports)
- [Reference: observability (`obs` profile)](#reference-observability-obs-profile)
- [Reference: certificate trust — the scheme CA](#reference-certificate-trust--the-scheme-ca)
- [Reference: notes](#reference-notes)

## Prerequisites

- Docker Compose v2 and `openssl` on the host
- The participant created on the hub side — the Hub operator has created the account and the activation email has arrived
- The hub endpoint values, handed over out of band (see the [table below](#2-configure-env))
- A host reachable from the hub on inbound `:443`, with outbound `:443` to the hub endpoints

## 1. Get credentials and choose the FQDN

**Credentials.** From the activation email, the participant activates the account, logs in, and generates its own OAuth2 client credentials — the secret is shown once and becomes `AUTH_CLIENT_SECRET`. The hub *cannot* generate or read it: the authorization model grants credential access to members of that participant only, with no hub-admin traversal ([why](https://github.com/mojaloop/ml-deployment-toolkit/blob/main/doc/architecture/security.md#authorization-model)). If someone offers to send a client secret, something is wrong.

**FQDN.** The participant chooses a fully-qualified domain name and publishes it in **its own** DNS zone, pointing at the address where the SDK's inbound `:443` is reachable. Publish it now: it must resolve publicly *before* enrolment — the hub registers it as the participant's callback address and pins it by name, and enrolment fails if it does not resolve. The hub never manages DNS on the participant's behalf.

## 2. Configure `.env`

```bash
cd docker            # from the repository root
cp .env.sample .env
$EDITOR .env
```

One table covers every variable — where its value comes from, and its shape on a hub:

| Variable | Source | What it is — shape on a hub |
| --- | --- | --- |
| `DFSP_ID` | Hub operator | The participant's scheme identifier, e.g. `dfsp-201` |
| `AUTH_CLIENT_ID` | Hub operator | Same value as `DFSP_ID` — the scheme identifier doubles as the OAuth2 `client_id` |
| `DFSP_CURRENCIES` | Hub operator | ISO 4217 code; must match a currency the scheme is configured for |
| `MCM_SERVER_ENDPOINT` | Hub operator | Connection Manager API — `https://mcm.ext.<hub-domain>/pm4mlapi`. Keep the `/pm4mlapi` suffix: the hub gateway rewrites it to the MCM API's internal `/api` prefix, and dropping it breaks enrolment |
| `HUB_IAM_PROVIDER_URL` | Hub operator | OAuth2 issuer (Ory Hydra) — `https://hydra.ext.<hub-domain>`. Bare issuer URL with no path; the MCM Agent appends `oauth2/token` itself |
| `HUB_EXTAPI_FQDN` | Hub operator | Hub FSPIOP endpoint — `extapi.<hub-domain>`. Bare hostname, no scheme, no port; ITK dials it on `:443` over mTLS |
| `AUTH_CLIENT_SECRET` | Participant | Generated in step 1; shown once |
| `DFSP_FQDN` | Participant | The FQDN published in step 1 |
| `BACKEND_ENDPOINT` | Participant | Core connector `host:port`. Defaults to `sim-backend:3000` for the `test` profile |
| `OBS_REMOTE_WRITE_URL`, `OBS_LOKI_URL` | Participant | Observability backend endpoints (`obs` profile only) — see [observability](#reference-observability-obs-profile) |
| `HOST_PORT_*` | Participant | Host port mappings (override defaults) |

Participant-facing hub services live on externally-reachable `*.ext.<hub-domain>` hosts; internal `*.int` hosts are for the Hub operator, and a participant is never expected to reach one. The hub-operator rows mirror the hub side of MDK's [interface contract](https://github.com/mojaloop/ml-deployment-toolkit/blob/main/doc/architecture/participant-integration.md#interface-contract) — the authoritative statement of what crosses the boundary.

The DFSP config is seeded into Vault on first boot only. To re-seed, run `docker compose down -v` to drop the `vault-data` volume.

## 3. Generate bootstrap certificates

```bash
../scripts/gen-bootstrap-certs.sh ./secrets
```

These are throwaway self-signed placeholders that satisfy the SDK's start-up file checks — the MCM Agent replaces the live TLS context and JWS keys at runtime once enrolment completes, with no restart. Details: [notes](#reference-notes).

## 4. Start the stack

```bash
# Local test (with the bundled simulator as core-banking stand-in)
docker compose --profile test up -d

# Production (the participant's core banking system; set BACKEND_ENDPOINT first)
docker compose up -d
```

Tear down:

```bash
docker compose --profile test down -v   # -v also drops the vault volume
```

## 5. Enrol — the pause is not a failure

Once the stack starts, the MCM Agent authenticates, submits a certificate signing request, and then **stops and waits**. This is the single most-reported "problem" that is not one.

Two distinct human actions must happen on the hub side before the agent can advance:

1. The Hub operator **signs the participant's CSR** — this issues the client certificate.
2. The Hub operator **triggers onboarding** — this is what actually creates the participant in the scheme: the central-ledger record, its net debit cap, its funded settlement account, its registered endpoints.

Until both happen, the participant exists in MCM but not in the ledger, and no transfer involving it can settle — even if mTLS comes up. Once they do, the agent advances on its own and reports **fully synced**; the SDK picks up the live certificates over its control channel without a restart.

If the agent sits at "pending signature" for a long time, that is a coordination step — confirm with the Hub operator before troubleshooting the participant side. The full sequence, with these steps numbered, is in [the choreography](https://github.com/mojaloop/ml-deployment-toolkit/blob/main/doc/architecture/participant-integration.md#the-choreography).

## 6. Verify

"Fully synced" in the MCM Agent's log means the mTLS link is live in both directions — it does not yet prove a transfer can settle (onboarding into the ledger is the hub-side step above). End-to-end verification — a party lookup, a quote, a transfer against the hub — is walked through in MDK's [Verify page](https://github.com/mojaloop/ml-deployment-toolkit/blob/main/doc/participant/integrate/verify.md), and day-2 operation (renewal, health, swapping the bundled simulator for the participant's core banking system) in [Running](https://github.com/mojaloop/ml-deployment-toolkit/blob/main/doc/participant/operate/running.md).

## Reference: ports

| Port | Service | Notes |
| --- | --- | --- |
| `${HOST_PORT_SDK_INBOUND}` | SDK FSPIOP inbound (mTLS from hub) | default `443` |
| `${HOST_PORT_SDK_OUTBOUND}` | SDK outbound API | default `4001` |
| `${HOST_PORT_MCM}` | MCM Agent HTTP | default `3001` |
| `${HOST_PORT_VAULT}` | Vault UI / API | default `8200` |
| `${HOST_PORT_REDIS}` | Redis | default `6379` |
| `${HOST_PORT_SIM}` | Simulator backend API | `test` profile only |
| `${HOST_PORT_SIM_TEST}` | Simulator test API (`/repository/parties`) | `test` profile only |

## Reference: observability (`obs` profile)

Opt-in profile that ships telemetry to the participant's own observability backend — any Prometheus remote-write + Loki pair. It adds two services: **Grafana Alloy** (scrapes SDK and host metrics, tails all container logs, forwards both) and **redis-exporter** (Redis cache health). No extra host ports. This is participant-internal networking; nothing is shared with the hub.

| Value | `.env` variable | Backend requirement |
|---|---|---|
| Metrics endpoint | `OBS_REMOTE_WRITE_URL` | Prometheus remote-write receiver |
| Logs endpoint | `OBS_LOKI_URL` | Loki push API |

```bash
docker compose --profile test --profile obs up -d   # profiles combine
```

All shipped series and log streams are labelled `cluster_name=<DFSP_ID>`. Note that the Alloy agent skips TLS verification toward these endpoints (they may sit behind a private CA). See [`docker/observability/config.alloy`](../docker/observability/config.alloy) for exactly what is collected.

## Reference: certificate trust — the scheme CA

The hub operates its own certificate authority (in Vault) for FSPIOP traffic. Consequences on the participant side:

- The hub's `extapi` endpoint presents a certificate signed by the **scheme CA, not a public authority**. The participant's SDK trusts it because enrolment delivers the hub CA into its trust context. Validating that endpoint against the public trust store — with `curl`, for instance — fails by design.
- A certificate-trust failure toward the hub points at the hub CA in the participant's trust context, not at a public-certificate problem.
- The hub's endpoint certificate rotates automatically; the participant's client certificate is long-lived and renewed by the MCM Agent. Neither rotation requires operator action — but the agent must be running for the participant's renewal to happen.

Details: [certificate lifecycle](https://github.com/mojaloop/ml-deployment-toolkit/blob/main/doc/architecture/participant-integration.md#certificate-lifecycle).

## Reference: notes

- **Bootstrap PEMs**: `secrets/inbound-{cacert,cert,key}.pem`, `secrets/jwsSigningKey.key`, and `secrets/jwsVerificationKeys/_placeholder.pub` exist only to satisfy the SDK's file-path requirements at boot. MCM Agent overrides the live TLS context and JWS keys via the PM4ML WebSocket once it connects. Don't reuse them as real material.
- **Vault auth**: AppRole only. The `vault-init` one-shot job writes `role-id` / `secret-id` into the `vault-creds` volume; the MCM Agent reads them from `/vault/role-id` and `/vault/secret-id`.
- **Vault recovery**: unseal key and root token live in the `vault-data` volume at `/vault/data/{unseal-key,root-token}`. Back these up to preserve Vault state across full teardowns.
