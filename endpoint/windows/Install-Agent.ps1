param([ValidateSet('Plan', 'Install', 'Status', 'Stop', 'Uninstall')][string]$Action = 'Plan', [switch]$Start, [string]$ProjectDirectory)
$ErrorActionPreference = 'Stop'
$project = if ($ProjectDirectory) {[System.IO.Path]::GetFullPath($ProjectDirectory)} else {[System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))}
$hash=[Security.Cryptography.SHA256]::Create()
try { $owner=([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($project.ToLowerInvariant())))).Replace('-','').Substring(0,12) } finally { $hash.Dispose() }
$taskName='DLP-Agente-'+$owner
$description='DLP owner='+$owner+'; inicio de sesion supervisado de '+$project
$runner=Join-Path $project 'scripts\agent-runner.js'
if ($Action -eq 'Plan') {
    @{action='Plan';project=$project;task=$taskName;scope='Tarea del usuario al iniciar sesion; reinicia el agente. No es servicio SYSTEM ni controlador.';changesSystemControls=$false} | ConvertTo-Json
    exit 0
}
$existing=Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing -and $existing.Description -ne $description) {throw 'La tarea existente no pertenece a esta instalacion.'}
if ($Action -eq 'Status') {
    if ($existing) { $info=Get-ScheduledTaskInfo -TaskName $taskName;@{installed=$true;task=$taskName;state=[string]$existing.State;lastResult=$info.LastTaskResult} | ConvertTo-Json }
    else {@{installed=$false;task=$taskName} | ConvertTo-Json}
    exit 0
}
$node=(Get-Command node.exe -ErrorAction Stop).Source
if ($Action -in @('Stop','Uninstall')) {
    if ($existing) {
        if ($Action -eq 'Uninstall') {Disable-ScheduledTask -TaskName $taskName | Out-Null}
        & $node $runner --stop
        if ($LASTEXITCODE -ne 0) {throw 'El supervisor no termino; se conserva la tarea deshabilitada para revisar.'}
        Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        if ($Action -eq 'Uninstall') {Unregister-ScheduledTask -TaskName $taskName -Confirm:$false}
    }
    @{stopped=$true;uninstalled=($Action -eq 'Uninstall');configurationPreserved=$true;firewallChanged=$false} | ConvertTo-Json
    exit 0
}
& $node (Join-Path $project 'scripts\client-autostart.js') check
if ($LASTEXITCODE -ne 0) {throw 'Falta inscripcion individual o dependencias del cliente.'}
$identity=[Security.Principal.WindowsIdentity]::GetCurrent().Name
$launcher=Join-Path $PSScriptRoot 'Run-Supervisor.ps1'
$powershell=Join-Path $PSHOME 'powershell.exe'
if ($existing -and $existing.State -eq 'Running') {
    & $node $runner --stop
    if ($LASTEXITCODE -ne 0) {throw 'No se pudo detener el supervisor propio para actualizarlo.'}
    Stop-ScheduledTask -TaskName $taskName
}
$actionTask=New-ScheduledTaskAction -Execute $powershell -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$launcher+'" -ProjectDirectory "'+$project+'" -NodeExecutable "'+$node+'"') -WorkingDirectory $project
$trigger=New-ScheduledTaskTrigger -AtLogOn -User $identity
$principal=New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$settings=New-ScheduledTaskSettingsSet -Hidden -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
$task=New-ScheduledTask -Action $actionTask -Trigger $trigger -Principal $principal -Settings $settings -Description $description
Register-ScheduledTask -TaskName $taskName -InputObject $task -Force | Out-Null
$shortcutFile=Join-Path ([Environment]::GetFolderPath('Startup')) 'DLP-Laboratorio.lnk'
if (Test-Path -LiteralPath $shortcutFile) {
    $shortcut=(New-Object -ComObject WScript.Shell).CreateShortcut($shortcutFile)
    if ($shortcut.Arguments -like ('*'+(Join-Path $project 'endpoint\windows\Start-Agent.ps1')+'*')) {Remove-Item -LiteralPath $shortcutFile}
}
if ($Start) {Start-ScheduledTask -TaskName $taskName}
@{installed=$true;task=$taskName;started=[bool]$Start;scope='Usuario actual, al iniciar sesion. No cambia firewall ni certificados.'} | ConvertTo-Json
