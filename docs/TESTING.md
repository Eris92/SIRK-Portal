# Testy SIRK Portal .NET 10

## Build

```powershell
dotnet restore .\tests\Sirk.Portal.ProtocolTests\Sirk.Portal.ProtocolTests.csproj
dotnet build .\tests\Sirk.Portal.ProtocolTests\Sirk.Portal.ProtocolTests.csproj -c Release --no-restore
dotnet run --project .\tests\Sirk.Portal.ProtocolTests\Sirk.Portal.ProtocolTests.csproj -c Release --no-build
```

## Publish Windows x64

```powershell
dotnet publish .\src\Sirk.Portal\Sirk.Portal.csproj -c Release -r win-x64 --self-contained true -o .\artifacts\win-x64
```

## Weryfikacja instalacji

```powershell
Get-Service SirkPortal,SirkUpdater | Format-Table Name,Status,StartType
Invoke-RestMethod https://localhost/healthz
Invoke-RestMethod https://localhost/readyz
```

Wymagany wynik: obie usługi `Running/Automatic`, health `healthy`, readiness `ready`.
