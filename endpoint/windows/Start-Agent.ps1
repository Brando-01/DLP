param([string]$ProjectDirectory)
$ErrorActionPreference = 'Stop'
if (-not $ProjectDirectory) { $ProjectDirectory = Join-Path $PSScriptRoot '..\..' }
$ProjectDirectory = [System.IO.Path]::GetFullPath($ProjectDirectory)
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$entry = Join-Path $ProjectDirectory 'endpoint\server.js'
$data = Join-Path $ProjectDirectory 'datos-endpoint'
try {
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:3001/api/health' -TimeoutSec 2
    if ($health.service -eq 'Agente DLP local') { Write-Output 'El agente DLP ya está ejecutándose.'; exit 0 }
    throw 'El puerto 3001 está ocupado por otro servicio.'
} catch [System.Net.WebException] { }
if (-not (Test-Path -LiteralPath $entry)) { throw 'No se encontró el ejecutable del agente.' }
[System.IO.Directory]::CreateDirectory($data) | Out-Null
$process = Start-Process -FilePath $nodePath -ArgumentList @('"' + $entry + '"') -WorkingDirectory $ProjectDirectory -WindowStyle Hidden -RedirectStandardOutput (Join-Path $data 'agente-salida.log') -RedirectStandardError (Join-Path $data 'agente-errores.log') -PassThru
$receipt = @{ pid = $process.Id; startedAt = $process.StartTime.ToUniversalTime().ToString('o'); node = $nodePath }
[System.IO.File]::WriteAllText((Join-Path $data 'agente-proceso.json'), ($receipt | ConvertTo-Json), (New-Object System.Text.UTF8Encoding($false)))
Write-Output 'Agente iniciado en segundo plano. Consulta http://127.0.0.1:3001 para comprobar su estado.'
