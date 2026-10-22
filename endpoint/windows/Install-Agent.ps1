param([ValidateSet('Plan', 'Install', 'Uninstall')][string]$Action = 'Plan', [switch]$Start)
$ErrorActionPreference = 'Stop'
$project = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$startup = [Environment]::GetFolderPath('Startup')
$shortcutFile = Join-Path $startup 'DLP-Laboratorio.lnk'
$launcher = Join-Path $PSScriptRoot 'Start-Agent.ps1'
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
if ($Action -eq 'Plan') {
    @{ action = 'Plan'; project = $project; shortcut = $shortcutFile; scope = 'Inicio de sesión del usuario actual; no instala un controlador ni un servicio privilegiado'; changesSystemControls = $false } | ConvertTo-Json
    exit 0
}
$shell = New-Object -ComObject WScript.Shell
if (Test-Path -LiteralPath $shortcutFile) {
    $existing = $shell.CreateShortcut($shortcutFile)
    if ($existing.Arguments -notlike ('*' + $launcher + '*')) { throw 'Existe un acceso directo con ese nombre que no pertenece a este proyecto.' }
}
if ($Action -eq 'Uninstall') {
    if (Test-Path -LiteralPath $shortcutFile) { Remove-Item -LiteralPath $shortcutFile }
    Write-Output 'Arranque automático retirado. El agente activo, la configuración y los registros se conservan. Los controles generales se restauran con System-Controls.ps1 -Action Restore.'
    exit 0
}
Get-Command node.exe -ErrorAction Stop | Out-Null
if (-not (Test-Path -LiteralPath (Join-Path $project 'node_modules\express'))) { throw 'Instala las dependencias con npm.cmd ci antes de configurar el inicio automático.' }
$shortcut = $shell.CreateShortcut($shortcutFile)
$shortcut.TargetPath = $powershell
$shortcut.Arguments = '-NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $launcher + '"'
$shortcut.WorkingDirectory = $project
$shortcut.Description = 'Agente DLP de laboratorio. Estado y cobertura en http://127.0.0.1:3001'
$shortcut.WindowStyle = 7
$shortcut.Save()
if ($Start) { & $launcher -ProjectDirectory $project }
Write-Output 'Arranque al iniciar sesión configurado para el usuario actual.'
