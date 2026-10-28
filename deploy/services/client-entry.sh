#!/bin/sh
set -eu
# Solo cambia el namespace de este contenedor de laboratorio.
iptables -N DLP_CLIENT 2>/dev/null || true
iptables -F DLP_CLIENT
iptables -A DLP_CLIENT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A DLP_CLIENT -d 127.0.0.1/32 -j ACCEPT
iptables -A DLP_CLIENT -d 172.30.50.11/32 -p tcp --dport 8080 -j ACCEPT
iptables -A DLP_CLIENT -d 172.30.50.12/32 -p tcp --dport 25 -j ACCEPT
iptables -A DLP_CLIENT -d 172.30.50.53/32 -p udp --dport 53 -j ACCEPT
if [ "${DLP_ALLOW_LAB_FTP:-0}" = '1' ]; then
  iptables -A DLP_CLIENT -d 172.30.50.22/32 -p tcp -m multiport --dports 21,30000:30009 -j ACCEPT
fi
if [ "${DLP_ALLOW_LAB_SSH:-0}" = '1' ]; then iptables -A DLP_CLIENT -d 172.30.50.23/32 -p tcp --dport 22 -j ACCEPT; fi
iptables -A DLP_CLIENT -j REJECT
iptables -C OUTPUT -j DLP_CLIENT 2>/dev/null || iptables -I OUTPUT 1 -j DLP_CLIENT
ip6tables -P OUTPUT DROP
echo 'Cliente DLP: salida restringida al proxy, correo y DNS del laboratorio.'
exec sleep infinity
