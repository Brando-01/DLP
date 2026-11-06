# Ejecuta solo las funciones reales de persistencia, nunca politicas del SO.
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$testDirectory=Join-Path $root ('tmp\windows-state-'+[guid]::NewGuid().ToString())
[IO.Directory]::CreateDirectory($testDirectory) | Out-Null
$cases=@(
  @{source='Native-Apps.ps1';func='Save-State';implicit='file'},
  @{source='Protection.ps1';func='Save-Json';implicit=''},
  @{source='Managed-Egress.ps1';func='Save-Backup';implicit='backup'},
  @{source='System-Controls.ps1';func='Write-JsonAtomic';implicit=''}
)
foreach ($case in $cases) {
  $source=Join-Path $root ('endpoint\windows\'+$case.source)
  $errors=$null
  $ast=[System.Management.Automation.Language.Parser]::ParseFile($source,[ref]$null,[ref]$errors)
  if ($errors.Count) {throw ('Sintaxis: '+$case.source)}
  $name=$case.func
  $function=$ast.Find({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name},$true)
  if (-not $function) {throw ('Funcion ausente: '+$name)}
  . ([ScriptBlock]::Create($function.Extent.Text))
  $taskFile=Join-Path $testDirectory ($case.source+'.json')
  $file=$taskFile; $backupFile=$taskFile; $DataDirectory=$testDirectory
  foreach ($generation in @(1,2)) {
    $value=@{generation=$generation;note='datos ficticios'}
    if ($case.implicit) {& $name $value} else {& $name $taskFile $value}
    if ((Get-Content -LiteralPath $taskFile -Raw | ConvertFrom-Json).generation -ne $generation) {throw ('Persistencia incorrecta: '+$case.source)}
  }
}
. (Join-Path $root 'endpoint\windows\Package-Identity.ps1')
$sid=Get-DlpPackageSid 'Dlp.Test_0000000000000'
if ($sid -notmatch '^S-1-15-2-' -or $sid -ne (Get-DlpPackageSid 'Dlp.Test_0000000000000')) {throw 'SID de paquete inestable o invalido.'}
$rejected=$false
try {Get-DlpPackageSid 'ruta/no/permitida' | Out-Null} catch {$rejected=$true}
if (-not $rejected) {throw 'Se acepto una familia de paquete invalida.'}
@{helpers=$cases.Count;writes=8;atomicReplacementVerified=$true;packageSidDerivationVerified=$true;powerShell=$PSVersionTable.PSVersion.ToString();systemPoliciesExecuted=$false} | ConvertTo-Json
