[CmdletBinding()]
param([ValidateSet('Plan','Create','Start','Sync','Verify','ExportCA','Status','Stop')][string]$Action='Plan')
$ErrorActionPreference='Stop'
$project=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$name='DLP-Control-WSL'
$state=Join-Path $project 'laboratorio\wsl'
$image=Join-Path $project 'tmp\vm-image\ubuntu-24.04.5-wsl-amd64.wsl'
$url='https://releases.ubuntu.com/noble/ubuntu-24.04.5-wsl-amd64.wsl'
$sha='bb415d824822c4b878125729af451a5d18fb13d1cf5cbed9a7393ad64ac6039e'
$linuxProject='/mnt/'+$project.Substring(0,1).ToLowerInvariant()+'/'+$project.Substring(3).Replace('\','/')
if ($Action -eq 'Plan') { @{name=$name; directory=$state; image=$url; SHA256=$sha; scope='Nueva distribucion WSL2; sin cambiar Hyper-V ni distribuciones existentes'} | ConvertTo-Json; exit 0 }
if ($Action -eq 'Status') { & wsl.exe --list --verbose; exit $LASTEXITCODE }
if ($Action -eq 'Stop') { & wsl.exe --terminate $name; exit $LASTEXITCODE }
$names=((& wsl.exe --list --quiet) -join '').Replace([string][char]0,'')
if ($Action -eq 'Create') {
  if ($names.Contains($name)) { throw 'La distribucion ya existe; usa Sync. No se sobrescribe.' }
  [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($image)) | Out-Null
  if (-not (Test-Path -LiteralPath $image)) {
    & curl.exe --silent --show-error -L --fail --retry 2 --max-time 1200 -o $image $url
    if ($LASTEXITCODE -ne 0) { throw 'Descarga WSL incompleta.' }
  }
  if ((Get-FileHash -LiteralPath $image -Algorithm SHA256).Hash.ToLowerInvariant() -ne $sha) { throw 'La imagen WSL no coincide con SHA256 oficial.' }
  [IO.Directory]::CreateDirectory($state) | Out-Null
  & wsl.exe --import $name $state $image --version 2
  if ($LASTEXITCODE -ne 0) { throw 'WSL no pudo importar el laboratorio.' }
  Write-Output 'WSL del laboratorio creada. Ejecuta Sync para instalar Docker y desplegar servicios.'
  exit 0
}
if (-not $names.Contains($name)) { throw 'Primero ejecuta Create.' }
function Ensure-Active {
  $pidFile=Join-Path $state 'keeper.json'
  $alive=$false
  if (Test-Path -LiteralPath $pidFile) {
    try {
      $prior=Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
      $process=Get-CimInstance Win32_Process -Filter ('ProcessId='+[int]$prior.pid) -ErrorAction Stop
      $alive=$process -and $process.Name -eq 'wsl.exe' -and $process.CommandLine -like ('*'+$name+'*sleep*infinity*')
    } catch {}
  }
  if (-not $alive) {
    $keeper=Start-Process -FilePath wsl.exe -ArgumentList @('-d',$name,'-u','root','--exec','sleep','infinity') -WindowStyle Hidden -PassThru
    [IO.File]::WriteAllText($pidFile,(@{pid=$keeper.Id;name=$name;purpose='Mantener activa exclusivamente la distribucion del laboratorio'} | ConvertTo-Json))
  }
}
Ensure-Active
if ($Action -eq 'Start') {
  & wsl.exe -d $name -u root --exec service docker start
  if ($LASTEXITCODE -ne 0) { throw 'No inicio Docker del laboratorio.' }
  & wsl.exe -d $name -u root --cd /root/dlp --exec env DLP_LAB_BIND=0.0.0.0 docker compose --parallel 1 --env-file .env -f deploy/compose.yaml --profile extended --profile wazuh up -d --no-build
  exit $LASTEXITCODE
}
if ($Action -eq 'Sync') {
  & wsl.exe -d $name -u root --exec python3 ($linuxProject+'/deploy/wsl/provision.py') --source $linuxProject
  if ($LASTEXITCODE -ne 0) { throw 'El despliegue WSL no termino correctamente.' }
  exit 0
}
if ($Action -eq 'Verify') {
  & wsl.exe -d $name -u root --exec cp ($linuxProject+'/evaluacion/verify-linux.py') /root/dlp/evaluacion/verify-linux.py
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo actualizar la prueba.' }
  & wsl.exe -d $name -u root --exec cp -r ($linuxProject+'/evaluacion/muestras') /root/dlp/evaluacion/
  if ($LASTEXITCODE -ne 0) { throw 'No se pudieron copiar las muestras ficticias.' }
  & wsl.exe -d $name -u root --cd /root/dlp --exec env DLP_TEST_BACKEND=WSL2 python3 evaluacion/verify-linux.py
  $testCode=$LASTEXITCODE
  & wsl.exe -d $name -u root --exec cp /root/dlp/output/evaluacion/resultado-linux.json ($linuxProject+'/output/evaluacion/resultado-linux.json')
  if ($testCode -ne 0 -or $LASTEXITCODE -ne 0) { throw 'Verificacion WSL incompleta; revisar resultado-linux.json.' }
  exit 0
}
if ($Action -eq 'ExportCA') {
  $certificate=(& wsl.exe -d $name -u root --cd /root/dlp --exec docker compose --env-file .env -f deploy/compose.yaml exec -T proxy cat /ca-public/mitmproxy-ca-cert.pem) -join "`n"
  if ($LASTEXITCODE -ne 0 -or $certificate -notmatch 'BEGIN CERTIFICATE' -or $certificate -match 'PRIVATE KEY') { throw 'CA publica no disponible.' }
  $out=Join-Path $project 'datos-control\certs-public'
  [IO.Directory]::CreateDirectory($out) | Out-Null
  [IO.File]::WriteAllText((Join-Path $out 'mitmproxy-ca-cert.pem'),$certificate+"`n",(New-Object Text.UTF8Encoding($false)))
  Write-Output 'CA publica exportada; no se instalo automaticamente en Windows.'
}
