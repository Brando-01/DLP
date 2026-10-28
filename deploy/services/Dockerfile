FROM debian:trixie-slim
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends samba smbclient rsyslog vsftpd openssh-server dnsmasq suricata iptables curl ca-certificates python3 netcat-openbsd && rm -rf /var/lib/apt/lists/* && useradd -m -s /bin/bash dlplab && mkdir -p /run/sshd /srv/Finanzas /srv/ftp /home/dlplab/receipts /logs/suricata
CMD ["sleep", "infinity"]
