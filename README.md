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

Instalator pyta o FQDN, hasło Break-Glass i zaufanie certyfikatu. Następnie:

- instaluje systemowo Microsoft .NET Runtime 10 x64 i ASP.NET Core Runtime 10 x64,
- pobiera tymczasowy SDK wyłącznie do kompilacji i usuwa go po zakończeniu,
- publikuje framework-dependent `Sirk.Portal.exe`,
- instaluje usługi `SirkPortal` i `SirkUpdater`,
- generuje TLS oraz Access URL,
- wykonuje health/readiness i test pełnego frontendu.

## Aktualizacja istniejącej instalacji

Aktualizacja z `main` nie wykonuje ponownej kompilacji na serwerze. CI publikuje gotową paczkę `sirk-portal-win-x64.zip` oraz metadane zawierające rozmiar, commit i SHA-256. Paczka `portal-main-latest` jest odświeżana automatycznie po pushu do `main`. Bootstrap aktualizacji:

1. pobiera metadane oraz paczkę binarną,
2. weryfikuje nazwę aplikacji, kanał, rozmiar i SHA-256,
3. dołącza lokalny `appsettings.Production.json` wyłącznie w zabezpieczonym katalogu tymczasowym,
4. przekazuje paczkę do `SirkUpdater`,
5. wykonuje transactional stop, backup, atomic replacement, start, health check i automatyczny rollback.

Aktualizacja nie instaluje SDK, nie uruchamia `dotnet publish`, nie generuje ponownie certyfikatu, nie zmienia firewalla i nie rejestruje ponownie usługi. Pełny source build można wymusić diagnostycznie parametrem `-ForceSourceBuild`.

## Runtime i aktualizacje bezpieczeństwa

- `SirkPortal` — usługa ASP.NET Core korzystająca ze współdzielonego runtime 10.0.x,
- `SirkUpdater` — współdzielony updater korzystający z `Microsoft.NETCore.App 10.0`,
- poprawki 10.0.x są instalowane systemowo przez Microsoft Update, WSUS lub zatwierdzony instalator Microsoft,
- aplikacje domyślnie uruchamiają się na najnowszej zainstalowanej poprawce 10.0.x,
- katalog Portalu nie zawiera prywatnych kopii `coreclr.dll`, `hostfxr.dll`, `hostpolicy.dll` ani `System.Private.CoreLib.dll`,
- Kestrel HTTPS,
- trwałe dane: `C:\ProgramData\SIRK\Portal`,
- pliki programu: `C:\Program Files\SIRK\Portal`.

Na Windows Server aktualizacje .NET można dystrybuować przez WSUS/Microsoft Update Catalog. Instalator ostrzega, gdy globalny klucz `HKLM\SOFTWARE\Microsoft\.NET\BlockMU` blokuje Microsoft Update.

## Walidacja

Workflow `SIRK Portal .NET 10 CI` wykonuje build, kontrakty bezpieczeństwa, framework-dependent publish, kontrolę braku prywatnego runtime, smoke test pełnego UI/API, test kontenera oraz rzeczywistą instalację od zera na Windows. Dla kanału `main` tworzy również zweryfikowaną paczkę binarną i aktualizuje release `portal-main-latest`.

Repozytorium nie zawiera `package.json`, backendu `server/`, `npm`, `node.exe`, `node-windows` ani serwerowych testów JavaScript.
