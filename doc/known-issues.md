# Known Issues

[README](../README.md) / Known issues

**Audience:** participant (DFSP) operator

Recurring issues on the participant side, and which of them are actually the Hub operator's to fix.

### The enrolment agent submits its CSR and then stops (MCM Agent)

**Symptoms:** The agent logs a submitted CSR and goes quiet; nothing progresses.
**Root cause:** Not a fault. The agent waits for the Hub operator to sign the CSR, and resumes on its own once they do.
**Fix/workaround:** Confirm with the Hub operator that the CSR is signed and onboarding triggered. Restarting the agent only re-submits and waits again.
**Prevention:** Treat "pending signature" as a coordination state — it is step 10 of [the choreography](https://github.com/mojaloop/ml-deployment-toolkit/blob/main/doc/architecture/participant-integration.md#the-choreography).

### The SDK exits at start-up — missing certificate files (SDK scheme adapter)

**Symptoms:** `sdk-scheme-adapter` exits immediately on first bring-up, logging missing certificate or key files.
**Root cause:** The SDK checks for certificate files at start-up; the bootstrap placeholders were never generated.
**Fix/workaround:** From `docker/`: `../scripts/gen-bootstrap-certs.sh ./secrets`, then start the stack again.
**Prevention:** Follow the deploy order in the [integration guide](integration.md#3-generate-bootstrap-certificates) — the placeholders are replaced with hub-signed material automatically after enrolment.

### The stack looks healthy but traffic fails — Vault is sealed (Vault)

**Symptoms:** `docker compose ps` shows every service Up, yet callbacks fail TLS and the agent cannot progress.
**Root cause:** The Vault healthcheck reports healthy whether the vault is sealed or not, so a sealed Vault hides behind a green stack.
**Fix/workaround:** `docker compose exec vault vault status` — if `Sealed: true`, unseal with the key from the `vault-data` volume (`/vault/data/unseal-key`).
**Prevention:** Check the seal state first whenever a healthy-looking stack stops passing traffic — see [Operate → health](operate.md#health).

### Party lookup fails — oracle not found (scheme oracle, hub side)

**Symptoms:** Registration or lookup of a party fails with an oracle error although the simulator holds the party.
**Root cause:** The scheme's oracle for that identifier type was never registered on the hub.
**Fix/workaround:** Raise it with the Hub operator — the fix is entirely on their side.
**Prevention:** None on the participant side; it is part of the hub's scheme configuration.

### A transfer fails with a signature error (JWS)

**Symptoms:** The hub or the counterparty rejects messages with a JWS validation error.
**Root cause:** Almost always an SDK image older than the pin — earlier builds produce signatures the hub rejects. Otherwise, a key-registration mismatch on the scheme side.
**Fix/workaround:** Confirm the SDK image against the `.env` pin and upgrade if below it. If the version is correct, report the transfer details to the Hub operator for a key-registration check.
**Prevention:** Never run an SDK image below the pin — see [Operate → upgrades](operate.md#upgrades).

### Callbacks time out although outbound traffic works (network)

**Symptoms:** Outbound lookups and transfers reach the hub, but hub-originated callbacks never arrive; transfers hang and expire.
**Root cause:** The hub dials the participant's FQDN on `:443`, and its callbacks may arrive from a **different source address** than the endpoint the participant dials. A stale DNS record, a closed inbound `:443`, or a firewall that admits only the `extapi` address all produce the same silence.
**Fix/workaround:** `dig +short <participant-fqdn>` must return the current inbound address; inbound `:443` must be open from the hub's **callback source address** (part of the hand-over — ask the Hub operator if not on record).
**Prevention:** Keep DNS current (a static IP makes it trivial) and allow-list the callback source address explicitly — see [network reachability](integration.md#reference-network-reachability).
