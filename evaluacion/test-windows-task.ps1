# Prueba de registro real de tarea Windows con cliente ficticio; sin sensor ni firewall.
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$fixture=Join-Path $root ('tmp\task-test-'+[guid]::NewGuid().ToString())
[IO.Directory]::CreateDirectory((Join-Path $fixture 'scripts')) | Out-Null
$installer=Join-Path $root 'endpoint\windows\Install-Agent.ps1'
$node=(Get-Command node.exe -ErrorAction Stop).Source
# Este doble solo satisface el preflight: no hay credenciales ni DLP ejecutandose.
[IO.File]::WriteAllText((Join-Path $fixture 'scripts\client-autostart.js'),'console.log("cliente ficticio para registro de tarea");')
[IO.File]::WriteAllText((Join-Path $fixture 'scripts\agent-runner.js'),'process.exitCode=0;')
$plan=& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer -Action Plan -ProjectDirectory $fixture | ConvertFrom-Json
try {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer -Action Install -ProjectDirectory $fixture
    if ($LASTEXITCODE -ne 0) {throw 'No se registro la tarea de prueba.'}
    $task=Get-ScheduledTask -TaskName $plan.task
    if ($task.Actions.Execute -ne $node -or $task.Principal.RunLevel -ne 'Limited' -or $task.Actions.Arguments -notlike '*agent-runner.js*') {throw 'La tarea registrada no coincide con el cliente ficticio.'}
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer -Action Uninstall -ProjectDirectory $fixture
    if ($LASTEXITCODE -ne 0 -or (Get-ScheduledTask -TaskName $plan.task -ErrorAction SilentlyContinue)) {throw 'No se retiro la tarea de prueba.'}
    @{registered=$true;removed=$true;agentStarted=$false;systemControlsChanged=$false} | ConvertTo-Json
} finally {
    $remaining=Get-ScheduledTask -TaskName $plan.task -ErrorAction SilentlyContinue
    if ($remaining -and $remaining.Description -like ('DLP owner=*'+$fixture)) {Unregister-ScheduledTask -TaskName $plan.task -Confirm:$false}
    $resolved=[IO.Path]::GetFullPath($fixture)
    $boundary=[IO.Path]::GetFullPath((Join-Path $root 'tmp'))+[IO.Path]::DirectorySeparatorChar
    if (-not $resolved.StartsWith($boundary,[StringComparison]::OrdinalIgnoreCase)) {throw 'Ruta de limpieza inesperada.'}
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
