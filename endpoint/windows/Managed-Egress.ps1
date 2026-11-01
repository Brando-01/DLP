[CmdletBinding()]
param(
  [ValidateSet('Plan','Apply','Restore')][string]$Action = 'Plan',
  [string]$GatewayAddress = '127.0.0.1',
  [int]$ProxyPort = 8080,
  [int]$MailPort = 2525,
  [int]$ControlPort = 3100,
  [string]$CaCertificate,
  [string]$DataDirectory,
  [switch]$AllowLabFTP,
  [switch]$AllowLabSSH,
  [switch]$ConfirmLab
)
$ErrorActionPreference = 'Stop'
if (-not $DataDirectory) { $DataDirectory = Join-Path $PSScriptRoot '..\..\datos-endpoint' }
$DataDirectory = [IO.Path]::GetFullPath($DataDirectory)
$backupFile = Join-Path $DataDirectory 'salida-administrada-respaldo.json'
$address = $null
if (-not [Net.IPAddress]::TryParse($GatewayAddress, [ref]$address)) { throw 'GatewayAddress debe ser una IP explicita del laboratorio.' }
foreach ($port in @($ProxyPort,$MailPort,$ControlPort)) { if ($port -lt 1 -or $port -gt 65535) { throw 'Puerto invalido' } }
$browserKeys = @('HKLM:\SOFTWARE\Policies\Google\Chrome','HKLM:\SOFTWARE\Policies\Microsoft\Edge')
$properties = @('ProxyMode','ProxyServer','ProxyBypassList','QuicAllowed','DnsOverHttpsMode')
function Save-Backup($Value) {
  [IO.Directory]::CreateDirectory($DataDirectory) | Out-Null
  $tmp = $backupFile + '.tmp'
  [IO.File]::WriteAllText($tmp, ($Value | ConvertTo-Json -Depth 12), (New-Object Text.UTF8Encoding($false)))
  if (Test-Path -LiteralPath $backupFile) { [IO.File]::Replace($tmp, $backupFile, [NullString]::Value) } else { [IO.File]::Move($tmp, $backupFile) }
}
function Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  return (New-Object Security.Principal.WindowsPrincipal($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}
function Read-Value($Key,$Name) {
  try { $item = Get-Item -LiteralPath $Key; if ($item.GetValueNames() -contains $Name) { return @{ exists=$true; value=$item.GetValue($Name); kind=[string]$item.GetValueKind($Name) } } } catch {}
  return @{ exists=$false; value=$null; kind=$null }
}
if ($Action -eq 'Plan') {
  @{ action='Plan'; administrator=(Administrator); gateway=$GatewayAddress; proxyPort=$ProxyPort; mailPort=$MailPort; controlPort=$ControlPort; effect='Default outbound Block for all Windows firewall profiles. Allow only configured gateway ports, DNS, Wazuh and optional lab SSH/FTP. Chrome/Edge forced proxy; QUIC/DoH disabled by policy.'; backup=$backupFile; requiresIsolatedLab=$true; usb='Use System-Controls.ps1 separately'; certificateRequested=[bool]$CaCertificate } | ConvertTo-Json -Depth 5
  exit 0
}
if (-not (Administrator)) { throw 'Apply y Restore requieren PowerShell como administrador.' }
if ($Action -eq 'Apply' -and -not $ConfirmLab) { throw 'Use -ConfirmLab solo dentro del equipo de laboratorio. Cambia la salida de red de toda esa maquina.' }
function Restore-Own($backup) {
  $warnings = @()
  foreach ($prior in @($backup.disabledAllowRules)) {
    $rule = Get-NetFirewallRule -PolicyStore PersistentStore -Name $prior.name -ErrorAction SilentlyContinue
    if ($rule -and [string]$rule.Enabled -eq 'False' -and [string]$rule.Action -eq 'Allow' -and [string]$rule.Direction -eq 'Outbound' -and [string]$rule.DisplayName -eq [string]$prior.displayName) { $rule | Enable-NetFirewallRule }
    elseif ($rule -and [string]$rule.Enabled -ne 'True') { $warnings += ('Prior rule changed externally: ' + $prior.name) }
  }
  foreach ($name in @($backup.ruleNames)) {
    $rule = Get-NetFirewallRule -Name $name -ErrorAction SilentlyContinue
    if ($rule -and $rule.Description -eq ('DLP managed owner=' + $backup.id)) { $rule | Remove-NetFirewallRule }
  }
  foreach ($profile in @($backup.profiles)) {
    $current = Get-NetFirewallProfile -Name $profile.name
    if ([string]$current.DefaultOutboundAction -eq 'Block') { Set-NetFirewallProfile -Name $profile.name -DefaultOutboundAction $profile.outbound }
    else { $warnings += ('Firewall profile changed externally: ' + $profile.name) }
  }
  foreach ($value in @($backup.registry)) {
    $current = Read-Value $value.key $value.name
    if ($current.exists -and [string]$current.value -eq [string]$value.applied) {
      if ($value.before.exists) { New-ItemProperty -LiteralPath $value.key -Name $value.name -PropertyType $value.before.kind -Value $value.before.value -Force | Out-Null }
      else { Remove-ItemProperty -LiteralPath $value.key -Name $value.name }
    } else { $warnings += ('Browser policy changed externally: ' + $value.name) }
  }
  if ($backup.certificate -and -not $backup.certificate.existed) {
    $certPath = 'Cert:\LocalMachine\Root\' + $backup.certificate.thumbprint
    if (Test-Path -LiteralPath $certPath) { Remove-Item -LiteralPath $certPath }
  }
  return ,$warnings
}
if ($Action -eq 'Restore') {
  if (-not (Test-Path -LiteralPath $backupFile)) { throw 'No existe respaldo de esta instalacion.' }
  $backup = Get-Content -LiteralPath $backupFile -Raw | ConvertFrom-Json
  if ($backup.schemaVersion -ne 1 -or $backup.id -notmatch '^[a-f0-9-]{36}$') { throw 'Respaldo invalido' }
  $warnings = Restore-Own $backup
  $archive = $backupFile + '.restaurado-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
  Move-Item -LiteralPath $backupFile -Destination $archive
  @{ restored=$true; warnings=@($warnings); physicalVerificationRequired=$true } | ConvertTo-Json -Depth 5
  exit 0
}
if (Test-Path -LiteralPath $backupFile) { throw 'Ya existe respaldo activo; restaura antes de aplicar nuevamente.' }
$id = [guid]::NewGuid().ToString()
$backup = @{ schemaVersion=1; id=$id; profiles=@(); registry=@(); ruleNames=@(); certificate=$null; disabledAllowRules=@() }
$gpoAllows = @(Get-NetFirewallRule -PolicyStore ActiveStore -Direction Outbound -Action Allow -Enabled True | Where-Object { [string]$_.PolicyStoreSourceType -eq 'GroupPolicy' })
if ($gpoAllows.Count -gt 0) { throw 'Hay reglas Allow de Group Policy. Coordina su politica antes de afirmar salida exclusiva por gateway.' }
foreach ($rule in @(Get-NetFirewallRule -PolicyStore PersistentStore -Direction Outbound -Action Allow -Enabled True)) { $backup.disabledAllowRules += @{ name=[string]$rule.Name; displayName=[string]$rule.DisplayName } }
foreach ($profile in @(Get-NetFirewallProfile)) { $backup.profiles += @{ name=[string]$profile.Name; outbound=[string]$profile.DefaultOutboundAction } }
$settings = @{ ProxyMode='fixed_servers'; ProxyServer=($GatewayAddress + ':' + $ProxyPort); ProxyBypassList='localhost;127.0.0.1'; QuicAllowed=0; DnsOverHttpsMode='off' }
foreach ($key in $browserKeys) { foreach ($name in $properties) { $backup.registry += @{ key=$key; name=$name; before=(Read-Value $key $name); applied=$settings[$name] } } }
Save-Backup $backup
try {
  foreach ($key in $browserKeys) {
    if (-not (Test-Path -LiteralPath $key)) { New-Item -Path $key -Force | Out-Null }
    foreach ($name in $properties) { $type = if ($name -eq 'QuicAllowed') { 'DWord' } else { 'String' }; New-ItemProperty -LiteralPath $key -Name $name -PropertyType $type -Value $settings[$name] -Force | Out-Null }
  }
  $ports = @($ProxyPort,$MailPort,$ControlPort,1514,1515)
  if ($AllowLabSSH) { $ports += 22 }
  if ($AllowLabFTP) { $ports += 21; $ports += 30000..30009 }
  foreach ($protocol in @('TCP','UDP')) {
    $name = 'DLP-MANAGED-' + $id + '-' + $protocol
    $backup.ruleNames += $name; Save-Backup $backup
    $remotePorts = if ($protocol -eq 'TCP') { @($ports + 53 | Select-Object -Unique) } else { @(53) }
    New-NetFirewallRule -Name $name -DisplayName ('DLP managed lab ' + $protocol) -Description ('DLP managed owner=' + $id) -Direction Outbound -Action Allow -Enabled True -Profile Any -Protocol $protocol -RemoteAddress $GatewayAddress -RemotePort $remotePorts | Out-Null
  }
  if ($CaCertificate) {
    $content = [IO.File]::ReadAllText([IO.Path]::GetFullPath($CaCertificate))
    if ($content -match 'PRIVATE KEY') { throw 'No importe una clave privada como CA publica' }
    $base64 = ($content -replace '-----BEGIN CERTIFICATE-----','' -replace '-----END CERTIFICATE-----','' -replace '\s','')
    $certificate = New-Object Security.Cryptography.X509Certificates.X509Certificate2 -ArgumentList (,[Convert]::FromBase64String($base64))
    $backup.certificate = @{ thumbprint=$certificate.Thumbprint; existed=(Test-Path -LiteralPath ('Cert:\LocalMachine\Root\' + $certificate.Thumbprint)) }
    Save-Backup $backup
    $store = New-Object Security.Cryptography.X509Certificates.X509Store('Root','LocalMachine')
    $store.Open('ReadWrite'); try { $store.Add($certificate) } finally { $store.Close() }
  }
  # Se aplica al final: las reglas de acceso al gateway ya existen y hay respaldo.
  foreach ($rule in $backup.disabledAllowRules) { Disable-NetFirewallRule -PolicyStore PersistentStore -Name $rule.name }
  Set-NetFirewallProfile -Profile Domain,Private,Public -DefaultOutboundAction Block
  @{ configured=$true; id=$id; backup=$backupFile; proof='CONFIGURATION_RECEIPT_REQUIRES_NETWORK_TEST'; priorAllowRulesDisabled=$backup.disabledAllowRules.Count; verification='Test direct HTTPS, DNS, SSH, FTP and proxy paths in the isolated VM before claiming exclusive egress.' } | ConvertTo-Json
} catch {
  $failure = $_.Exception.Message
  try { Restore-Own $backup | Out-Null } catch { Write-Warning 'Restauracion automatica incompleta; use el respaldo.' }
  throw ('Aplicacion incompleta: ' + $failure)
}
