[CmdletBinding()]
param(
    [ValidateSet('Plan', 'Apply', 'Restore', 'Status')][string]$Action = 'Plan',
    [ValidateSet('USBWrite', 'SMBOutbound', 'Printing')][string[]]$Controls = @('USBWrite', 'SMBOutbound', 'Printing'),
    [string]$DataDirectory
)

$ErrorActionPreference = 'Stop'
if (-not $DataDirectory) { $DataDirectory = Join-Path $PSScriptRoot '..\..\datos-endpoint' }
$DataDirectory = [System.IO.Path]::GetFullPath($DataDirectory)
$backupFile = Join-Path $DataDirectory 'controles-windows-respaldo.json'
$stateFile = Join-Path $DataDirectory 'controles-windows-estado.json'
$usbKey = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\RemovableStorageDevices\{53f5630d-b6bf-11d0-94f2-00a0c91efb8b}'
$spoolerKey = 'HKLM:\SYSTEM\CurrentControlSet\Services\Spooler'

function Write-JsonAtomic([string]$File, $Value) {
    [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($File)) | Out-Null
    $temporary = $File + '.' + [guid]::NewGuid().ToString() + '.tmp'
    [System.IO.File]::WriteAllText($temporary, ($Value | ConvertTo-Json -Depth 12), (New-Object System.Text.UTF8Encoding($false)))
    if (Test-Path -LiteralPath $File) { [System.IO.File]::Replace($temporary, $File, $null) }
    else { [System.IO.File]::Move($temporary, $File) }
}

function Read-RegistryValue([string]$Key, [string]$Name) {
    try {
        $item = Get-Item -LiteralPath $Key -ErrorAction Stop
        if ($item.GetValueNames() -contains $Name) {
            return @{ exists = $true; value = $item.GetValue($Name); kind = [string]$item.GetValueKind($Name) }
        }
    } catch {}
    return @{ exists = $false; value = $null; kind = $null }
}

