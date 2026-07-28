#!/usr/bin/env bash
# Generates bootstrap PEM files required by the SDK Scheme Adapter to start.
#
# These are throwaway self-signed materials. The SDK only reads them once at
# boot to satisfy file-path requirements; MCM Agent replaces the live TLS
# context and JWS keys at runtime via the PM4ML WebSocket.
#
# Usage: gen-bootstrap-certs.sh <output-dir>

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <output-dir>" >&2
  exit 1
fi

OUT="$1"
mkdir -p "$OUT/jwsVerificationKeys"

# --- mTLS materials: self-signed CA + server cert + key -----------------------
openssl genrsa -out "$OUT/_ca.key" 2048 2>/dev/null
openssl req -x509 -new -nodes -key "$OUT/_ca.key" -sha256 -days 3650 \
  -subj "/CN=ITK Bootstrap CA" \
  -out "$OUT/inbound-cacert.pem" 2>/dev/null

openssl genrsa -out "$OUT/inbound-key.pem" 2048 2>/dev/null
openssl req -new -key "$OUT/inbound-key.pem" \
  -subj "/CN=itk-bootstrap-sdk" \
  -out "$OUT/_server.csr" 2>/dev/null
openssl x509 -req -in "$OUT/_server.csr" \
  -CA "$OUT/inbound-cacert.pem" -CAkey "$OUT/_ca.key" -CAcreateserial \
  -out "$OUT/inbound-cert.pem" -days 365 -sha256 2>/dev/null

rm -f "$OUT/_ca.key" "$OUT/_server.csr" "$OUT/inbound-cacert.srl"

# --- JWS keys ----------------------------------------------------------------
# Signing key (replaced via WS at runtime).
openssl genrsa -out "$OUT/jwsSigningKey.key" 2048 2>/dev/null

# At least one verification key must exist or the SDK refuses to boot when
# VALIDATE_INBOUND_JWS=true. Real peer keys arrive via MCM WS.
openssl genrsa -out "$OUT/jwsVerificationKeys/_placeholder.key" 2048 2>/dev/null
openssl rsa -in "$OUT/jwsVerificationKeys/_placeholder.key" -pubout \
  -out "$OUT/jwsVerificationKeys/_placeholder.pub" 2>/dev/null
rm -f "$OUT/jwsVerificationKeys/_placeholder.key"

echo "Bootstrap PEMs generated in: $OUT"
