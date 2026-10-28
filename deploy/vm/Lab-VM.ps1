[CmdletBinding()]
param([ValidateSet('Plan','Create','Start','Sync','Stop','Status','ExportCA','Verify')][string]$Action='Plan', [int]$MemoryMB=4096, [int]$CPUs=3, [int]$SSHPort=2222)
$ErrorActionPreference = 'Stop'
$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$name = 'DLP-Control-v3'
$vbox = 'C:\Program Files\Oracle\VirtualBox\VBoxManage.exe'
$vmRoot = Join-Path $project 'laboratorio\vm'
$machine = Join-Path $vmRoot $name
$key = Join-Path $vmRoot 'dlp_ed25519'
$known = Join-Path $vmRoot 'known_hosts'
$seed = Join-Path $vmRoot 'seed.iso'
$python = Join-Path $project '.venv\Scripts\python.exe'
$image = Join-Path $project 'tmp\vm-image\noble-20261017-amd64.vmdk'
$imageUrl = 'https://cloud-images.ubuntu.com/noble/20261017/noble-server-cloudimg-amd64.vmdk'
$imageHash = '9a1e3959c9f4ad9d4752101fd4ff9a43191fb7d72e61fa20e033f9fd235ce794'
$disk = Join-Path $machine 'sistema.vdi'
function VBox {
  param([string[]]$Arguments)
  & $vbox @Arguments
  if ($LASTEXITCODE -ne 0) { throw ('VirtualBox fallo: ' + ($Arguments -join ' ')) }
}
function SSH {
  param([string[]]$Arguments)
  & ssh.exe -p $SSHPort -i $key -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ('UserKnownHostsFile="' + $known + '"') -o ConnectTimeout=5 'dlpadmin@127.0.0.1' @Arguments
  if ($LASTEXITCODE -ne 0) { throw 'Fallo la conexion SSH del laboratorio' }
}
function Owned-VM {
  $registered = @(& $vbox list vms)
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo consultar VirtualBox.' }
  if (-not ($registered | Where-Object { $_.StartsWith(('"' + $name + '" '), [StringComparison]::Ordinal) })) { return $false }
  $info = & $vbox showvminfo $name --machinereadable
  if ($LASTEXITCODE -ne 0) { throw 'La VM registrada no pudo inspeccionarse.' }
  $cfg = @($info | Where-Object { $_ -like 'CfgFile=*' })[0]
  if (-not $cfg) { throw 'No se encontro la ruta de la VM.' }
  $cfgPath = $cfg.Substring(8).Trim('"').Replace('\\','\')
  if (-not [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($cfgPath)).Equals($machine, [StringComparison]::OrdinalIgnoreCase)) { throw 'Existe una VM con ese nombre que no pertenece al directorio de este proyecto.' }
  return $true
}
if ($Action -eq 'Plan') {
  @{ name=$name; directory=$machine; ramMB=$MemoryMB; CPUs=$CPUs; diskMB=24576; image=$imageUrl; SHA256=$imageHash; hostPorts=@(2222,3100,8080,2525,1514,1515,5300); scope='Nueva VM NAT, sin tocar las VM existentes ni politicas del host'; APIKey='Se conserva vacia hasta que el usuario la configure' } | ConvertTo-Json -Depth 4
  exit 0
}
if (-not (Test-Path -LiteralPath $vbox)) { throw 'Instala VirtualBox antes de usar esta alternativa.' }
if ($Action -eq 'Status') { VBox -Arguments @('showvminfo',$name); exit 0 }
if ($Action -eq 'Stop') { if (Owned-VM) { VBox -Arguments @('controlvm',$name,'acpipowerbutton') }; exit 0 }
if ($Action -eq 'Create') {
  if (Owned-VM) { throw 'La VM ya existe. Usa Start o Sync; no se sobrescribe.' }
  if ($MemoryMB -lt 3072 -or $MemoryMB -gt 8192 -or $CPUs -lt 2 -or $CPUs -gt 8) { throw 'Recursos de VM fuera del rango del laboratorio.' }
  [IO.Directory]::CreateDirectory($vmRoot) | Out-Null
  if (-not (Test-Path -LiteralPath $image)) {
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($image)) | Out-Null
    & curl.exe -L --fail --retry 2 --max-time 1200 --output $image $imageUrl
    if ($LASTEXITCODE -ne 0) { throw 'Descarga de la imagen no completada. Conserva la descarga parcial y revisa la conexion.' }
  }
  if ((Get-FileHash -LiteralPath $image -Algorithm SHA256).Hash.ToLowerInvariant() -ne $imageHash) { throw 'La imagen no coincide con el SHA256 oficial esperado.' }
  if (-not (Test-Path -LiteralPath $key)) {
    & ssh-keygen.exe -t ed25519 -f $key -N '""' -C 'DLP-laboratorio'
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo generar la clave de acceso a la VM.' }
  }
  & $python (Join-Path $PSScriptRoot 'create_seed.py') --public-key ($key + '.pub') --output $seed
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear NoCloud. Instala deploy/vm/requirements.txt en .venv.' }
  VBox -Arguments @('createvm','--platform-architecture','x86','--name',$name,'--basefolder',$vmRoot,'--ostype','Ubuntu_64','--register')
  VBox -Arguments @('modifyvm',$name,'--memory',[string]$MemoryMB,'--cpus',[string]$CPUs,'--firmware','efi','--nic1','nat','--nictype1','82540EM','--graphicscontroller','vmsvga','--vram','16','--audio-enabled','off','--clipboard-mode','disabled')
  VBox -Arguments @('clonemedium','disk',$image,$disk,'--format','VDI')
  VBox -Arguments @('modifymedium','disk',$disk,'--resize','24576')
  VBox -Arguments @('storagectl',$name,'--name','SATA','--add','sata','--controller','IntelAhci')
  VBox -Arguments @('storageattach',$name,'--storagectl','SATA','--port','0','--device','0','--type','hdd','--medium',$disk)
  VBox -Arguments @('storageattach',$name,'--storagectl','SATA','--port','1','--device','0','--type','dvddrive','--medium',$seed)
  VBox -Arguments @('modifyvm',$name,'--natpf1',('ssh,tcp,127.0.0.1,' + $SSHPort + ',,22'))
  foreach ($port in @(3100,8080,2525,1514,1515)) { VBox -Arguments @('modifyvm',$name,'--natpf1',('dlp' + $port + ',tcp,127.0.0.1,' + $port + ',,' + $port)) }
  VBox -Arguments @('modifyvm',$name,'--natpf1','dns,udp,127.0.0.1,5300,,5300')
  [IO.File]::WriteAllText((Join-Path $vmRoot 'propiedad.json'), (@{ name=$name; createdAt=[datetime]::UtcNow.ToString('o'); directory=$machine } | ConvertTo-Json))
  Write-Output 'VM creada. Inicia con -Action Start; cloud-init instalara Docker dentro de la VM.'
  exit 0
}
if (-not (Owned-VM)) { throw 'No existe la VM propia del proyecto. Usa Create.' }
if ($Action -eq 'ExportCA') {
  $certificate = @(SSH -Arguments @('cd ~/dlp && docker compose --env-file .env -f deploy/compose.yaml exec -T proxy cat /ca-public/mitmproxy-ca-cert.pem')) -join "`n"
  if ($certificate -notmatch 'BEGIN CERTIFICATE' -or $certificate -match 'PRIVATE KEY') { throw 'El proxy no devolvio una CA publica valida.' }
  $publicDirectory = Join-Path $project 'datos-control\certs-public'
  [IO.Directory]::CreateDirectory($publicDirectory) | Out-Null
  [IO.File]::WriteAllText((Join-Path $publicDirectory 'mitmproxy-ca-cert.pem'), $certificate + "`n", (New-Object Text.UTF8Encoding($false)))
  Write-Output 'CA publica exportada a datos-control/certs-public/mitmproxy-ca-cert.pem. Su instalacion en Windows es una accion separada.'
  exit 0
}
if ($Action -eq 'Verify') {
  & scp.exe -P $SSHPort -i $key -o ('UserKnownHostsFile="' + $known + '"') (Join-Path $project 'evaluacion\verify-linux.py') 'dlpadmin@127.0.0.1:~/dlp/evaluacion/verify-linux.py'
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo transferir la prueba.' }
  $testCode = 0
  try { SSH -Arguments @('cd ~/dlp && DLP_TEST_BACKEND=VIRTUALBOX python3 evaluacion/verify-linux.py') } catch { $testCode = 1; Write-Warning $_.Exception.Message }
  & scp.exe -P $SSHPort -i $key -o ('UserKnownHostsFile="' + $known + '"') 'dlpadmin@127.0.0.1:~/dlp/output/evaluacion/resultado-linux.json' (Join-Path $project 'output\evaluacion\resultado-linux.json')
  if ($LASTEXITCODE -ne 0 -or $testCode -ne 0) { throw 'La prueba Linux no esta completa; revisa resultado-linux.json y los servicios.' }
  exit 0
}
if ($Action -eq 'Start') {
  $info = & $vbox showvminfo $name --machinereadable
  if ($info -notcontains 'VMState="running"') { VBox -Arguments @('startvm',$name,'--type','headless') }
  Write-Output 'Esperando SSH del laboratorio...'
  $ready = $false
  for ($attempt=0; $attempt -lt 60; $attempt++) {
    $savedPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & ssh.exe -p $SSHPort -i $key -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ('UserKnownHostsFile="' + $known + '"') -o ConnectTimeout=3 'dlpadmin@127.0.0.1' true 2>$null
    $sshExitCode = $LASTEXITCODE
    $ErrorActionPreference = $savedPreference
    if ($sshExitCode -eq 0) { $ready=$true; break }
    Start-Sleep -Seconds 5
  }
  if (-not $ready) { throw 'SSH aun no esta listo. Consulta la consola de la VM y vuelve a ejecutar Start.' }
  SSH -Arguments @('cloud-init status --wait; sudo docker version --format ''{{.Server.Version}}''')
  Write-Output 'VM lista para Sync.'
  exit 0
}
if ($Action -eq 'Sync') {
  if (-not (Test-Path -LiteralPath (Join-Path $project '.env'))) { throw 'Ejecuta npm.cmd run setup primero.' }
  $archive = Join-Path $project 'tmp\dlp-project.tar.gz'
  & tar.exe -czf $archive --exclude='.git' --exclude='.venv' --exclude='node_modules' --exclude='tmp' --exclude='laboratorio' --exclude='datos-endpoint' --exclude='datos-control' --exclude='.env' --exclude='deploy/state' -C $project .
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo preparar el proyecto.' }
  SSH -Arguments @('mkdir -p ~/dlp && chmod 700 ~/dlp')
  & scp.exe -P $SSHPort -i $key -o ('UserKnownHostsFile="' + $known + '"') $archive 'dlpadmin@127.0.0.1:~/dlp/project.tar.gz'
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo transferir el codigo.' }
  & scp.exe -P $SSHPort -i $key -o ('UserKnownHostsFile="' + $known + '"') (Join-Path $project '.env') 'dlpadmin@127.0.0.1:~/dlp/.env'
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo transferir la configuracion privada.' }
  & scp.exe -P $SSHPort -i $key -o ('UserKnownHostsFile="' + $known + '"') (Join-Path $project 'deploy\state\authd.pass') 'dlpadmin@127.0.0.1:~/dlp/authd.pass'
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo transferir la credencial de enrolamiento.' }
  SSH -Arguments @('cd ~/dlp && chmod 600 .env authd.pass && tar -xzf project.tar.gz && mkdir -p deploy/state && cp authd.pass deploy/state/authd.pass && chmod 600 deploy/state/authd.pass && DLP_LAB_BIND=0.0.0.0 docker compose --parallel 1 --progress plain --env-file .env -f deploy/compose.yaml --profile extended --profile wazuh build && DLP_LAB_BIND=0.0.0.0 docker compose --parallel 1 --env-file .env -f deploy/compose.yaml --profile extended --profile wazuh up -d --no-build')
  Write-Output 'Despliegue solicitado. Comprueba estado y pruebas del laboratorio; la clave Groq puede seguir vacia.'
}