function Test-Administrator {
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object System.Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-Plan {
    $edition = (Read-RegistryValue 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' 'EditionID').value
    $spooler = 'No disponible'
    try { $spooler = [string](Get-Service -Name Spooler).Status } catch {}
    return @{
        action = $Action; checkedAt = [datetime]::UtcNow.ToString('o'); administrator = (Test-Administrator); edition = $edition
        scope = 'Controles generales del canal: afectan también a datos públicos. No son filtrado selectivo por contenido.'
        requested = $Controls
        usb = @{ policy = $usbKey; Deny_Write = (Read-RegistryValue $usbKey 'Deny_Write'); verification = 'Requiere Windows compatible y prueba de escritura en un USB. Puede requerir reconexión o reinicio.' }
        smb = @{ ports = 'TCP 139,445; UDP 137,138'; verification = 'No cubre SMB sobre QUIC ni protocolos alternativos. Comprobar con un recurso de prueba.' }
        printing = @{ state = $spooler; start = (Read-RegistryValue $spoolerKey 'Start'); effect = 'Detiene Spooler e impide nuevos trabajos mientras está deshabilitado; puede interrumpir trabajos existentes.' }
        backup = $backupFile
    }
}

function Restore-OwnedControls($Backup) {
    $warnings = @()
    foreach ($control in @($Backup.attempted)) {
        if ($control -eq 'USBWrite') {
            $current = Read-RegistryValue $usbKey 'Deny_Write'
            if ($current.exists -and [int]$current.value -eq 1) {
                if ($Backup.before.usb.exists) { Set-ItemProperty -LiteralPath $usbKey -Name Deny_Write -Type DWord -Value ([int]$Backup.before.usb.value) }
                else { Remove-ItemProperty -LiteralPath $usbKey -Name Deny_Write -ErrorAction SilentlyContinue }
            } elseif ($current.exists -and $current.value -ne $Backup.before.usb.value) { $warnings += 'La política USB cambió fuera del proyecto; no se sobrescribió.' }
        }
        if ($control -eq 'SMBOutbound') {
            foreach ($name in @($Backup.firewallRules)) {
                $rule = Get-NetFirewallRule -Name $name -ErrorAction SilentlyContinue
                if ($rule -and $rule.Description -eq ('DLP-LAB owner=' + $Backup.id)) { $rule | Remove-NetFirewallRule }
                elseif ($rule) { $warnings += ('Regla ajena conservada: ' + $name) }
            }
        }
        if ($control -eq 'Printing') {
            $currentStart = Read-RegistryValue $spoolerKey 'Start'
            if ($currentStart.exists -and [int]$currentStart.value -eq 4) {
                $startup = switch ([int]$Backup.before.spoolerStart.value) { 2 { 'Automatic' }; 3 { 'Manual' }; 4 { 'Disabled' }; default { throw 'Estado anterior del servicio no reconocido' } }
                Set-Service -Name Spooler -StartupType $startup
                if ($Backup.before.spoolerState -eq 'Running' -and $startup -ne 'Disabled') { Start-Service -Name Spooler }
            } elseif ([int]$currentStart.value -ne [int]$Backup.before.spoolerStart.value) { $warnings += 'La configuración de impresión cambió fuera del proyecto; no se sobrescribió.' }
        }
    }
    return ,$warnings
}

if ($Action -in @('Plan', 'Status')) {
    Get-Plan | ConvertTo-Json -Depth 10
    exit 0
}
if (-not (Test-Administrator)) { throw 'Apply y Restore requieren PowerShell como administrador. Plan no modifica el sistema.' }

if ($Action -eq 'Restore') {
    if (-not (Test-Path -LiteralPath $backupFile)) { throw 'No existe un respaldo del proyecto para restaurar.' }
    $backup = Get-Content -LiteralPath $backupFile -Raw | ConvertFrom-Json
    if ($backup.schemaVersion -ne 1 -or $backup.id -notmatch '^[a-f0-9-]{36}$') { throw 'El respaldo no es válido.' }
    $warnings = Restore-OwnedControls $backup
    $status = @{ applied = $false; restoredAt = [datetime]::UtcNow.ToString('o'); verificationRequired = $true; warnings = @($warnings) }
    Write-JsonAtomic $stateFile $status
    $archive = $backupFile + '.restaurado-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json'
    Move-Item -LiteralPath $backupFile -Destination $archive
    $status | ConvertTo-Json -Depth 8
    exit 0
}

if (Test-Path -LiteralPath $backupFile) { throw 'Ya existe un respaldo activo. Restaura los cambios anteriores antes de aplicar otro conjunto.' }
$plan = Get-Plan
if ($Controls -contains 'USBWrite' -and [string]$plan.edition -notmatch 'Professional|Enterprise|Education|IoT') { throw 'No se confirmó una edición compatible con la política de almacenamiento extraíble.' }
$id = [guid]::NewGuid().ToString()
$backup = @{
    schemaVersion = 1; id = $id; createdAt = [datetime]::UtcNow.ToString('o'); attempted = @(); completed = @()
    controls = $Controls; firewallRules = @(('DLP-LAB-' + $id + '-SMB-TCP'), ('DLP-LAB-' + $id + '-SMB-UDP'))
    before = @{ usb = $plan.usb.Deny_Write; spoolerStart = $plan.printing.start; spoolerState = $plan.printing.state }
}
Write-JsonAtomic $backupFile $backup
try {
    foreach ($control in $Controls) {
        $backup.attempted += $control
        Write-JsonAtomic $backupFile $backup
        switch ($control) {
            'USBWrite' {
                if (-not (Test-Path -LiteralPath $usbKey)) { New-Item -Path $usbKey -Force | Out-Null }
                New-ItemProperty -LiteralPath $usbKey -Name Deny_Write -PropertyType DWord -Value 1 -Force | Out-Null
            }
            'SMBOutbound' {
                New-NetFirewallRule -Name $backup.firewallRules[0] -DisplayName 'DLP laboratorio - salida SMB TCP' -Description ('DLP-LAB owner=' + $id) -Direction Outbound -Action Block -Enabled True -Profile Any -Protocol TCP -RemotePort 139,445 | Out-Null
                New-NetFirewallRule -Name $backup.firewallRules[1] -DisplayName 'DLP laboratorio - salida SMB UDP' -Description ('DLP-LAB owner=' + $id) -Direction Outbound -Action Block -Enabled True -Profile Any -Protocol UDP -RemotePort 137,138 | Out-Null
            }
            'Printing' {
                Stop-Service -Name Spooler -Force
                Set-Service -Name Spooler -StartupType Disabled
            }
        }
        $backup.completed += $control
        Write-JsonAtomic $backupFile $backup
    }
    $status = @{ applied = $true; configuredAt = [datetime]::UtcNow.ToString('o'); controls = $Controls; verificationRequired = $true; proof = 'CONFIGURACION_APLICADA_NO_EQUIVALE_A_PRUEBA_FISICA'; id = $id }
    Write-JsonAtomic $stateFile $status
    $status | ConvertTo-Json -Depth 8
} catch {
    $failure = $_.Exception.Message
    try {
        $warnings = Restore-OwnedControls $backup
        Write-JsonAtomic $stateFile @{ applied = $false; rollbackAt = [datetime]::UtcNow.ToString('o'); verificationRequired = $true; failure = $failure; warnings = @($warnings) }
    } catch { Write-JsonAtomic $stateFile @{ applied = $null; rollbackIncomplete = $true; verificationRequired = $true; failure = $failure; restoreError = $_.Exception.Message } }
    throw ('Aplicación incompleta. Consulta el respaldo y el estado antes de reintentar. ' + $failure)
}
