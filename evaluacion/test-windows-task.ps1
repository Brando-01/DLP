# Prueba de tarea Windows con cliente ficticio; sin sensor ni firewall.
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$fixture=Join-Path $root ('tmp\task-test-'+[guid]::NewGuid().ToString())
[IO.Directory]::CreateDirectory((Join-Path $fixture 'scripts')) | Out-Null
$installer=Join-Path $root 'endpoint\windows\Install-Agent.ps1'
$node=(Get-Command node.exe -ErrorAction Stop).Source
# Este doble solo satisface el preflight: no hay credenciales ni DLP ejecutandose.
[IO.File]::WriteAllText((Join-Path $fixture 'scripts\client-autostart.js'),'console.log("cliente ficticio para registro de tarea");')
$fake=@'
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),marker=path.join(root,'child.json'),stop=path.join(root,'stop-test');
if(process.argv.includes('--stop')) {
  fs.writeFileSync(stop,'1');
  const timer=setInterval(()=>{if(!fs.existsSync(marker)){clearInterval(timer);process.exit(0)}},50);
  setTimeout(()=>process.exit(1),10000).unref();
} else {
  fs.rmSync(stop,{force:true});fs.writeFileSync(marker,JSON.stringify({pid:process.pid}));
  const timer=setInterval(()=>{if(fs.existsSync(stop)){fs.rmSync(marker,{force:true});clearInterval(timer)}},100);
  setTimeout(()=>{fs.rmSync(marker,{force:true});process.exit(1)},60000).unref();
}
'@
[IO.File]::WriteAllText((Join-Path $fixture 'scripts\agent-runner.js'),$fake)
$plan=& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer -Action Plan -ProjectDirectory $fixture | ConvertFrom-Json
function Wait-Fake([int]$DifferentFrom=0) {
    $deadline=[datetime]::UtcNow.AddSeconds(30)
    do {
        Start-Sleep -Milliseconds 200
        $marker=Join-Path $fixture 'child.json'
        if (Test-Path -LiteralPath $marker) {
            try { $value=Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json; if ($value.pid -ne $DifferentFrom) { return $value } } catch {}
        }
    } while ([datetime]::UtcNow -lt $deadline)
    throw 'El cliente ficticio no inicio dentro del plazo.'
}
try {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer -Action Install -Start -ProjectDirectory $fixture
    if ($LASTEXITCODE -ne 0) {throw 'No se registro la tarea de prueba.'}
    $task=Get-ScheduledTask -TaskName $plan.task
    if ($task.Actions.Execute -notlike '*powershell.exe' -or $task.Principal.RunLevel -ne 'Limited' -or $task.Actions.Arguments -notlike '*-WindowStyle Hidden*Run-Supervisor.ps1*' -or $task.Actions.Arguments -notlike ('*'+$node+'*')) {throw 'La tarea registrada no usa el lanzador oculto esperado.'}
    $first=Wait-Fake
    if ((Get-Process -Id $first.pid).MainWindowHandle -ne 0) {throw 'El proceso ficticio tiene una ventana principal.'}
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer -Action Install -Start -ProjectDirectory $fixture
    if ($LASTEXITCODE -ne 0) {throw 'Fallo la actualizacion de la tarea activa.'}
    $second=Wait-Fake $first.pid
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer -Action Uninstall -ProjectDirectory $fixture
    if ($LASTEXITCODE -ne 0 -or (Get-ScheduledTask -TaskName $plan.task -ErrorAction SilentlyContinue)) {throw 'No se retiro la tarea de prueba.'}
    if (Test-Path -LiteralPath (Join-Path $fixture 'child.json')) {throw 'El cliente ficticio no se detuvo.'}
    @{registered=$true;removed=$true;fakeClientStarted=$true;updatedWhileRunning=$true;hiddenLauncher=$true;systemControlsChanged=$false} | ConvertTo-Json
} finally {
    $remaining=Get-ScheduledTask -TaskName $plan.task -ErrorAction SilentlyContinue
    if ($remaining -and $remaining.Description -like ('DLP owner=*'+$fixture)) { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer -Action Uninstall -ProjectDirectory $fixture }
    $resolved=[IO.Path]::GetFullPath($fixture)
    $boundary=[IO.Path]::GetFullPath((Join-Path $root 'tmp'))+[IO.Path]::DirectorySeparatorChar
    if (-not $resolved.StartsWith($boundary,[StringComparison]::OrdinalIgnoreCase)) {throw 'Ruta de limpieza inesperada.'}
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
