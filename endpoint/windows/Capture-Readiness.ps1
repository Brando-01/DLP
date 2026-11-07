param([string]$ProjectDirectory)
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop
$project=if($ProjectDirectory){[IO.Path]::GetFullPath($ProjectDirectory)}else{[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))}
$base=Join-Path $project '.venv\Lib\site-packages\mitmproxy_windows'
$binaries=@()
foreach($name in @('windows-redirector.exe','WinDivert.dll','WinDivert64.sys')) {
  $file=Join-Path $base $name
  if(Test-Path -LiteralPath $file -PathType Leaf) {
    $signature=Get-AuthenticodeSignature -LiteralPath $file
    $binaries+=@{name=$name;present=$true;signature=[string]$signature.Status;sha256=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash}
  } else {$binaries+=@{name=$name;present=$false;signature='MISSING'}}
}
$admin=(New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
@{readOnly=$true;administrator=$admin;binaries=$binaries;driverStarted=$false;certificateInstalled=$false;firewallChanged=$false} | ConvertTo-Json -Depth 5
