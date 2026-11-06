param([Parameter(Mandatory=$true)][string]$ProjectDirectory, [Parameter(Mandatory=$true)][string]$NodeExecutable)
$ErrorActionPreference = 'Stop'
$project = [IO.Path]::GetFullPath($ProjectDirectory)
$runner = Join-Path $project 'scripts\agent-runner.js'
if (-not (Test-Path -LiteralPath $runner -PathType Leaf)) { throw 'Supervisor DLP no encontrado.' }
# Hidden en la tarea no oculta la consola del ejecutable. Este lanzador espera
# al supervisor sin crear una consola visible y propaga su resultado a la tarea.
$child = Start-Process -FilePath $NodeExecutable -ArgumentList ('"'+$runner+'" --mode=WINDOWS_LOGON') -WorkingDirectory $project -WindowStyle Hidden -PassThru
try { $child.WaitForExit(); exit $child.ExitCode } finally { $child.Dispose() }
