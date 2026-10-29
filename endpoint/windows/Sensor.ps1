param([int]$PanelPort = 3001)

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Collections.Concurrent;
using System.IO;
using System.Threading;
public static class DlpCommandInput {
    private static readonly ConcurrentQueue<string> lines = new ConcurrentQueue<string>();
    public static volatile bool Closed;
    public static void Start() {
        var thread = new Thread(() => {
            try { string line; while ((line = Console.In.ReadLine()) != null) {
                if (line.Length > 1000000 || lines.Count >= 128) break;
                lines.Enqueue(line);
            }} finally { Closed = true; }
        });
        thread.IsBackground = true; thread.Start();
    }
    public static string Next() { string line; return lines.TryDequeue(out line) ? line : null; }
    public static bool Empty { get { return lines.IsEmpty; } }
}
public static class DlpClipboardNative {
    [DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();
    [DllImport("user32.dll")] public static extern IntPtr GetClipboardOwner();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
}
'@

function Send-Message($Value) {
    [Console]::WriteLine(($Value | ConvertTo-Json -Depth 8 -Compress))
    [Console]::Out.Flush()
}

function Get-DeviceStatus {
    $volumes = @()
    foreach ($drive in [System.IO.DriveInfo]::GetDrives()) {
        try {
            if ($drive.DriveType -in @([System.IO.DriveType]::Removable, [System.IO.DriveType]::Network)) {
                $volumes += @{ root = $drive.Name; type = [string]$drive.DriveType; ready = $drive.IsReady }
            }
        } catch {}
    }
    $printers = @()
    try { $printers = @([System.Drawing.Printing.PrinterSettings]::InstalledPrinters) } catch {}
    $interactive = [Environment]::UserInteractive -and ([System.Diagnostics.Process]::GetCurrentProcess().SessionId -gt 0)
    $clipboardState = if ($interactive) { 'OBSERVACION_REACTIVA' } else { 'SESION_NO_INTERACTIVA' }
    return @{ type = 'status'; clipboard = $clipboardState; interactive = $interactive; drives = $volumes; printers = $printers; printingObservation = $script:printStatus; notifications = [bool]$script:tray; sysmon = $script:sysmonStatus; processObservation='PERIODIC_SNAPSHOT_5_SECONDS'; processCount=$script:processes.Count }
}

function Invoke-ControlledPrint([string]$Text, [string]$Printer, [string]$OutputPath) {
    if ($Text.Length -gt 200000) { throw 'Texto demasiado largo para impresión controlada' }
    if (@([System.Drawing.Printing.PrinterSettings]::InstalledPrinters) -notcontains $Printer) { throw 'La impresora seleccionada no está instalada' }
    $document = New-Object System.Drawing.Printing.PrintDocument
    $document.PrinterSettings.PrinterName = $Printer
    if (-not $document.PrinterSettings.IsValid) { throw 'La impresora no está disponible' }
    if ($OutputPath) {
        if ($Printer -ne 'Microsoft Print to PDF') { throw 'La salida automática a archivo solo se habilita para Microsoft Print to PDF' }
        $allowedOutput = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\laboratorio\impresiones')) + [System.IO.Path]::DirectorySeparatorChar
        $fullOutput = [System.IO.Path]::GetFullPath($OutputPath)
        if (-not $fullOutput.StartsWith($allowedOutput, [StringComparison]::OrdinalIgnoreCase) -or [System.IO.Path]::GetExtension($fullOutput) -ne '.pdf') { throw 'La salida PDF debe permanecer en la carpeta de impresiones del laboratorio' }
        if (Test-Path -LiteralPath $fullOutput) { throw 'El archivo de impresión ya existe' }
        $document.PrinterSettings.PrintToFile = $true
        $document.PrinterSettings.PrintFileName = $fullOutput
    }
    $document.DocumentName = 'DLP-LAB-' + [guid]::NewGuid().ToString()
    $document.PrintController = New-Object System.Drawing.Printing.StandardPrintController
    $font = New-Object System.Drawing.Font('Consolas', 10)
    $script:printLines = New-Object 'System.Collections.Generic.Queue[string]'
    foreach ($line in ($Text -split "`r?`n")) {
        if ($line.Length -eq 0) { $script:printLines.Enqueue(' '); continue }
        for ($offset = 0; $offset -lt $line.Length; $offset += 85) {
            $script:printLines.Enqueue($line.Substring($offset, [Math]::Min(85, $line.Length - $offset)))
        }
    }
    $handler = [System.Drawing.Printing.PrintPageEventHandler]{
        param($sender, $eventArgs)
        $lineHeight = $font.GetHeight($eventArgs.Graphics)
        $y = [single]$eventArgs.MarginBounds.Top
        while ($script:printLines.Count -gt 0 -and $y + $lineHeight -le $eventArgs.MarginBounds.Bottom) {
            $eventArgs.Graphics.DrawString($script:printLines.Dequeue(), $font, [System.Drawing.Brushes]::Black, [single]$eventArgs.MarginBounds.Left, $y)
            $y += $lineHeight
        }
        $eventArgs.HasMorePages = $script:printLines.Count -gt 0
    }
    $document.add_PrintPage($handler)
    try { $document.Print(); return @{ submitted = $true; printer = $Printer; document = $document.DocumentName; outputPath = $OutputPath } }
    finally { $document.remove_PrintPage($handler); $document.Dispose(); $font.Dispose() }
}

$script:tray = $null
$script:run = $true
$script:sysmonStatus = 'NO_COMPROBADO'
$script:sysmonRecord = $null
$script:lastSysmonPoll = [datetime]::MinValue
$script:monitorClipboard = $true
$script:monitorPrinting = $false
$script:printStatus = 'NO_ACTIVADA'
$script:lastSequence = [DlpClipboardNative]::GetClipboardSequenceNumber()
$script:seenJobs = @{}
$script:processes = @{}
foreach ($nativeProcess in [Diagnostics.Process]::GetProcesses()) { try { $script:processes[[int]$nativeProcess.Id] = $nativeProcess.ProcessName } catch {} finally { $nativeProcess.Dispose() } }
$lastProcessPoll = [datetime]::UtcNow
try {
    $script:tray = New-Object System.Windows.Forms.NotifyIcon
    $script:tray.Icon = [System.Drawing.SystemIcons]::Shield
    $script:tray.Text = 'DLP de laboratorio - agente local'
    $menu = New-Object System.Windows.Forms.ContextMenuStrip
    $openItem = $menu.Items.Add('Abrir panel DLP')
    $openItem.add_Click({ Start-Process -FilePath ('http://127.0.0.1:' + $PanelPort) -WindowStyle Hidden })
    $exitItem = $menu.Items.Add('Detener agente')
    $exitItem.add_Click({ Send-Message @{ type = 'exit-request' } })
    $script:tray.ContextMenuStrip = $menu
    $script:tray.Visible = $true
} catch { $script:tray = $null }

Send-Message (Get-DeviceStatus)
[DlpCommandInput]::Start()
$lastStatus = [datetime]::UtcNow
$lastJobs = [datetime]::UtcNow

try {
    while ($script:run) {
        [System.Windows.Forms.Application]::DoEvents()
        $line = [DlpCommandInput]::Next()
        if ($null -ne $line) {
            $request = $null
            try {
                if ($line.Length -gt 1000000) { throw 'Solicitud demasiado grande' }
                $request = $line | ConvertFrom-Json
                $result = @{}
                switch ($request.action) {
                    'stop' { $script:run = $false }
                    'configure' {
                        $script:monitorClipboard = [bool]$request.clipboardMonitor
                        $script:monitorPrinting = [bool]$request.printingMonitor
                        if (-not $script:monitorClipboard) { $script:lastSequence = [DlpClipboardNative]::GetClipboardSequenceNumber() }
                        $result = @{ configured = $true }
                    }
                    'clearClipboard' {
                        if ([DlpClipboardNative]::GetClipboardSequenceNumber() -ne [uint32]$request.sequence) { throw 'El portapapeles cambió; se evita borrar contenido nuevo' }
                        [System.Windows.Forms.Clipboard]::Clear()
                        $script:lastSequence = [DlpClipboardNative]::GetClipboardSequenceNumber()
                        $result = @{ cleared = $true; sequence = $script:lastSequence; timing = 'REACTIVE' }
                    }
                    'writeClipboard' {
                        if (-not $request.text -or $request.text.Length -gt 200000) { throw 'Texto de portapapeles no válido' }
                        [System.Windows.Forms.Clipboard]::SetText([string]$request.text)
                        $script:lastSequence = [DlpClipboardNative]::GetClipboardSequenceNumber()
                        $result = @{ written = $true; sequence = $script:lastSequence }
                    }
                    'print' { $result = Invoke-ControlledPrint -Text ([string]$request.text) -Printer ([string]$request.printer) -OutputPath ([string]$request.outputPath) }
                    'notify' {
                        if ($script:tray) {
                            $script:tray.BalloonTipTitle = 'Control DLP'
                            $script:tray.BalloonTipText = ([string]$request.message).Substring(0, [Math]::Min(200, ([string]$request.message).Length))
                            $script:tray.ShowBalloonTip(3500)
                        }
                        $result = @{ notified = [bool]$script:tray }
                    }
                    'status' { $result = Get-DeviceStatus }
                    default { throw 'Acción no admitida' }
                }
                if ($request.id) { Send-Message @{ id = $request.id; ok = $true; result = $result } }
            } catch {
                if ($request -and $request.id) { Send-Message @{ id = $request.id; ok = $false; error = $_.Exception.Message } }
            }
        }
        if ([DlpCommandInput]::Closed -and [DlpCommandInput]::Empty) { break }

        if (([datetime]::UtcNow - $lastProcessPoll).TotalSeconds -ge 5) {
            $current = @{}
            foreach ($nativeProcess in [Diagnostics.Process]::GetProcesses()) { try { $current[[int]$nativeProcess.Id] = $nativeProcess.ProcessName } catch {} finally { $nativeProcess.Dispose() } }
            $changes = 0
            foreach ($processKey in @($current.Keys)) {
                if (-not $script:processes.ContainsKey($processKey) -and $changes -lt 100) { Send-Message @{type='process-observed';phase='START';processId=$processKey;program=$current[$processKey]}; $changes++ }
            }
            foreach ($processKey in @($script:processes.Keys)) {
                if (-not $current.ContainsKey($processKey) -and $changes -lt 100) { Send-Message @{type='process-observed';phase='EXIT';processId=$processKey;program=$script:processes[$processKey]}; $changes++ }
            }
            $script:processes = $current
            $lastProcessPoll = [datetime]::UtcNow
        }

        if ($script:monitorClipboard) {
            $sequence = [DlpClipboardNative]::GetClipboardSequenceNumber()
            if ($sequence -ne $script:lastSequence) {
                try {
                    $sourceProcess = 'desconocido'
                    [uint32]$processId = 0
                    [void][DlpClipboardNative]::GetWindowThreadProcessId([DlpClipboardNative]::GetClipboardOwner(), [ref]$processId)
                    if ($processId -gt 0) { try { $sourceProcess = [System.Diagnostics.Process]::GetProcessById($processId).ProcessName } catch {} }
                    if ([System.Windows.Forms.Clipboard]::ContainsText()) {
                        $text = [System.Windows.Forms.Clipboard]::GetText()
                        $partial = $text.Length -gt 200000
                        if ($partial) { $text = $text.Substring(0, 200000) }
                        Send-Message @{ type = 'clipboard'; kind = 'text'; text = $text; sequence = $sequence; process = $sourceProcess; partial = $partial }
                    } elseif ([System.Windows.Forms.Clipboard]::ContainsFileDropList()) {
                        $allFiles = [System.Windows.Forms.Clipboard]::GetFileDropList()
                        $files = @($allFiles | Select-Object -First 20)
                        Send-Message @{ type = 'clipboard'; kind = 'files'; files = $files; partial = ($allFiles.Count -gt 20); sequence = $sequence; process = $sourceProcess }
                    } else {
                        Send-Message @{ type = 'clipboard'; kind = 'unsupported'; sequence = $sequence; process = $sourceProcess }
                    }
                    $script:lastSequence = $sequence
                } catch { }
            }
        }

        if ($script:monitorPrinting -and ([datetime]::UtcNow - $lastJobs).TotalSeconds -ge 8) {
            try {
                if (-not (Get-Command Get-PrintJob -ErrorAction SilentlyContinue)) { throw 'Módulo de impresión no disponible' }
                foreach ($printer in @(Get-Printer -ErrorAction Stop | Select-Object -First 10)) {
                    foreach ($job in @(Get-PrintJob -PrinterName $printer.Name -ErrorAction Stop)) {
                        $key = $printer.Name + ':' + $job.ID + ':' + $job.SubmittedTime
                        if (-not $script:seenJobs.ContainsKey($key)) {
                            $script:seenJobs[$key] = $true
                            Send-Message @{ type = 'print-observed'; printer = $printer.Name; document = $job.DocumentName; jobId = $job.ID; timing = 'AFTER_SUBMISSION' }
                        }
                    }
                }
                $script:printStatus = 'OBSERVACION_POSTERIOR'
                if ($script:seenJobs.Count -gt 1000) { $script:seenJobs.Clear() }
            } catch { $script:printStatus = 'NO_DISPONIBLE' }
            $lastJobs = [datetime]::UtcNow
        }
        if (([datetime]::UtcNow - $script:lastSysmonPoll).TotalSeconds -ge 5) {
            try {
                if ($null -eq $script:sysmonRecord) {
                    $log = Get-WinEvent -ListLog 'Microsoft-Windows-Sysmon/Operational' -ErrorAction Stop
                    $latest = Get-WinEvent -LogName $log.LogName -MaxEvents 1 -ErrorAction SilentlyContinue
                    $script:sysmonRecord = if ($latest) { [long]$latest.RecordId } else { [long]0 }
                }
                $query = '*[System[(EventID=1 or EventID=3 or EventID=11 or EventID=22) and EventRecordID > ' + $script:sysmonRecord + ']]'
                $events = @(Get-WinEvent -LogName 'Microsoft-Windows-Sysmon/Operational' -FilterXPath $query -Oldest -MaxEvents 100 -ErrorAction SilentlyContinue | Sort-Object RecordId)
                foreach ($nativeEvent in $events) {
                    $xml = [xml]$nativeEvent.ToXml()
                    $fields = @{}
                    foreach ($data in $xml.Event.EventData.Data) { $fields[[string]$data.Name] = [string]$data.'#text' }
                    $dnsHash = $null
                    if ($fields.QueryName) {
                        $sha = [Security.Cryptography.SHA256]::Create()
                        try { $dnsHash = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($fields.QueryName))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
                    }
                    Send-Message @{ type='sysmon-observed'; eventId=$nativeEvent.Id; recordId=$nativeEvent.RecordId; program=$fields.Image; destinationAddress=$fields.DestinationIp; destinationPort=$fields.DestinationPort; targetFile=$fields.TargetFilename; dnsNameHash=$dnsHash }
                    $script:sysmonRecord = [long]$nativeEvent.RecordId
                }
                $script:sysmonStatus = if ($events.Count -eq 100) { 'LOTE_COMPLETO_PUEDE_HABER_EVENTOS_PENDIENTES' } else { 'EVENTOS_OBSERVADOS_SIN_BLOQUEO' }
            } catch { $script:sysmonStatus = 'NO_DISPONIBLE_O_SIN_PERMISOS' }
            $script:lastSysmonPoll = [datetime]::UtcNow
        }
        if (([datetime]::UtcNow - $lastStatus).TotalSeconds -ge 10) { Send-Message (Get-DeviceStatus); $lastStatus = [datetime]::UtcNow }
        Start-Sleep -Milliseconds 200
    }
} finally {
    if ($script:tray) { $script:tray.Visible = $false; $script:tray.Dispose() }
}
