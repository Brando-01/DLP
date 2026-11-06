#!/bin/sh
set -eu
mkdir -p /ca-public
dlp_port=8080
dlp_addon=/app/integrations/proxy_addon.py
if [ "${DLP_STRICT_LISTENER:-0}" = 1 ]; then
  dlp_port=8081
  dlp_addon=/app/integrations/strict_proxy.py
  dlp_wait=0
  while [ ! -f /mitm-private/mitmproxy-ca-cert.pem ]; do
    dlp_wait=$((dlp_wait + 1)); [ "$dlp_wait" -lt 60 ] || exit 1
    sleep 1
  done
fi
mitmdump --listen-host 0.0.0.0 --listen-port "$dlp_port" --set confdir=/mitm-private --set connection_strategy=lazy --set body_size_limit=12m --set ssl_verify_upstream_trusted_ca=/ca-public/receiver-ca.pem -s "$dlp_addon" -q &
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
