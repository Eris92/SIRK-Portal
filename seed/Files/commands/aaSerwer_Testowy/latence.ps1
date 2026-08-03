# Mesh network diagnostics: latency, NIC traffic, packet errors and active connections.
#runAsUser: 0
# The report is written to the agent TEMP directory and also streamed to Command Tabs.

[CmdletBinding()]
param(
    [int]$DurationSeconds = 120,
    [int]$IntervalSeconds = 1,
    [string]$OutputPath = (Join-Path ([Environment]::GetEnvironmentVariable("TEMP")) "MeshLatency.csv")
)

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"
$DurationSeconds = [math]::Max(5, [math]::Min($DurationSeconds, 3600))
$IntervalSeconds = [math]::Max(1, [math]::Min($IntervalSeconds, 60))

function Get-Delta {
    param([object]$Current, [object]$Previous)
    try {
        $currentValue = [uint64]$Current
        $previousValue = [uint64]$Previous
        if ($currentValue -ge $previousValue) { return ($currentValue - $previousValue) }
    } catch { }
    return [uint64]0
}

function Test-IcmpLatency {
    param([string]$Address, [int]$TimeoutMs = 2000)
    if ([string]::IsNullOrWhiteSpace($Address)) { return $null }
    $ping = New-Object System.Net.NetworkInformation.Ping
    try {
        $reply = $ping.Send($Address, $TimeoutMs)
        if ($reply.Status -eq "Success") { return [int]$reply.RoundtripTime }
    } catch { }
    finally { $ping.Dispose() }
    return $null
}

function Test-TcpLatency {
    param([string]$Address, [int]$Port, [int]$TimeoutMs = 2000)
    if ([string]::IsNullOrWhiteSpace($Address) -or $Port -le 0) { return $null }
    $client = New-Object System.Net.Sockets.TcpClient
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    $async = $null
    try {
        $async = $client.BeginConnect($Address, $Port, $null, $null)
        if (-not $async.AsyncWaitHandle.WaitOne($TimeoutMs)) { return $null }
        $client.EndConnect($async)
        $watch.Stop()
        return [math]::Round($watch.Elapsed.TotalMilliseconds, 1)
    } catch { return $null }
    finally {
        if ($async -and $async.AsyncWaitHandle) { $async.AsyncWaitHandle.Close() }
        $client.Dispose()
    }
}

function Get-ProcessLabel {
    param([int]$ProcessId)
    if ($ProcessId -le 0) { return "-" }
    try {
        $process = Get-Process -Id $ProcessId -ErrorAction Stop
        return "$($process.ProcessName)[$ProcessId]"
    } catch { return "PID $ProcessId" }
}

function Get-ServiceProcessMap {
    $map = @{}
    $services = @(Get-CimInstance Win32_Service -ErrorAction SilentlyContinue | Where-Object { $_.ProcessId -gt 0 })
    foreach ($service in $services) {
        $processIdValue = [int]$service.ProcessId
        if (-not $map.ContainsKey($processIdValue)) { $map[$processIdValue] = New-Object System.Collections.Generic.List[string] }
        if ($service.DisplayName) { $map[$processIdValue].Add([string]$service.DisplayName) }
    }
    return ,$map
}

function Get-ActiveConnectionSnapshot {
    param([hashtable]$ServiceMap)
    $connections = @(Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue)
    $actors = New-Object System.Collections.Generic.List[string]
    $groups = @($connections | Group-Object OwningProcess | Sort-Object Count -Descending | Select-Object -First 8)
    foreach ($group in $groups) {
        $processIdValue = [int]$group.Name
        $processLabel = Get-ProcessLabel -ProcessId $processIdValue
        $serviceLabel = ""
        if ($ServiceMap -and $ServiceMap.ContainsKey($processIdValue)) {
            $serviceLabel = (@($ServiceMap[$processIdValue]) -join ", ")
        }
        $endpoints = @($group.Group | Select-Object -First 3 | ForEach-Object { "$($_.RemoteAddress):$($_.RemotePort)" }) -join ","
        $actor = "$processLabel x$($group.Count)"
        if ($serviceLabel) { $actor += " {$serviceLabel}" }
        $actors.Add("$actor -> $endpoints")
    }
    $summary = @($actors) -join "; "
    if ($summary.Length -gt 1800) { $summary = $summary.Substring(0, 1800) + "..." }
    return [pscustomobject]@{
        Count = $connections.Count
        Summary = $(if ($summary) { $summary } else { "-" })
        TopActor = $(if ($groups.Count -gt 0) { Get-ProcessLabel -ProcessId ([int]$groups[0].Name) } else { "-" })
        TopActorConnections = $(if ($groups.Count -gt 0) { [int]$groups[0].Count } else { 0 })
    }
}

