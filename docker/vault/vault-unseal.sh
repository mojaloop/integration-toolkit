#!/bin/sh
# Keeps Vault unsealed across Vault and host restarts.
#
# vault-init runs once per `docker compose up` and exits, so after a host
# reboot (or a Vault container restart) Vault comes back sealed and the
# mcm-agent cannot start. This loop unseals it with the key vault-init stored
# on first initialisation.
#
# Lab-grade: the unseal key sits in the vault-data volume next to the data it
# protects. Production uses auto-unseal (KMS/HSM/transit) instead.

VAULT_ADDR="${VAULT_ADDR:-http://vault:8200}"
KEY_FILE="${UNSEAL_KEY_FILE:-/vault/data/unseal-key}"
INTERVAL="${UNSEAL_INTERVAL_SECONDS:-5}"

while true; do
    STATUS=$(curl -s --max-time 3 "$VAULT_ADDR/v1/sys/seal-status" || true)
    case "$STATUS" in
        *'"sealed":true'*)
            if [ -s "$KEY_FILE" ]; then
                echo "$(date -u +%FT%TZ) Vault is sealed, unsealing"
                curl -s --max-time 3 -X PUT -d "{\"key\": \"$(cat "$KEY_FILE")\"}" \
                    "$VAULT_ADDR/v1/sys/unseal" > /dev/null || true
            else
                echo "$(date -u +%FT%TZ) Vault is sealed and no unseal key yet (first start: vault-init will initialise)"
            fi
            ;;
    esac
    sleep "$INTERVAL"
done
