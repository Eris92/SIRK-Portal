# SIRK Portal

SIRK Portal 3.0 jest natywną aplikacją **ASP.NET Core / .NET 10 LTS**. Backend, API, WebSocket, Windows Service, Central tunnel, Agent control plane i obsługa danych działają bez Node.js. JavaScript pozostaje wyłącznie jako kod wykonywany w przeglądarce dla pełnego frontendu.

## Wymagania

- Windows Server 2019–2025 lub Windows 10/11 x64
- PowerShell 5.1+
- uprawnienia lokalnego Administratora
- dostęp HTTPS do GitHub, Microsoft .NET i repozytorium SIRK Updater

## Instalacja jednolinijkowa

Uruchom Windows PowerShell jako Administrator:

```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force; iex ((Invoke-WebRequest -UseBasicParsing ('https://raw.githubusercontent.com/Eris92/SIRK-Portal/main/install.ps1?nocache=' + [guid]::NewGuid())).Content)
```

Instalator pyta o FQDN, hasło Break-Glass i zaufanie certyfikatu. Następnie publikuje self-contained `Sirk.Portal.exe`, instaluje usługę `SirkPortal`, generuje TLS, uruchamia pełny frontend, instaluje `SirkUpdater` i wykonuje health/readiness test.

## Runtime

- `SirkPortal` — natywna usługa ASP.NET Core .NET 10
- `SirkUpdater` — współdzielony updater
- Kestrel HTTPS
- trwałe dane: `C:\ProgramData\SIRK\Portal`
- pliki programu: `C:\Program Files\SIRK\Portal`

Repozytorium nie zawiera `package.json`, backendu `server/`, `npm`, `node.exe`, `node-windows` ani serwerowych testów JavaScript.