function Get-MeshProcessInfo {
    $service = Get-CimInstance Win32_Service -ErrorAction SilentlyContinue |
        Where-Object {
            $_.State -eq "Running" -and $_.ProcessId -gt 0 -and
            ($_.Name -match "mesh" -or $_.DisplayName -match "mesh")
        } |
        Sort-Object @{ Expression = { if ($_.Name -match "meshagent|mesh agent") { 0 } else { 1 } } } |
        Select-Object -First 1

    if ($service) {
        return [pscustomobject]@{ Pid = [int]$service.ProcessId; Name = $service.DisplayName; Source = "service" }
    }

    $process = Get-Process -ErrorAction SilentlyContinue |
        Where-Object { $_.ProcessName -match "meshagent|meshcentral|mesh" } |
        Select-Object -First 1
    if ($process) {
        return [pscustomobject]@{ Pid = [int]$process.Id; Name = $process.ProcessName; Source = "process" }
    }
    return $null
}

function Get-DefaultRoute {
    $route = Get-NetRoute -DestinationPrefix "0.0.0.0/0" -ErrorAction SilentlyContinue |
        Where-Object { $_.NextHop -and $_.NextHop -ne "0.0.0.0" } |
        Sort-Object RouteMetric |
        Select-Object -First 1
    return $route
}

function Get-PerfSnapshot {
    $processor = Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'" -ErrorAction SilentlyContinue
    $system = Get-CimInstance Win32_PerfFormattedData_PerfOS_System -ErrorAction SilentlyContinue
    $memory = Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory -ErrorAction SilentlyContinue
    $tcp = Get-CimInstance Win32_PerfFormattedData_Tcpip_TCPv4 -ErrorAction SilentlyContinue
    [pscustomobject]@{
        Cpu = [int]$(if ($processor) { $processor.PercentProcessorTime } else { 0 })
        Dpc = [int]$(if ($processor) { $processor.PercentDPCTime } else { 0 })
        Interrupt = [int]$(if ($processor) { $processor.PercentInterruptTime } else { 0 })
        Queue = [int]$(if ($system) { $system.ProcessorQueueLength } else { 0 })
        Memory = [int]$(if ($memory) { $memory.AvailableMBytes } else { 0 })
        Retrans = [int]$(if ($tcp) { $tcp.SegmentsRetransmittedPersec } else { 0 })
    }
}

$outputDirectory = Split-Path -Path $OutputPath -Parent
if ([string]::IsNullOrWhiteSpace($outputDirectory)) { $outputDirectory = [Environment]::GetEnvironmentVariable("TEMP") }
if (-not (Test-Path -LiteralPath $outputDirectory)) {
    New-Item -Path $outputDirectory -ItemType Directory -Force | Out-Null
}
if (Test-Path -LiteralPath $OutputPath) { Remove-Item -LiteralPath $OutputPath -Force -ErrorAction SilentlyContinue }

$mesh = Get-MeshProcessInfo
if (-not $mesh) { throw "Nie znaleziono uruchomionego procesu lub uslugi Mesh Agent." }

$route = Get-DefaultRoute
$interfaceIndex = if ($route) { [int]$route.InterfaceIndex } else { $null }
$adapter = if ($interfaceIndex) {
    Get-NetAdapter -InterfaceIndex $interfaceIndex -ErrorAction SilentlyContinue
} else {
    Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object Status -eq "Up" | Select-Object -First 1
}
if (-not $adapter) { throw "Nie znaleziono aktywnego interfejsu sieciowego." }

$meshConnections = @(Get-NetTCPConnection -OwningProcess $mesh.Pid -State Established -ErrorAction SilentlyContinue)
$meshConnection = $meshConnections | Sort-Object @{ Expression = { if ($_.RemotePort -eq 443) { 0 } else { 1 } } } | Select-Object -First 1
$remoteAddress = if ($meshConnection) { [string]$meshConnection.RemoteAddress } elseif ($route) { [string]$route.NextHop } else { "" }
$remotePort = if ($meshConnection) { [int]$meshConnection.RemotePort } else { 443 }
$serviceProcessMap = Get-ServiceProcessMap

$initialNic = Get-NetAdapterStatistics -Name $adapter.Name -ErrorAction SilentlyContinue
$previousNic = $initialNic
$sampleTotal = [math]::Ceiling($DurationSeconds / $IntervalSeconds)
$sampleNo = 0
$started = Get-Date

