# Operate

[README](../README.md) / Operate

**Audience:** participant (DFSP) operator

Keeping a connected participant healthy — health checks, certificates, the Vault volume, and swapping the simulator for the real core system. Commands run from the `docker/` directory.

- [Health](#health)
- [Certificate renewal](#certificate-renewal)
- [The Vault volume](#the-vault-volume)
- [Losing the Vault volume](#losing-the-vault-volume)
- [Replacing the simulator](#replacing-the-simulator)
- [The participant's FQDN and IP](#the-participants-fqdn-and-ip)
- [Upgrades](#upgrades)

## Health

```bash
docker compose ps                             # every service Up
docker compose logs -f mcm-agent              # enrolment and renewal activity
docker compose logs -f sdk-scheme-adapter     # FSPIOP traffic
```

The agent's log is where enrolment state, renewal, and any hub-side rejection surface. The SDK's log is where message-level problems — signing, validation, connectivity — appear.

**`docker compose ps` cannot see a sealed Vault.** The Vault healthcheck reports healthy whether the vault is sealed or not, and a sealed Vault silently bricks the connection — the agent cannot read keys, and callbacks start failing TLS with nothing obviously down. If the stack looks healthy but traffic fails, check the seal first:

```bash
docker compose exec vault vault status | grep Sealed    # must be false
```

Each side operates blind to the other's internals. If the Hub operator cannot reach the participant, the coordination channel is human — there is no shared dashboard.

## Certificate renewal

Renewal is a two-party cycle, and both halves matter:

- **The MCM Agent initiates it.** When the client certificate comes within its expiry threshold (30 days by default), the agent generates and submits a fresh CSR on its own. If the agent is down, renewal never starts — keeping it running is the participant's one standing obligation.
- **The Hub operator completes it.** The renewal CSR waits for a hub-side signature exactly like the enrolment CSR did. Once signed, the agent picks up the new certificate and pushes it to the SDK over its control channel — no restart, no traffic interruption.

The participant never manages certificate files by hand. An agent log showing a submitted CSR waiting near expiry is the cue to nudge the Hub operator, not to touch anything locally.

One thing to know about the hub's own certificate: the hub's FSPIOP endpoint presents a certificate signed by the **scheme CA, not a public authority**. The SDK trusts it because enrolment delivered the hub CA. A certificate-trust failure toward the hub therefore points at the hub CA in the participant's trust context, not at a public-certificate problem.

## The Vault volume

The `vault-data` volume holds the participant's private keys, PKI state, and the unseal key and root token (`/vault/data/{unseal-key,root-token}`). Back it up. It is the one piece of state in the stack that cannot be regenerated locally.

## Losing the Vault volume

Rebuilding the stack without the Vault volume is not a local-only recovery: the keys are gone, so the participant must **re-enrol** — and re-enrolment needs the Hub operator to act too (sign the fresh CSR, and re-run onboarding on their side so the hub's rendered certificates match the new material). Until both happen, callbacks from the hub fail TLS even though the stack looks healthy.

Plan for it as a coordinated re-onboarding, not a restart.

## Replacing the simulator

The bundled simulator stands in for a core banking system. To go live with a real one, point the SDK's backend at the participant's connector instead:

```bash
BACKEND_ENDPOINT=<connector-host:port>
```

The connector must implement the Mojaloop SDK backend API over plain HTTP — it is an internal, participant-side interface, with no TLS and no auth — and be reachable from the SDK's container network. The API is documented in the SDK scheme adapter project. Start the stack **without** the `test` profile once the real backend is in place:

```bash
docker compose up -d
```

Swapping the backend changes nothing about enrolment or mTLS — that boundary is between the SDK and the hub, and is independent of what sits behind the SDK.

## The participant's FQDN and IP

The hub reaches the participant at the registered FQDN, on port 443, over mTLS. Two things must stay stable:

- **The FQDN must keep resolving to the participant.** The hub resolves the FQDN and connects. If the host's address changes and DNS does not follow immediately, callbacks fail — keep the record accurate. A static IP makes this trivial; anything that keeps DNS current also works.
- **Changing the FQDN is a re-registration with the Hub operator**, not a silent DNS edit — the FQDN is part of what the hub has on record for the participant.

On firewalls: hub callbacks may arrive from a **different** address than the endpoint the participant dials — see [network reachability](integration.md#reference-network-reachability). Confirm the callback source address with the Hub operator when setting up allow-lists.

## Upgrades

Image versions are pinned in `.env`. The SDK pin is a floor — older builds produce JWS signatures the hub rejects — so upgrades move forward deliberately and never roll back past the pin. After changing a pin:

```bash
docker compose pull && docker compose up -d
```

The agent re-synchronises its state from the hub on reconnect; certificates and enrolment are unaffected by container recreation as long as the Vault volume survives.
