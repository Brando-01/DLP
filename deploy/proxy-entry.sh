#!/bin/sh
set -eu
mkdir -p /ca-public
mitmdump --listen-host 0.0.0.0 --listen-port 8080 --set confdir=/mitm-private --set connection_strategy=lazy --set body_size_limit=12m --set ssl_verify_upstream_trusted_ca=/ca-public/receiver-ca.pem -s /app/integrations/proxy_addon.py -q &
dlp_proxy_pid=$!
trap 'kill "$dlp_proxy_pid" 2>/dev/null || true' TERM INT EXIT
dlp_count=0
while [ ! -f /mitm-private/mitmproxy-ca-cert.pem ]; do
  kill -0 "$dlp_proxy_pid" || exit 1
  dlp_count=$((dlp_count + 1)); [ "$dlp_count" -lt 60 ] || exit 1
  sleep 1
done
# Nunca compartir mitmproxy-ca.pem: incluye la clave privada.
cp /mitm-private/mitmproxy-ca-cert.pem /ca-public/mitmproxy-ca-cert.pem
chmod 644 /ca-public/mitmproxy-ca-cert.pem
wait "$dlp_proxy_pid"