Write-Output "Mesh latency diagnostics"
Write-Output "Mesh:       $($mesh.Name), PID $($mesh.Pid)"
Write-Output "Endpoint:   $(if ($remoteAddress) { "$remoteAddress`:$remotePort" } else { "not detected" })"
Write-Output "Interface:  $($adapter.Name) [$($adapter.ifIndex)]"
Write-Output "Duration:   $DurationSeconds s, interval $IntervalSeconds s"
Write-Output "CSV:        $OutputPath"
Write-Output "Note:       bytes are measured for the whole adapter; actors include process, PID, service and connection count."
Write-Output ""

$deadline = (Get-Date).AddSeconds($DurationSeconds)
while ((Get-Date) -lt $deadline) {
    $sampleStart = Get-Date
    $sampleNo++
    try {
        $currentNic = Get-NetAdapterStatistics -Name $adapter.Name -ErrorAction SilentlyContinue
        if (-not $currentNic) { throw "Nie mozna odczytac statystyk interfejsu sieciowego." }
        $elapsed = [math]::Max(0.1, ($sampleStart - $started).TotalSeconds - (($sampleNo - 1) * $IntervalSeconds))
        $rxBytes = Get-Delta $currentNic.ReceivedBytes $previousNic.ReceivedBytes
        $txBytes = Get-Delta $currentNic.SentBytes $previousNic.SentBytes
        $rxRate = [math]::Round(($rxBytes * 8 / $elapsed) / 1MB, 3)
        $txRate = [math]::Round(($txBytes * 8 / $elapsed) / 1MB, 3)
        $rxErrors = Get-Delta $currentNic.ReceivedPacketErrors $previousNic.ReceivedPacketErrors
        $txErrors = Get-Delta $currentNic.OutboundPacketErrors $previousNic.OutboundPacketErrors
        $rxDrops = Get-Delta $currentNic.ReceivedDiscardedPackets $previousNic.ReceivedDiscardedPackets
        $txDrops = Get-Delta $currentNic.OutboundDiscardedPackets $previousNic.OutboundDiscardedPackets
        $previousNic = $currentNic

        $perf = Get-PerfSnapshot
        $connections = Get-ActiveConnectionSnapshot -ServiceMap $serviceProcessMap
        $meshConnection = @(Get-NetTCPConnection -OwningProcess $mesh.Pid -State Established -ErrorAction SilentlyContinue) |
            Where-Object { $_.RemoteAddress -eq $remoteAddress -and $_.RemotePort -eq $remotePort } |
            Select-Object -First 1
        $icmpMs = Test-IcmpLatency -Address $remoteAddress
        $tcpMs = Test-TcpLatency -Address $remoteAddress -Port $remotePort
        $topProcess = Get-Process -ErrorAction SilentlyContinue |
            Where-Object { $_.Id -gt 0 } |
            Sort-Object CPU -Descending |
            Select-Object -First 1

        $row = [pscustomobject]@{
            Timestamp = $sampleStart.ToString("yyyy-MM-dd HH:mm:ss.fff")
            MeshConnected = [bool]$meshConnection
            MeshPid = $mesh.Pid
            MeshServer = $remoteAddress
            MeshPort = $remotePort
            IcmpMs = $icmpMs
            TcpConnectMs = $tcpMs
            DownloadMbps = $rxRate
            UploadMbps = $txRate
            TotalMbps = [math]::Round($rxRate + $txRate, 3)
            ActiveConnections = $connections.Count
            TopNetworkActor = $connections.TopActor
            TopNetworkActorConnections = $connections.TopActorConnections
            ConnectionProcesses = $connections.Summary
            NicRxErrors = $rxErrors
            NicTxErrors = $txErrors
            NicRxDrops = $rxDrops
            NicTxDrops = $txDrops
            TcpRetransPerSec = $perf.Retrans
            SystemCpuPct = $perf.Cpu
            DpcPct = $perf.Dpc
            InterruptPct = $perf.Interrupt
            ProcessorQueue = $perf.Queue
            AvailableMemoryMB = $perf.Memory
            TopProcess = if ($topProcess) { $topProcess.ProcessName } else { "-" }
            TopProcessPid = if ($topProcess) { $topProcess.Id } else { 0 }
        }
        $row | Export-Csv -Path $OutputPath -Append -NoTypeInformation -Encoding UTF8

        $problem = (
            -not $row.MeshConnected -or
            ($null -ne $row.IcmpMs -and $row.IcmpMs -ge 200) -or
            ($null -ne $row.TcpConnectMs -and $row.TcpConnectMs -ge 500) -or
            $row.TcpRetransPerSec -gt 0 -or
            $row.NicRxErrors -gt 0 -or $row.NicTxErrors -gt 0 -or
            $row.NicRxDrops -gt 0 -or $row.NicTxDrops -gt 0 -or
            $row.SystemCpuPct -ge 90
        )
        $color = if ($problem) { "Red" } else { "Green" }
        Write-Output "__COMMANDTABS_PROGRESS__ $sampleNo/$sampleTotal Proba sieci"
        Write-Output "Network actor: $($connections.TopActor) ($($connections.TopActorConnections) active connections)"
        $sampleLine = ("{0} ICMP:{1,5}ms TCP:{2,6}ms Down:{3,7}Mbps Up:{4,7}Mbps " +
            "Conn:{5,3} Retr:{6,3} CPU:{7,3}% Top:{8}") -f `
            $row.Timestamp, $row.IcmpMs, $row.TcpConnectMs, $row.DownloadMbps,
            $row.UploadMbps, $row.ActiveConnections, $row.TcpRetransPerSec,
            $row.SystemCpuPct, $row.TopProcess
        Write-Host $sampleLine -ForegroundColor $color
    }
    catch {
        Write-Warning "$((Get-Date).ToString('HH:mm:ss')) $($_.Exception.Message)"
    }

    $sleepMs = ($IntervalSeconds * 1000) - ((Get-Date) - $sampleStart).TotalMilliseconds
    if ($sleepMs -gt 0) { Start-Sleep -Milliseconds ([int]$sleepMs) }
}

Write-Output ""
Write-Output "Zakonczono diagnostyke. CSV: $OutputPath"
