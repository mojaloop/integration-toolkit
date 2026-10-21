# Edge proxy

The edge proxy puts mutual TLS in front of the SDK instead of inside it. Each SDK instance does less work, and the SDK can run as several instances behind one participant endpoint, with load spread per request.

```
hub ──mTLS──▶ edge-envoy :443  ──HTTP, per request──▶ sdk-scheme-adapter × SDK_REPLICAS :4000
hub ◀──mTLS── edge-envoy :4080 ◀──HTTP─────────────── sdk-scheme-adapter × SDK_REPLICAS
core banking / load ──HTTP──▶ edge-envoy :4001 ──per request──▶ sdk-scheme-adapter :4001
                   edge-envoy ◀── /certs (tmpfs) ◀── edge-config-agent ◀──WebSocket── mcm-agent :4004
```

| Listener | Purpose |
|---|---|
| `:8443` (host `HOST_PORT_SDK_INBOUND`, default 443) | Terminates the hub's mTLS. A client certificate signed by the participant's CA is required. |
| `:4080` (internal) | The SDK's calls to the hub, in plain HTTP. The edge originates mTLS to `HUB_EXTAPI_FQDN`, checks the hub's server certificate against the hub CA and its name. |
| `:4001` (host `HOST_PORT_SDK_OUTBOUND`) | The SDK outbound API, for the core banking system or a load generator. |
| `:9902` (internal) | `GET /stats/prometheus` only. The admin interface listens on localhost. |

## Certificates

The MCM Agent creates the participant's keys, exchanges certificates with the hub's Connection Manager and renews them. It hands the material out only over its control WebSocket, the channel the SDK uses. `edge-config-agent` joins that channel and writes six files to the `edge-certs` volume:

| File | Content | From |
|---|---|---|
| `inbound-cert.pem`, `inbound-key.pem` | Server certificate presented to the hub | `inbound.tls.creds.cert`, `.key` |
| `inbound-ca.pem` | CA that validates the hub's client certificate | `inbound.tls.creds.ca` |
| `outbound-cert.pem`, `outbound-key.pem` | Client certificate presented to the hub | `outbound.tls.creds.cert`, `.key` |
| `outbound-ca.pem` | CA chain that validates the hub's server certificate | `outbound.tls.creds.ca` |

Updates are atomic: the files are links through a `..data` link to a timestamped directory, and the agent swaps `..data` in one rename. Envoy watches the directory and reloads on the swap, without a restart. The agent rejects material whose certificate does not match its key, and keeps the previous files.

The agent asks for the configuration only when the volume is empty. The control server answers a request by broadcasting the configuration to every connected client, and the SDK reconnects its control channel on every broadcast (see Known issues). Otherwise it listens: renewals and every SDK connection broadcast the full configuration.

The agent runs on the MCM Agent image for its WebSocket client. Retest the edge whenever `MCM_AGENT_IMAGE` changes. The agent is a stopgap until the MCM Agent can write this material itself.

## Security boundaries

| Boundary | How |
|---|---|
| Key material | Vault, the MCM Agent and its WebSocket are on the `control` network. Only the SDK instances and the config agent join it; the edge proxy, the simulator and the observability agents cannot reach it. |
| Edge private keys | In the config agent's memory and in the `edge-certs` tmpfs volume only; never on disk. Files are mode `0400`, owned by the agent and proxy user. |
| Containers | Config agent and proxy run as a non-root user, read-only, with all capabilities dropped. |
| Edge to SDK | Plain HTTP inside the participant's host and Docker network. A declared relaxation: the SDK no longer sees the TLS session. |

## Operation

Scale the SDK:

```sh
SDK_REPLICAS=4 docker compose --profile test up -d
```

Check what the edge serves:

```sh
echo | openssl s_client -connect 127.0.0.1:443 -servername "$DFSP_FQDN" 2>/dev/null | openssl x509 -noout -subject -enddate -fingerprint -sha256
docker compose logs edge-config-agent          # one line per update, with certificate fingerprints
```

Per-replica load: `envoy_cluster_upstream_rq_total{envoy_cluster_name="sdk_inbound"}` is per cluster; per-replica request rates come from the SDK's own metrics, labelled by `instance` (container name).

Force a server certificate renewal (to test reload under load):

```sh
curl -X POST http://127.0.0.1:${HOST_PORT_MCM:-3001}/api/actions/create-server-cert
docker compose logs --since 1m edge-config-agent   # new fingerprint
```

Roll back to TLS in the SDK: check out the previous revision and run `docker compose up -d --remove-orphans`. Certificates and onboarding state live in Vault and are unaffected.

## Known issues

- **SDK control channel reconnect loop** (sdk-scheme-adapter v24.19.6 to v24.20.0, `SdkServer.js`, `restart()`). Any configuration broadcast makes the SDK rebuild its control client. Stopping the old client fires its `close` handler, which schedules another rebuild ten seconds later, indefinitely. Only the control channel is affected, not the API servers. With several SDK instances, each instance's connection triggers a broadcast, so all but the last end up in the loop. Restarting the SDK clears it until the next broadcast. Upstream fix: remove the old client's listeners before stopping it.
