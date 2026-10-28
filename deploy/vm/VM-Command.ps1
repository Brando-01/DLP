[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Command)
$ErrorActionPreference = 'Stop'
$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$key = Join-Path $project 'laboratorio\vm\dlp_ed25519'
$known = Join-Path $project 'laboratorio\vm\known_hosts'
if (-not (Test-Path -LiteralPath $key)) { throw 'Primero crea la VM propia con Lab-VM.ps1.' }
& ssh.exe -p 2222 -i $key -o BatchMode=yes -o StrictHostKeyChecking=yes -o ('UserKnownHostsFile="' + $known + '"') -o ConnectTimeout=20 'dlpadmin@127.0.0.1' $Command
exit $LASTEXITCODE
