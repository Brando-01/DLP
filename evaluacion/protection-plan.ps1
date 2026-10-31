$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$script=Join-Path $root 'endpoint\windows\Protection.ps1'
$errors=$null
[System.Management.Automation.Language.Parser]::ParseFile($script,[ref]$null,[ref]$errors) | Out-Null
if ($errors.Count) { throw ($errors | Out-String) }
$plan=& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $script -Action Plan
if ($LASTEXITCODE -ne 0) { throw 'Plan no pudo ejecutarse.' }
$value=$plan | ConvertFrom-Json
if ($value.action -ne 'Plan') { throw 'Respuesta Plan invalida.' }
$discover=& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $script -Action Discover
if ($LASTEXITCODE -ne 0) { throw 'Discover no pudo ejecutarse.' }
$template=$discover | ConvertFrom-Json
if ($template.schemaVersion -ne 1 -or -not @($template.programs).Count) { throw 'No se descubrieron ejecutables del endpoint.' }
$temp=Join-Path $root ('tmp\protection-plan-'+[guid]::NewGuid().ToString())
[IO.Directory]::CreateDirectory($temp) | Out-Null
$file=Join-Path $temp 'politica.json'
$template.gateway='127.0.0.1'
$template | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $file -Encoding UTF8
$ErrorActionPreference='Continue'
$invalid=& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $script -Action Plan -PolicyPath $file 2>&1
$invalidExit=$LASTEXITCODE
$ErrorActionPreference='Stop'
if ($invalidExit -eq 0) { throw 'Se acepto un gateway loopback.' }
$template.gateway='192.168.56.1'
$template | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $file -Encoding UTF8
$valid=& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $script -Action Plan -PolicyPath $file
if ($LASTEXITCODE -ne 0 -or ($valid | ConvertFrom-Json).applied -ne $false) { throw 'El plan privado no se construyo correctamente.' }
$audit=& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $script -Action Audit -DataDirectory $temp
if ($LASTEXITCODE -ne 0 -or ($audit | ConvertFrom-Json).state -ne 'NOT_APPLIED') { throw 'Audit atribuyo un perfil inexistente.' }
@{powerShell=$PSVersionTable.PSVersion.ToString();parsed=$true;discover=$true;loopbackRejected=$true;privateGatewayPlan=$true;absentProfileNotVerified=$true;windowsPoliciesApplied=$false;physicalNetworkValidated=$false} | ConvertTo-Json
