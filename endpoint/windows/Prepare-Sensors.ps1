[CmdletBinding()]
param([string]$ManagerAddress='127.0.0.1',[string]$ProtectedDirectory,[string]$DestinationDirectory)
$ErrorActionPreference='Stop'
$project=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
if (-not $ProtectedDirectory) { $ProtectedDirectory=Join-Path $project 'laboratorio\Finanzas' }
if (-not $DestinationDirectory) { $DestinationDirectory=Join-Path $project 'laboratorio\Escritorio' }
$address=$null
if (-not [Net.IPAddress]::TryParse($ManagerAddress,[ref]$address)) { throw 'Usa una IP explicita del manager de laboratorio.' }
foreach ($directory in @($ProtectedDirectory,$DestinationDirectory)) { if (-not [IO.Path]::IsPathRooted($directory)) { throw 'Las carpetas deben ser absolutas.' } }
$out=Join-Path $project 'datos-endpoint\sensores'
[IO.Directory]::CreateDirectory($out) | Out-Null
$template=[IO.File]::ReadAllText((Join-Path $project 'deploy\sysmon\sysmon-template.xml'))
$template=$template.Replace('@@PROTECTED@@',[Security.SecurityElement]::Escape([IO.Path]::GetFullPath($ProtectedDirectory))).Replace('@@DESTINATION@@',[Security.SecurityElement]::Escape([IO.Path]::GetFullPath($DestinationDirectory)))
[IO.File]::WriteAllText((Join-Path $out 'sysmon.xml'),$template,(New-Object Text.UTF8Encoding($false)))
$audit=[Security.SecurityElement]::Escape((Join-Path $project 'datos-endpoint\auditoria.jsonl'))
$manager=[Security.SecurityElement]::Escape($ManagerAddress)
$fragment='<ossec_config><client><server><address>'+ $manager +'</address><port>1514</port><protocol>tcp</protocol></server></client><localfile><location>Microsoft-Windows-Sysmon/Operational</location><log_format>eventchannel</log_format></localfile><localfile><location>'+ $audit +'</location><log_format>json</log_format></localfile></ossec_config>'
[IO.File]::WriteAllText((Join-Path $out 'wazuh-fragment.xml'),$fragment,(New-Object Text.UTF8Encoding($false)))
@{ generated=$out; installed=$false; manager=$ManagerAddress; next='Revisar XML. Instalar Sysmon y agente Wazuh oficiales en el equipo aislado; combinar fragmento con ossec.conf existente y enrolar con la credencial local. No se cambia la PC al preparar estos archivos.' } | ConvertTo-Json
