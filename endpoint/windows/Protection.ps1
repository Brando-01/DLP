[CmdletBinding()]
param(
  [ValidateSet('Discover','Plan','Apply','Audit','Restore')][string]$Action='Plan',
  [string]$PolicyPath,
  [string]$DataDirectory,
  [switch]$ConfirmIsolatedEndpoint
)
# Perfil preventivo por aplicación: únicamente para un endpoint Windows aislado.
# No hay permisos generales hacia el proxy para todos los procesos.
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
if (-not $DataDirectory) { $DataDirectory=Join-Path $env:ProgramData 'DLP-Laboratorio\Protection' }
$DataDirectory=[IO.Path]::GetFullPath($DataDirectory)
$backupPath=Join-Path $DataDirectory 'proteccion-respaldo.json'
$auditPath=Join-Path $DataDirectory 'proteccion-verificacion.json'
function Save-Json($File,$Value) {
  [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($File)) | Out-Null
  $tmp=$File+'.'+[guid]::NewGuid().ToString()+'.tmp'
  [IO.File]::WriteAllText($tmp,($Value | ConvertTo-Json -Depth 16),(New-Object Text.UTF8Encoding($false)))
  if (Test-Path -LiteralPath $File) { [IO.File]::Replace($tmp,$File,$null) } else { [IO.File]::Move($tmp,$File) }
}
function Is-Administrator {
  return (New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}
function Read-Registry($Key,$Name) {
  try { $item=Get-Item -LiteralPath $Key; if ($item.GetValueNames() -contains $Name) { return @{ exists=$true; value=$item.GetValue($Name); kind=[string]$item.GetValueKind($Name) } } } catch {}
  return @{ exists=$false }
}
function Discover {
  $programs=@()
  $candidates=@(
    @{role='browser';path=($env:ProgramFiles+'\Google\Chrome\Application\chrome.exe')},
    @{role='browser';path=(${env:ProgramFiles(x86)}+'\Microsoft\Edge\Application\msedge.exe')},
    @{role='browser';path=($env:ProgramFiles+'\Mozilla Firefox\firefox.exe')}
  )
  $node=Get-Command node.exe -ErrorAction SilentlyContinue
  if ($node) { $candidates+=@{role='agent';path=$node.Source} }
  foreach ($entry in $candidates) {
    if (Test-Path -LiteralPath $entry.path -PathType Leaf) { $programs+=@{role=$entry.role;path=$entry.path} }
  }
  return @{ schemaVersion=1; gateway='REEMPLAZAR_POR_IP_PRIVADA_DEL_GATEWAY_SEPARADO'; proxyPort=8080; controlPort=3100; mailPort=2525; caCertificate='REEMPLAZAR_POR_RUTA_CA_PUBLICA_PEM'; programs=@($programs); note='Añade Thunderbird como role mail si lo utilizas. No autorices WhatsApp o Discord. Plan no modifica Windows.' }
}
if ($Action -eq 'Discover') { Discover | ConvertTo-Json -Depth 8; exit 0 }
function Restore-Profile($b) {
  $warnings=@()
  foreach ($name in @($b.ruleNames)) {
    $r=Get-NetFirewallRule -PolicyStore PersistentStore -Name $name -ErrorAction SilentlyContinue
    if ($r -and $r.Description -eq ('DLP-PROTECTION owner='+$b.id)) { $r | Remove-NetFirewallRule }
    elseif ($r) { $warnings+=('Propietario de regla cambiado: '+$name) }
  }
  foreach ($old in @($b.allowRules)) {
    $r=Get-NetFirewallRule -PolicyStore PersistentStore -Name $old.name -ErrorAction SilentlyContinue
    if ($r -and [string]$r.Action -eq 'Allow' -and [string]$r.Direction -eq 'Outbound' -and $r.DisplayName -eq $old.displayName) { $r | Enable-NetFirewallRule }
    elseif ($r) { $warnings+=('Regla cambiada externamente: '+$old.name) }
  }
  foreach ($p in @($b.profiles)) {
    $current=Get-NetFirewallProfile -Name $p.name
    if ([string]$current.DefaultOutboundAction -eq 'Block') { Set-NetFirewallProfile -Name $p.name -DefaultOutboundAction $p.outbound -Enabled $p.enabled }
    else { $warnings+=('Perfil cambiado externamente: '+$p.name) }
  }
  foreach ($v in @($b.registry)) {
    $current=Read-Registry $v.key $v.name
    if ($current.exists -and [string]$current.value -eq [string]$v.applied) {
      if ($v.before.exists) { New-ItemProperty -LiteralPath $v.key -Name $v.name -PropertyType $v.before.kind -Value $v.before.value -Force | Out-Null }
      else { Remove-ItemProperty -LiteralPath $v.key -Name $v.name }
    } else { $warnings+=('Politica cambiada externamente: '+$v.name) }
  }
  if ($b.certificate -and -not $b.certificate.existed) {
    $cert='Cert:\LocalMachine\Root\'+$b.certificate.thumbprint
    if (Test-Path -LiteralPath $cert) { Remove-Item -LiteralPath $cert }
  }
  return ,$warnings
}
if ($Action -in @('Audit','Restore')) {
  if (-not (Test-Path -LiteralPath $backupPath)) {
    @{state='NOT_APPLIED'; configurationVerified=$false; host=$env:COMPUTERNAME; checkedAt=[DateTime]::UtcNow.ToString('o'); findings=@('No hay perfil aplicado por este script.')} | ConvertTo-Json -Depth 6
    exit 0
  }
  $b=Get-Content -LiteralPath $backupPath -Raw | ConvertFrom-Json
  if ($b.schemaVersion -ne 1 -or $b.host -ne $env:COMPUTERNAME -or $b.id -notmatch '^[a-f0-9-]{36}$') { throw 'Respaldo incompatible con este equipo.' }
  if ($Action -eq 'Restore') {
    if (-not (Is-Administrator)) { throw 'Restore requiere administrador.' }
    $warnings=Restore-Profile $b
    if ($warnings.Count) { throw ('Restauracion parcial; se conserva respaldo: '+($warnings -join '; ')) }
    Move-Item -LiteralPath $backupPath -Destination ($backupPath+'.restaurado-'+(Get-Date -Format yyyyMMddHHmmss))
    Save-Json $auditPath @{state='RESTORED';host=$env:COMPUTERNAME;checkedAt=[DateTime]::UtcNow.ToString('o');configurationVerified=$false;findings=@('Perfil retirado.')}
    @{restored=$true} | ConvertTo-Json; exit 0
  }
  $findings=@()
  if ($b.phase -ne 'APPLIED' -or @($b.ruleNames).Count -lt 2) { $findings+=('Aplicacion incompleta o sin suficientes reglas.') }
  foreach ($p in @(Get-NetFirewallProfile)) { if ([string]$p.Enabled -ne 'True' -or [string]$p.DefaultOutboundAction -ne 'Block') { $findings+=('Firewall no estricto: '+$p.Name) } }
  foreach ($name in @($b.ruleNames)) {
    $rule=Get-NetFirewallRule -PolicyStore ActiveStore -Name $name -ErrorAction SilentlyContinue
    if (-not $rule -or [string]$rule.Enabled -ne 'True' -or [string]$rule.Action -ne 'Allow' -or [string]$rule.Direction -ne 'Outbound') { $findings+=('Regla ausente o modificada: '+$name); continue }
    $expected=@($b.specifications | Where-Object { $_.name -eq $name })[0]
    $app=$rule | Get-NetFirewallApplicationFilter
    $address=$rule | Get-NetFirewallAddressFilter
    $port=$rule | Get-NetFirewallPortFilter
    if ($app.Program -ne $expected.program -or @($address.RemoteAddress).Count -ne 1 -or [string]$address.RemoteAddress -ne $b.gateway -or [string]$port.RemotePort -ne [string]$expected.port -or [string]$port.Protocol -notin @('TCP','6')) { $findings+=('Filtros cambiados: '+$name) }
  }
  $unexpected=@(Get-NetFirewallRule -PolicyStore ActiveStore -Direction Outbound -Action Allow -Enabled True | Where-Object { $_.Name -notin @($b.ruleNames) })
  if ($unexpected.Count) { $findings+=('Permisos de salida adicionales: '+$unexpected.Count) }
  foreach ($v in @($b.registry)) { $actual=Read-Registry $v.key $v.name; if (-not $actual.exists -or [string]$actual.value -ne [string]$v.applied) { $findings+=('Politica alterada: '+$v.name) } }
  foreach ($entry in @($b.programs)) { if (-not (Test-Path -LiteralPath $entry.path) -or (Get-FileHash -LiteralPath $entry.path -Algorithm SHA256).Hash -ne $entry.sha256) { $findings+=('Ejecutable cambiado; revisar actualizacion: '+$entry.path) } }
  if (-not (Test-Path -LiteralPath ('Cert:\LocalMachine\Root\'+$b.certificate.thumbprint))) { $findings+=('CA de laboratorio ausente') }
  $result=@{state=$(if ($findings.Count) {'DRIFT'} else {'CONFIGURATION_VERIFIED'});configurationVerified=($findings.Count -eq 0);host=$env:COMPUTERNAME;checkedAt=[DateTime]::UtcNow.ToString('o');gateway=$b.gateway;findings=@($findings);networkTestsRequired=$true;nativeSensitiveOnly=$false}
  if (Is-Administrator) { Save-Json $auditPath $result }
  $result | ConvertTo-Json -Depth 8; exit 0
}
if (-not $PolicyPath) {
  if ($Action -ne 'Plan') { throw 'Especifica -PolicyPath.' }
  @{action='Plan';requires='Windows aislado, gateway en otro equipo/VM, cuenta de usuario estandar, CA publica y programas autorizados';existingProfile=(Test-Path -LiteralPath $backupPath);next='Discover genera una plantilla sin modificar Windows.'} | ConvertTo-Json; exit 0
}
$policy=Get-Content -LiteralPath $PolicyPath -Raw | ConvertFrom-Json
if ($policy.schemaVersion -ne 1) { throw 'Version de politica invalida.' }
$ip=$null
if (-not [Net.IPAddress]::TryParse($policy.gateway,[ref]$ip) -or $ip.AddressFamily -ne 'InterNetwork') { throw 'Gateway debe ser una IPv4 privada explicita.' }
$octets=$ip.GetAddressBytes()
if (-not ($octets[0] -eq 10 -or ($octets[0] -eq 172 -and $octets[1] -ge 16 -and $octets[1] -le 31) -or ($octets[0] -eq 192 -and $octets[1] -eq 168))) { throw 'Requiere gateway privado separado; loopback/Internet no admitidos.' }
foreach ($key in @('proxyPort','controlPort','mailPort')) { if ($policy.$key -isnot [int] -or $policy.$key -lt 1 -or $policy.$key -gt 65535) { throw 'Puertos invalidos.' } }
if (@($policy.programs).Count -lt 2 -or @($policy.programs).Count -gt 12) { throw 'Autoriza de 2 a 12 ejecutables.' }
$programs=@()
foreach ($entry in @($policy.programs)) {
  if ($entry.role -notin @('browser','agent','mail','wazuh') -or -not [IO.Path]::IsPathRooted($entry.path) -or -not (Test-Path -LiteralPath $entry.path -PathType Leaf)) { throw 'Rol o ejecutable invalido.' }
  $file=(Get-Item -LiteralPath $entry.path).FullName
  if ([IO.Path]::GetExtension($file) -ne '.exe') { throw 'Solo se autorizan ejecutables EXE.' }
  $safeRoot=$false
  foreach ($root in @($env:ProgramFiles,${env:ProgramFiles(x86)})) { if ($root -and $file.StartsWith($root.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)) { $safeRoot=$true } }
  if (-not $safeRoot) { throw 'Los ejecutables autorizados deben instalarse en Program Files, no en AppData o Descargas.' }
  if ($file -match '(?i)whatsapp|discord') { throw 'WhatsApp/Discord nativos no son conectores inspeccionables y no se autorizan en este perfil.' }
  $programs+=@{role=$entry.role;path=$file;sha256=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash}
}
if (-not @($programs | Where-Object {$_.role -eq 'browser'}).Count -or -not @($programs | Where-Object {$_.role -eq 'agent'}).Count) { throw 'Faltan navegador y agente.' }
if ($Action -eq 'Plan') { @{action='Plan';gateway=$policy.gateway;programs=@($programs);effect='Salida Block por defecto; cada EXE solo llega al puerto de su conector. Las demas aplicaciones quedan sin red. No es bloqueo selectivo por documento.';requiresIsolatedEndpoint=$true;applied=$false} | ConvertTo-Json -Depth 8; exit 0 }
if (-not (Is-Administrator) -or -not $ConfirmIsolatedEndpoint) { throw 'Apply requiere administrador y -ConfirmIsolatedEndpoint en un Windows aislado.' }
if ($DataDirectory -ne [IO.Path]::GetFullPath((Join-Path $env:ProgramData 'DLP-Laboratorio\Protection'))) { throw 'Apply conserva sus respaldos en ProgramData\DLP-Laboratorio\Protection, no en una carpeta editable del usuario.' }
foreach ($folder in @((Join-Path $env:ProgramData 'DLP-Laboratorio'),$DataDirectory)) {
  if (Test-Path -LiteralPath $folder) {
    $item=Get-Item -LiteralPath $folder
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'No se permiten enlaces en el directorio de seguridad.' }
  } else { [IO.Directory]::CreateDirectory($folder) | Out-Null }
  $acl=New-Object Security.AccessControl.DirectorySecurity
  $admins=New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')
  $acl.SetOwner($admins); $acl.SetAccessRuleProtection($true,$false)
  foreach ($sid in @('S-1-5-18','S-1-5-32-544','S-1-5-32-545')) {
    $identity=New-Object Security.Principal.SecurityIdentifier($sid)
    $rights=if ($sid -eq 'S-1-5-32-545') {[Security.AccessControl.FileSystemRights]::ReadAndExecute} else {[Security.AccessControl.FileSystemRights]::FullControl}
    $rule=New-Object Security.AccessControl.FileSystemAccessRule($identity,$rights,([Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'),[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow)
    $acl.AddAccessRule($rule)
  }
  Set-Acl -LiteralPath $folder -AclObject $acl
}
if (Test-Path -LiteralPath $backupPath) { throw 'Restaura el perfil anterior antes de aplicar otro.' }
if (Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.IPAddress -eq $policy.gateway}) { throw 'Gateway no puede ser una direccion de este mismo Windows.' }
if (Get-NetFirewallRule -PolicyStore ActiveStore -Direction Outbound -Action Allow -Enabled True | Where-Object {[string]$_.PolicyStoreSourceType -eq 'GroupPolicy'}) { throw 'Existen permisos de salida por GPO; coordina primero esa politica.' }
foreach ($entry in $programs) { if ((Get-AuthenticodeSignature -LiteralPath $entry.path).Status -ne 'Valid') { throw 'Ejecutable sin firma valida: no se aplica el perfil.' } }
foreach ($port in @($policy.proxyPort,$policy.controlPort)) { if (-not (Test-NetConnection -ComputerName $policy.gateway -Port $port -InformationLevel Quiet -WarningAction SilentlyContinue)) { throw 'Gateway inaccesible; no se aplica.' } }
$pem=[IO.File]::ReadAllText([IO.Path]::GetFullPath($policy.caCertificate))
if ($pem -match 'PRIVATE KEY') { throw 'Se necesita CA publica, nunca una clave privada.' }
$cert=New-Object Security.Cryptography.X509Certificates.X509Certificate2 -ArgumentList (,[Convert]::FromBase64String(($pem -replace '-----BEGIN CERTIFICATE-----','' -replace '-----END CERTIFICATE-----','' -replace '\s','')))
$b=@{schemaVersion=1;phase='PREPARING';id=[guid]::NewGuid().ToString();host=$env:COMPUTERNAME;gateway=$policy.gateway;ruleNames=@();specifications=@();registry=@();profiles=@();allowRules=@();programs=$programs;certificate=@{thumbprint=$cert.Thumbprint;existed=(Test-Path -LiteralPath ('Cert:\LocalMachine\Root\'+$cert.Thumbprint))}}
foreach ($p in @(Get-NetFirewallProfile)) { $b.profiles+=@{name=$p.Name;enabled=[string]$p.Enabled;outbound=[string]$p.DefaultOutboundAction} }
foreach ($r in @(Get-NetFirewallRule -PolicyStore PersistentStore -Direction Outbound -Action Allow -Enabled True)) { $b.allowRules+=@{name=$r.Name;displayName=$r.DisplayName} }
$proxy=$policy.gateway+':'+$policy.proxyPort
$values=@()
foreach ($key in @('HKLM:\SOFTWARE\Policies\Google\Chrome','HKLM:\SOFTWARE\Policies\Microsoft\Edge')) {
  foreach ($pair in @(@('ProxyMode','fixed_servers','String'),@('ProxyServer',$proxy,'String'),@('ProxyBypassList','localhost;127.0.0.1','String'),@('QuicAllowed',0,'DWord'),@('DnsOverHttpsMode','off','String'))) { $values+=@{key=$key;name=$pair[0];value=$pair[1];kind=$pair[2]} }
}
$firefox='HKLM:\SOFTWARE\Policies\Mozilla\Firefox'
foreach ($pair in @(@('Mode','manual','String'),@('Locked',1,'DWord'),@('HTTPProxy',$proxy,'String'),@('SSLProxy',$proxy,'String'),@('UseHTTPProxyForAllProtocols',1,'DWord'),@('Passthrough','localhost,127.0.0.1','String'))) { $values+=@{key=($firefox+'\Proxy');name=$pair[0];value=$pair[1];kind=$pair[2]} }
foreach ($pair in @(@('Enabled',0),@('Locked',1))) { $values+=@{key=($firefox+'\DNSOverHTTPS');name=$pair[0];value=$pair[1];kind='DWord'} }
$values+=@{key=($firefox+'\Certificates');name='ImportEnterpriseRoots';value=1;kind='DWord'}
foreach ($v in $values) { $b.registry+=@{key=$v.key;name=$v.name;before=(Read-Registry $v.key $v.name);applied=$v.value} }
Save-Json $backupPath $b
try {
  foreach ($v in $values) { if (-not (Test-Path -LiteralPath $v.key)) { New-Item -Path $v.key -Force | Out-Null }; New-ItemProperty -LiteralPath $v.key -Name $v.name -Value $v.value -PropertyType $v.kind -Force | Out-Null }
  $store=New-Object Security.Cryptography.X509Certificates.X509Store('Root','LocalMachine')
  $store.Open('ReadWrite');try {$store.Add($cert)} finally {$store.Close()}
  foreach ($entry in $programs) {
    $ports=switch ($entry.role) {browser {@($policy.proxyPort)};agent {@($policy.controlPort)};mail {@($policy.mailPort)};wazuh {@(1514,1515)}}
    foreach ($port in $ports) {
      $name='DLP-PROTECTION-'+$b.id+'-'+$b.ruleNames.Count
      $b.ruleNames+=$name; $b.specifications+=@{name=$name;program=$entry.path;port=$port}; Save-Json $backupPath $b
      New-NetFirewallRule -Name $name -DisplayName ('DLP protegido '+$entry.role) -Description ('DLP-PROTECTION owner='+$b.id) -PolicyStore PersistentStore -Direction Outbound -Action Allow -Enabled True -Profile Any -Protocol TCP -Program $entry.path -RemoteAddress $policy.gateway -RemotePort $port | Out-Null
    }
  }
  foreach ($r in $b.allowRules) { Disable-NetFirewallRule -PolicyStore PersistentStore -Name $r.name }
  Set-NetFirewallProfile -Profile Domain,Private,Public -Enabled True -DefaultOutboundAction Block
  $b.phase='APPLIED';Save-Json $backupPath $b
  Save-Json $auditPath @{state='APPLIED_UNVERIFIED';host=$env:COMPUTERNAME;checkedAt=[DateTime]::UtcNow.ToString('o');configurationVerified=$false;gateway=$b.gateway;findings=@('Ejecuta Audit y la matriz de pruebas; configurado no significa probado.')}
  @{applied=$true;configurationVerified=$false;backup=$backupPath;next='Reinicia navegadores, ejecuta Audit y valida salidas directas y proxy en el endpoint aislado.'} | ConvertTo-Json
} catch {
  $original=$_.Exception.Message
  try { Restore-Profile $b | Out-Null } catch {}
  throw ('Aplicacion fallida; respaldo conservado para Restore. '+$original)
}
