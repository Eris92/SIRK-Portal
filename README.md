# SIRK Portal

SIRK Portal 3.0 jest natywną aplikacją **ASP.NET Core / .NET 10 LTS**. Backend, API, WebSocket, Central tunnel, Agent control plane i obsługa danych działają bez Node.js. JavaScript pozostaje wyłącznie kodem frontendu wykonywanym w przeglądarce.

## Obsługiwane platformy

- Windows Server 2019–2025 lub Windows 10/11 x64,
- Debian/Ubuntu x64 z systemd,
- .NET 10 Runtime + ASP.NET Core Runtime 10,
- dostęp HTTPS do GitHub, Microsoft .NET i repozytorium SIRK Updater.

## Windows — czysta instalacja

Uruchom Windows PowerShell jako Administrator. Instalator `install.ps1` na `main` kieruje czystą instalację do zweryfikowanej paczki `win-x64`; na hoście nie jest wykonywany `dotnet publish`.

```powershell
$Installer = Join-Path $env:TEMP 'SIRK-Portal-Install.ps1'
Invoke-WebRequest `
    -UseBasicParsing `
    -Uri "https://raw.githubusercontent.com/Eris92/SIRK-Portal/main/install.ps1?nocache=$([guid]::NewGuid())" `
    -OutFile $Installer
try {
    & $Installer -Branch main -PortalFqdn 'portal.example.local' -HttpsPort 443 -RemoveData -TrustCertificate
}
finally {
    Remove-Item -LiteralPath $Installer -Force -ErrorAction SilentlyContinue
}
```

Instalator tworzy Break-Glass, TLS, usługę `SirkPortal`, rejestrację w `SirkUpdater` oraz wykonuje health/readiness i walidację pełnego frontendu.

## Linux — czysta instalacja

Linux jest pełnoprawnym wariantem binarnym `linux-x64`. Obsługiwane są Debian i Ubuntu z systemd. Uruchom jako `root` lub przez `sudo`:

```bash
INSTALLER=/tmp/sirk-portal-install.sh
curl -fsSL \
  "https://raw.githubusercontent.com/Eris92/SIRK-Portal/main/install.sh?nocache=$(date +%s)" \
  -o "$INSTALLER"
chmod 700 "$INSTALLER"
sudo bash "$INSTALLER" --fqdn portal.example.local --port 443 --remove-data
rm -f "$INSTALLER"
```

Instalator pyta o hasło Break-Glass i tworzy:

- `/opt/sirk/portal` — root-owned pliki programu,
- `/var/lib/sirk-portal` — trwałe identity, ustawienia, agenci, klucze, TLS i backupy,
- `/etc/sirk-portal/portal.env` — root-only konfigurację usługi,
- `/usr/lib/sirk-portal` — wąskie root-owned helpery maintenance,
- `sirk-portal.service` — Portal uruchamiany jako nieuprzywilejowany użytkownik `sirkportal`,
- `sirk-updater.service` — współdzielony SIRK Updater dla systemd.

Usługa Portalu działa z `ProtectSystem=strict`, `NoNewPrivileges=true`, `PrivateTmp=true`, `PrivateDevices=true` i prawem zapisu wyłącznie do DataRoot. Port 443 jest obsługiwany przez `CAP_NET_BIND_SERVICE`, bez uruchamiania Portalu jako root.

## Aktualizacje

CI publikuje do `portal-main-latest` dwie niezależnie hashowane paczki:

- `sirk-portal-win-x64.zip` + `portal-update.json`,
- `sirk-portal-linux-x64.zip` + `portal-update-linux-x64.json`.

Aktualizator weryfikuje metadane, rozmiar i SHA-256, a następnie przekazuje paczkę do wspólnego `SirkUpdater`. Silnik wykonuje transactional backup, stop usługi, podmianę plików, start, health-check oraz automatyczny rollback przy błędzie.

Na Windows aktualizacja używa Windows Service. Na Linux ten sam silnik używa `systemctl`; aktualizacja z GUI jest odłączana od cgroup Portalu przez transient systemd unit, dzięki czemu przeżywa zatrzymanie aktualizowanej usługi.

## Runtime i bezpieczeństwo

- aplikacja jest framework-dependent i nie zawiera prywatnej kopii runtime,
- Windows korzysta ze współdzielonego Microsoft .NET 10,
- Linux korzysta ze współdzielonego .NET 10 (`/opt/dotnet` tylko gdy wymagany runtime nie jest już dostępny),
- health-check SIRK Updatera dla lokalnej aplikacji nie korzysta z proxy i ma ograniczony czas pojedynczego probe,
- Kestrel używa HTTPS,
- dane aplikacji są oddzielone od wymienialnych plików programu.

## Walidacja CI

`SIRK Portal .NET 10 CI` chroni istniejący Windows flow: build, kontrakty, framework-dependent publish, pakiet binarny i rzeczywisty Windows clean-install.

`SIRK Portal Linux .NET 10 CI` wykonuje niezależnie:

1. walidację skryptów Bash i kontraktów Portalu,
2. publish `linux-x64`,
3. utworzenie i publikację paczki z SHA-256,
4. rzeczywisty clean-install na Ubuntu,
5. weryfikację `sirk-portal.service` i `sirk-updater.service`,
6. health/readiness,
7. bezpośrednią aktualizację transakcyjną,
8. aktualizację odłączoną tak samo jak z GUI.

Repozytorium nie wymaga Node.js po stronie serwera.
