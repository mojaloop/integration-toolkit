# Mojaloop Integration Toolkit

The Integration Toolkit (ITK) is what a participant — a DFSP such as a bank, mobile money operator, or payment service provider — runs on its own infrastructure to connect to a Mojaloop hub. It packages the moving parts of a scheme connection into a single stack:

- **MCM Agent** — enrols with the hub's Connection Manager and drives the certificate lifecycle
- **Vault** — holds the DFSP's private keys and PKI state
- **SDK Scheme Adapter** — speaks FSPIOP, terminates mTLS, signs and validates JWS
- **Redis** — the adapter's cache
- **Simulator backend** (test profile) — a stand-in for the participant's core banking system, replaced at go-live
- **Observability agent** (obs profile, optional) — ships metrics and logs to the participant's observability backend

Everything runs on the participant's side; the hub operator never touches it.

## Where to start

| Goal | Go to |
|---|---|
| Evaluate the toolkit — the problem it solves, the design, the trust model | [`doc/architecture.md`](doc/architecture.md) |
| Deploy the stack and connect to a hub | [`doc/integration.md`](doc/integration.md) |
| Generate the bootstrap certificates the SDK needs at first boot | [`scripts/gen-bootstrap-certs.sh`](scripts/gen-bootstrap-certs.sh) (invoked from the deploy flow) |
