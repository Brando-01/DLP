param([ValidateSet('Plan','Apply','Restore')][string]$Action='Plan')
$ErrorActionPreference='Stop'
$address='192.168.56.1'
$name='DLP-Lab-Strict-8081'
$description='DLP strict lab publication v1; VMs .101 and .102 only'
if ($Action -eq 'Plan') { @{listen=$address;port=8081;remote=@('192.168.56.101','192.168.56.102');changesOutboundPolicy=$false} | ConvertTo-Json; exit 0 }
$admin=(New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {throw 'Usa PowerShell como administrador en el servidor anfitrion para publicar solo el puerto 8081.'}
$existing=Get-NetFirewallRule -Name $name -ErrorAction SilentlyContinue
if ($existing -and $existing.Description -ne $description) {throw 'La regla existente no pertenece al laboratorio.'}
$proxy=(& netsh.exe interface portproxy show v4tov4) -join "`n"
$mapping=@($proxy -split "`n" | Where-Object {$_ -match '^\s*192\.168\.56\.1\s+8081\s+'})
if ($mapping.Count -and $mapping[0] -notmatch '^\s*192\.168\.56\.1\s+8081\s+127\.0\.0\.1\s+8081\s*$') {throw 'Hay una publicacion 8081 ajena; no se sustituye.'}
if ($Action -eq 'Restore') {
  if ($existing) { Remove-NetFirewallRule -Name $name; & netsh.exe interface portproxy delete v4tov4 listenaddress=$address listenport=8081 }
  @{publicationRemoved=$true;outboundPolicyChanged=$false} | ConvertTo-Json; exit 0
}
if (-not (Get-NetIPAddress -AddressFamily IPv4 | Where-Object IPAddress -eq $address)) {throw 'No existe la interfaz del laboratorio 192.168.56.1.'}
if (-not (Test-NetConnection 127.0.0.1 -Port 8081 -InformationLevel Quiet -WarningAction SilentlyContinue)) {throw 'Inicia primero el servicio strict-proxy de WSL.'}
if ($mapping.Count -and -not $existing) {throw 'Mapeo sin regla de propietario; revisalo antes de adoptar la publicacion.'}
if (-not $existing) { New-NetFirewallRule -Name $name -DisplayName 'DLP - Proxy estricto VM' -Description $description -Direction Inbound -Action Allow -Protocol TCP -LocalAddress $address -LocalPort 8081 -RemoteAddress 192.168.56.101,192.168.56.102 -Profile Any | Out-Null }
& netsh.exe interface portproxy add v4tov4 listenaddress=$address listenport=8081 connectaddress=127.0.0.1 connectport=8081 protocol=tcp
if ($LASTEXITCODE -ne 0) {throw 'No se pudo publicar 8081; revisar regla y portproxy.'}
@{published=$true;port=8081;changesOutboundPolicy=$false} | ConvertTo-Json
