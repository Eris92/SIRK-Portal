#PL Lokalny raport zasobu | Test lokalnej inwentaryzacji w stylu Jira bez połączenia z Jira.
#EN Local asset report | Jira-style local inventory test without a Jira connection.
$getInfo = Get-Command Get-CimInstance -ErrorAction SilentlyContinue
if ($getInfo) {
    $computer = Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction SilentlyContinue
    $os = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction SilentlyContinue
    $bios = Get-CimInstance -ClassName Win32_BIOS -ErrorAction SilentlyContinue
} else {
    $computer = Get-WmiObject -Class Win32_ComputerSystem -ErrorAction SilentlyContinue
    $os = Get-WmiObject -Class Win32_OperatingSystem -ErrorAction SilentlyContinue
    $bios = Get-WmiObject -Class Win32_BIOS -ErrorAction SilentlyContinue
}
$hostName = [Environment]::MachineName
$loggedOnUser = [Environment]::UserName
$manufacturer = if ($computer) { $computer.Manufacturer } else { '' }
$model = if ($computer) { $computer.Model } else { '' }
$operatingSystem = if ($os) { $os.Caption } else { '' }
$osVersion = if ($os) { $os.Version } else { '' }
$lastBoot = if ($os) { $os.LastBootUpTime } else { '' }
$biosSerial = if ($bios) { $bios.SerialNumber } else { '' }
$rows = @(
    @{ Property = 'Host name'; Value = $hostName },
    @{ Property = 'Logged-on user'; Value = $loggedOnUser },
    @{ Property = 'Manufacturer'; Value = $manufacturer },
    @{ Property = 'Model'; Value = $model },
    @{ Property = 'Operating system'; Value = $operatingSystem },
    @{ Property = 'OS version'; Value = $osVersion },
    @{ Property = 'Last boot'; Value = $lastBoot },
    @{ Property = 'BIOS serial'; Value = $biosSerial },
    @{ Property = 'Collected at'; Value = (Get-Date).ToString('s') }
)
@{
    meshTable = $true
    title = 'Local asset report'
    columns = @('Property', 'Value')
    rows = @($rows)
} | ConvertTo-Json -Depth 5

