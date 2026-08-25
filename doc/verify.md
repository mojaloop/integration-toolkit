# Verify

[README](../README.md) / Verify

**Audience:** participant (DFSP) operator

Confirm the connection works — from the agent state, to a party lookup, to a completed transfer. Commands run from the `docker/` directory, like the rest of the deploy flow.

- [The connection is live](#the-connection-is-live)
- [Register a test party](#register-a-test-party)
- [Send a test transfer](#send-a-test-transfer)
- [The three phases — driving a transfer the production way](#the-three-phases--driving-a-transfer-the-production-way)
- [If a transfer fails](#if-a-transfer-fails)

## The connection is live

The MCM Agent reports **fully synced** after the Hub operator signs the CSR and triggers onboarding. Confirm the stack is healthy:

```bash
docker compose ps                  # every service Up
docker compose logs -f mcm-agent
```

At this point the SDK holds a live, hub-signed certificate and trusts the hub CA. mTLS is established in both directions.

Ask the Hub operator to confirm their side: the participant should appear in the hub's Finance Portal with a position and a net debit cap. Until the operator's onboarding step ran, the participant exists in the Connection Manager but not in the ledger — and no transfer will settle.

## Register a test party

To be found by other participants, register a party against the scheme's oracle. Using the bundled simulator (`test` profile), create the customer record on the simulator's **test API** (`HOST_PORT_SIM_TEST`, default `3004`), then register its identifier through the SDK's outbound API (`HOST_PORT_SDK_OUTBOUND`, default `4001`).

```bash
# Create the party in the simulator backend (test API port)
curl -X POST http://localhost:3004/repository/parties \
  -H 'content-type: application/json' \
  -d '{"displayName":"Test User","firstName":"Test","middleName":"A","lastName":"User",
       "dateOfBirth":"1990-01-01","idType":"MSISDN","idValue":"<msisdn>"}'

# Register it so other participants can discover it
curl -X POST http://localhost:4001/accounts \
  -H 'content-type: application/json' \
  -d '[{"idType":"MSISDN","idValue":"<msisdn>"}]' | jq .
```

The simulator's test API requires the full party object — every field above, including `middleName` and `dateOfBirth`. The accounts entry needs only `idType` and `idValue` on the pinned SDK version; SDK builds older than the pin required a per-item `currency` as well, which is one more reason the pin is a floor.

Every entry in the response must show success. A failure here almost always means the **oracle was not registered on the hub** — that is the Hub operator's setup, not the participant's. Raise it with them.

Only a party that will **receive** needs registering. A sender's identifier is supplied in the transfer itself.

## Send a test transfer

With another participant registered as payee, send through the SDK's outbound API:

```bash
curl -X POST http://localhost:4001/transfers \
  -H 'content-type: application/json' \
  -d '{
    "homeTransactionId": "'"$(uuidgen)"'",
    "from": {"idType":"MSISDN","idValue":"<payer-msisdn>","displayName":"Test Payer","fspId":"<DFSP_ID>"},
    "to":   {"idType":"MSISDN","idValue":"<payee-msisdn>"},
    "amountType":"SEND", "currency":"<currency>", "amount":"10",
    "transactionType":"TRANSFER"
  }' | jq .
```

**Expected:** `"currentState": "COMPLETED"`. The response carries the whole exchange — party lookup, quote, and transfer — which completes in a few seconds end to end; on a warm hub the round trip is on the order of a second.

The Hub operator can confirm from their side that positions moved by the transfer amount.

## The three phases — driving a transfer the production way

The one-shot `/transfers` call above chains discovery, agreement, and fulfilment with no opportunity to stop, which is exactly right for proving the connection. A production core-banking integration does not use it: it needs to stop twice — after discovery, to confirm the payee is who the customer meant, and after the quote, to show the customer the terms and obtain consent before money moves. Each phase is one call to the SDK outbound API; the caller owns the identifiers, and carries two artifacts from phase 2 into phase 3 untouched.

### Phase 1 — Discovery: who serves the payee

```bash
PARTY=$(curl -s http://localhost:4001/parties/MSISDN/<payee-msisdn> \
  -H 'accept: application/json')
PAYEE_FSP=$(echo "$PARTY" | jq -r '.party.body.partyIdInfo.fspId')
```

The response names the payee's FSP and carries the party's name — the value the customer confirms before anything else happens. Nothing is reserved or committed; discovery is safe to repeat. The result is short-lived routing information, not something to cache across transfers.

### Phase 2 — Agreement: the quote is the contract

The caller mints `quoteId` and `transactionId` (UUIDs) and asks the payee side for terms:

```bash
QUOTE=$(curl -s -X POST http://localhost:4001/quotes \
  -H 'content-type: application/json' \
  -d '{
    "fspId": "'"$PAYEE_FSP"'",
    "quotesPostRequest": {
      "quoteId": "'"$(uuidgen | tr 'A-Z' 'a-z')"'",
      "transactionId": "'"$TRANSACTION_ID"'",
      "payer": { "partyIdInfo": { "partyIdType": "MSISDN", "partyIdentifier": "<payer-msisdn>", "fspId": "<DFSP_ID>" } },
      "payee": { "partyIdInfo": { "partyIdType": "MSISDN", "partyIdentifier": "<payee-msisdn>", "fspId": "'"$PAYEE_FSP"'" } },
      "amountType": "SEND",
      "amount": { "amount": "10", "currency": "<currency>" },
      "transactionType": { "scenario": "TRANSFER", "initiator": "PAYER", "initiatorType": "CONSUMER" }
    }
  }')
ILP_PACKET=$(echo "$QUOTE" | jq -r '.quotes.body.ilpPacket')
CONDITION=$(echo "$QUOTE" | jq -r '.quotes.body.condition')
```

The response is the payee side's binding offer: the amount breakdown including any fees — what the customer accepts or declines — plus two cryptographic artifacts, `ilpPacket` and `condition`, which *are* the agreed terms. A quote carries its own expiration; a customer who walks away simply lets it lapse, and nothing has moved.

### Phase 3 — Fulfilment: execute the agreed quote

```bash
curl -s -X POST http://localhost:4001/simpleTransfers \
  -H 'content-type: application/json' \
  -d '{
    "fspId": "'"$PAYEE_FSP"'",
    "transfersPostRequest": {
      "transferId": "'"$TRANSACTION_ID"'",
      "payerFsp": "<DFSP_ID>",
      "payeeFsp": "'"$PAYEE_FSP"'",
      "amount": { "amount": "10", "currency": "<currency>" },
      "ilpPacket": "'"$ILP_PACKET"'",
      "condition": "'"$CONDITION"'",
      "expiration": "<now + 60s, ISO 8601>"
    }
  }' | jq .
```

`transferId` is conventionally the `transactionId` from phase 2 — that is what links the transfer to its agreement end to end. `ilpPacket` and `condition` travel **byte-for-byte as received**: they are cryptographically bound to the quote, so any re-encoding or re-serialization makes the fulfilment fail. The `expiration` is short — around 60 seconds — so a transfer that cannot complete expires cleanly instead of hanging. This is the only phase where positions move; success is the payee's fulfilment coming back and the ledger committing.

### What the caller owns, and what it must not touch

| Caller mints | Carried verbatim |
| --- | --- |
| `quoteId`, `transactionId` (= `transferId`), `expiration`, trace context | `fspId` from discovery; `ilpPacket` and `condition` from the quote |

One more habit worth adopting from the start: pass the same [`traceparent`](https://www.w3.org/TR/trace-context/) header on all three calls. The hub joins them into one end-to-end trace, so its transfer-journey dashboards see one transfer instead of three fragments.

## If a transfer fails

Where it fails narrows the cause:

| Fails at | Likely cause |
|----------|-------------|
| Party lookup | Payee not registered, or the scheme's oracle is missing on the hub — the latter is the Hub operator's to fix |
| Quote | Connectivity, or the payee participant is not reachable |
| Transfer, with a signature error | Message signing. Check the SDK image against the pin first — older builds produce signatures the hub rejects. If the version is right, the counterparty's key registration is the next suspect; raise it with the Hub operator with the transfer details |
| Anything mTLS — connection refused, certificate errors | See [Operate → certificates](operate.md#certificate-renewal) |
