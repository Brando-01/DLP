[CmdletBinding()]
param(
  [ValidateSet('Discover','Plan','Apply','Audit','Restore')][string]$Action='Plan',
  [string[]]$Programs=@(),
  [switch]$ConfirmBlockApplications
)
# Restriccion por EXE. No altera la salida predeterminada ni los navegadores.
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
$directory=Join-Path $env:ProgramData 'DLP-Laboratorio\NativeApps'
$file=Join-Path $directory 'respaldo.json'
function Is-Administrator {
  return (New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}
function Discover-Programs {
  $found=@()
  foreach ($p in @(Get-Process -Name '*WhatsApp*','*Discord*' -ErrorAction SilentlyContinue)) { try { if ($p.Path) { $found+=$p.Path } } catch {} }
  foreach ($base in @((Join-Path $env:LOCALAPPDATA 'Discord'),(Join-Path $env:LOCALAPPDATA 'WhatsApp'))) {
    if (Test-Path -LiteralPath $base) {
      $found+=@(Get-ChildItem -LiteralPath $base -Filter '*.exe' -File -ErrorAction SilentlyContinue | Where-Object {$_.BaseName -match '(?i)^(discord|whatsapp)$'} | ForEach-Object {$_.FullName})
      foreach ($version in @(Get-ChildItem -LiteralPath $base -Directory -Filter 'app-*' -ErrorAction SilentlyContinue)) {
        $found+=@(Get-ChildItem -LiteralPath $version.FullName -Filter '*.exe' -File -ErrorAction SilentlyContinue | Where-Object {$_.BaseName -match '(?i)^(discord|whatsapp)$'} | ForEach-Object {$_.FullName})
      }
    }
  }
  if (Get-Command Get-AppxPackage -ErrorAction SilentlyContinue) {
    foreach ($package in @(Get-AppxPackage | Where-Object {$_.Name -match '(?i)whatsapp|discord'})) {
      if ($package.InstallLocation -and (Test-Path -LiteralPath $package.InstallLocation)) {
        $found+=@(Get-ChildItem -LiteralPath $package.InstallLocation -File -Recurse -Filter '*.exe' -ErrorAction SilentlyContinue | Where-Object {$_.BaseName -match '(?i)^(discord|whatsapp)$'} | Select-Object -First 20 | ForEach-Object {$_.FullName})
      }
    }
  }
  return @($found | Where-Object {Test-Path -LiteralPath $_ -PathType Leaf} | Sort-Object -Unique)
}
function Save-State($value) {
  $tmp=$file+'.tmp'
  [IO.File]::WriteAllText($tmp,($value | ConvertTo-Json -Depth 8),(New-Object Text.UTF8Encoding($false)))
  if (Test-Path -LiteralPath $file) {[IO.File]::Replace($tmp,$file,$null)} else {[IO.File]::Move($tmp,$file)}
}
if ($Action -eq 'Discover') { @{programs=@(Discover-Programs);note='Revisa las rutas. Solo EXE instalados y versiones descubiertas; actualizaciones pueden requerir reaplicar.'} | ConvertTo-Json -Depth 6; exit 0 }
if ($Action -in @('Audit','Restore')) {
  if (-not (Test-Path -LiteralPath $file)) { @{state='NOT_APPLIED';configurationVerified=$false} | ConvertTo-Json; exit 0 }
  $state=Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
  if ($state.schemaVersion -ne 1 -or $state.host -ne $env:COMPUTERNAME -or $state.id -notmatch '^[a-f0-9-]{36}$') { throw 'Respaldo incompatible.' }
  if ($Action -eq 'Restore') {
    if (-not (Is-Administrator)) { throw 'Restore requiere administrador.' }
    $warnings=@()
    foreach ($r in @($state.rules)) {
      $rule=Get-NetFirewallRule -PolicyStore PersistentStore -Name $r.name -ErrorAction SilentlyContinue
      if ($rule -and $rule.Description -eq ('DLP-NATIVE owner='+$state.id)) { $rule | Remove-NetFirewallRule }
      elseif ($rule) { $warnings+=('Regla modificada: '+$r.name) }
    }
    if ($warnings.Count) {throw ('Restauracion parcial; respaldo conservado: '+($warnings -join '; '))}
    Move-Item -LiteralPath $file -Destination ($file+'.restaurado-'+(Get-Date -Format yyyyMMddHHmmss))
    @{restored=$true} | ConvertTo-Json; exit 0
  }
  $findings=@()
  if ($state.phase -ne 'APPLIED' -or -not @($state.rules).Count) {$findings+=('Perfil incompleto o sin reglas.')}
  foreach ($profile in @(Get-NetFirewallProfile)) {if ([string]$profile.Enabled -ne 'True') {$findings+=('Firewall desactivado: '+$profile.Name)}}
  foreach ($r in @($state.rules)) {
    $rule=Get-NetFirewallRule -PolicyStore ActiveStore -Name $r.name -ErrorAction SilentlyContinue
    if (-not $rule -or [string]$rule.Action -ne 'Block' -or [string]$rule.Enabled -ne 'True' -or [string]$rule.Direction -ne 'Outbound') { $findings+=('Regla de bloqueo ausente: '+$r.name); continue }
    $app=$rule | Get-NetFirewallApplicationFilter
    $address=$rule | Get-NetFirewallAddressFilter
    $port=$rule | Get-NetFirewallPortFilter
    if ($app.Program -ne $r.program -or [string]$address.RemoteAddress -ne 'Any' -or [string]$port.RemotePort -ne 'Any' -or [string]$port.Protocol -notin @('Any','256')) { $findings+=('Filtros alterados: '+$r.name) }
  }
  foreach ($installed in @(Discover-Programs)) {if ($installed -notin @($state.rules | ForEach-Object {$_.program})) {$findings+=('Version nueva sin restriccion: '+$installed)}}
  @{state=$(if ($findings.Count) {'DRIFT'} else {'CONFIGURATION_VERIFIED'});configurationVerified=($findings.Count -eq 0);findings=@($findings);networkTestsRequired=$true;sensitiveOnly=$false;scope='EXE_PATHS_ONLY'} | ConvertTo-Json -Depth 8; exit 0
}
if (-not $Programs.Count) { $Programs=@(Discover-Programs) }
$clean=@()
foreach ($program in $Programs) {
  if (-not [IO.Path]::IsPathRooted($program) -or -not (Test-Path -LiteralPath $program -PathType Leaf) -or [IO.Path]::GetExtension($program) -ne '.exe') { throw 'Se requieren rutas absolutas a EXE instalados.' }
  $clean+=(Get-Item -LiteralPath $program).FullName
}
$clean=@($clean | Sort-Object -Unique)
if ($clean.Count -gt 50) {throw 'Limite: 50 ejecutables.'}
if ($Action -eq 'Plan') { @{action='Plan';programs=@($clean);applied=$false;effect='Bloqueo de toda salida de red de esos EXE; sus mensajes y archivos publicos tambien pueden fallar.';updateLimit='Una ruta nueva requiere nueva regla. Usa Audit despues de actualizar.'} | ConvertTo-Json -Depth 6; exit 0 }
if (-not (Is-Administrator) -or -not $ConfirmBlockApplications -or -not $clean.Count) { throw 'Apply requiere administrador, aplicaciones descubiertas y -ConfirmBlockApplications.' }
if (Test-Path -LiteralPath $file) {throw 'Restaura el perfil anterior antes de aplicar otro.'}
if (Get-NetFirewallProfile | Where-Object {[string]$_.Enabled -ne 'True'}) {throw 'Activa antes Windows Firewall en todos los perfiles.'}
# Los respaldos solo pueden ser modificados por SYSTEM y administradores.
foreach ($folder in @((Join-Path $env:ProgramData 'DLP-Laboratorio'),$directory)) {
  if (Test-Path -LiteralPath $folder) {if ((Get-Item -LiteralPath $folder).Attributes -band [IO.FileAttributes]::ReparsePoint) {throw 'No se permiten enlaces en el directorio de seguridad.'}} else {[IO.Directory]::CreateDirectory($folder) | Out-Null}
  $acl=New-Object Security.AccessControl.DirectorySecurity
  $acl.SetOwner((New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')));$acl.SetAccessRuleProtection($true,$false)
  foreach ($sid in @('S-1-5-18','S-1-5-32-544','S-1-5-32-545')) {
    $rights=if ($sid -eq 'S-1-5-32-545') {[Security.AccessControl.FileSystemRights]::ReadAndExecute} else {[Security.AccessControl.FileSystemRights]::FullControl}
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($sid)),$rights,([Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'),[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow)))
  }
  Set-Acl -LiteralPath $folder -AclObject $acl
}
$state=@{schemaVersion=1;phase='PREPARING';id=[guid]::NewGuid().ToString();host=$env:COMPUTERNAME;rules=@()}
Save-State $state
try {
  foreach ($program in $clean) {
    $name='DLP-NATIVE-'+$state.id+'-'+$state.rules.Count
    $state.rules+=@{name=$name;program=$program};Save-State $state
    New-NetFirewallRule -PolicyStore PersistentStore -Name $name -DisplayName ('DLP restringir '+[IO.Path]::GetFileName($program)) -Description ('DLP-NATIVE owner='+$state.id) -Direction Outbound -Action Block -Program $program -Profile Any -Enabled True | Out-Null
  }
  $state.phase='APPLIED';Save-State $state
  @{applied=$true;networkTestsRequired=$true;sensitiveOnly=$false;programs=@($clean)} | ConvertTo-Json -Depth 6
} catch {
  foreach ($r in @($state.rules)) { $rule=Get-NetFirewallRule -PolicyStore PersistentStore -Name $r.name -ErrorAction SilentlyContinue; if ($rule -and $rule.Description -eq ('DLP-NATIVE owner='+$state.id)) {$rule | Remove-NetFirewallRule} }
  throw 'Aplicacion incompleta. Las reglas propias se retiraron; se conserva respaldo para Restore.'
}
