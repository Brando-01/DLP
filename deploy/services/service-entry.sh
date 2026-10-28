#!/bin/sh
set -eu
[ -n "${DLP_LAB_PASSWORD:-}" ] || { echo 'Falta password de laboratorio generado por setup' >&2; exit 1; }
printf 'dlplab:%s\n' "$DLP_LAB_PASSWORD" | chpasswd
mkdir -p /logs/suricata /logs/samba
case "$1" in
  samba)
    chown dlplab:dlplab /srv/Finanzas
    [ -e /srv/Finanzas/privado.txt ] || printf 'DNI: 12345678\nDocumento ficticio de Finanzas\n' > /srv/Finanzas/privado.txt
    printf '%s\n%s\n' "$DLP_LAB_PASSWORD" "$DLP_LAB_PASSWORD" | smbpasswd -s -a dlplab >/dev/null
    printf 'if $programname == "smbd_audit" then /logs/samba/audit.log\n& stop\n' > /etc/rsyslog.d/dlp.conf
    rsyslogd
    exec smbd --foreground --no-process-group --debug-stdout --configfile=/config/smb.conf
    ;;
  ftp)
    chown dlplab:dlplab /srv/ftp
    # vsftpd exige configuracion propiedad de root; el bind mount del proyecto
    # pertenece al usuario del host Docker y debe copiarse antes de usarlo.
    cp /config/vsftpd.conf /etc/vsftpd-dlp.conf
    chown root:root /etc/vsftpd-dlp.conf
    chmod 600 /etc/vsftpd-dlp.conf
    exec vsftpd /etc/vsftpd-dlp.conf
    ;;
  ssh)
    ssh-keygen -A
    chown dlplab:dlplab /home/dlplab/receipts
    exec /usr/sbin/sshd -D -e -f /config/sshd_config
    ;;
  *) exit 1 ;;
esac
