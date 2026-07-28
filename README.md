# SIRK Management Platform 1.8.36-dev.87

**Repozytorium:** `SIRK-Portal`  
**Techniczny identyfikator pluginu MeshCentral:** `SIRKPortal`  
**Nazwa wyświetlana:** `SIRK Management Platform`  
**Nazwa skrócona w interfejsie:** `SIRK Platform`

SIRK Management Platform zawiera niezależny Portal, backend, automatyzację, akceptacje, integracje, zarządzanie urządzeniami oraz opcjonalny adapter MeshCentral.

Repozytorium nie utrzymuje kompatybilności z testową nazwą ani strukturą `MyCompany`. Nie ładuje starych entrypointów, nie migruje dawnych ustawień i nie korzysta z `mycompany-data`.

## Gałąź robocza i kanały aktualizacji

Domyślną gałęzią roboczą projektu jest od teraz:

```text
develop
```

Kanały aktualizacji w Portalu:

| Tryb | Gałąź |
|---|---|
| Normalny / Stable | `main` |
| Beta | `beta` |
| Developerski / Dev | `develop` |

Każdą nową funkcję, poprawkę i branch funkcjonalny rozpoczynaj od `develop`. Promocja wydań przebiega w kolejności:

```text
develop -> beta -> main
```

Szczegóły: [Kanały aktualizacji i lifecycle](docs/UPDATE-CHANNELS.md).

## Instalacja i dalsze aktualizacje

Pierwszą instalację można wykonać przez MeshCentral. Po instalacji dalszy lifecycle SIRK Portal jest obsługiwany z poziomu widoku **Aktualizacje** w nowym Portalu, a nie przez manager pluginów MeshCentral.

Widok umożliwia:

- sprawdzenie wersji na kanale Stable, Beta lub Dev;
- zmianę kanału;
- ręczny backup;
- automatyczny backup przed aktualizacją;
- staging i health-check pobranej wersji;
- aktualizację wykonywaną przez osobny helper po zatrzymaniu hosta;
- restore i cofnięcie do wcześniejszego backupu;
- historię operacji.

## Zacznij od indeksów

Przed odczytem kodu:

1. przeczytaj [`AGENTS.md`](AGENTS.md);
2. otwórz [`docs/INDEX.md`](docs/INDEX.md);
3. wybierz indeks warstwy odpowiadającej zadaniu;
4. czytaj wyłącznie wskazaną część repozytorium i jej bezpośrednie zależności.

Nie skanuj całego repozytorium, jeżeli indeks wskazuje konkretny entrypoint, moduł, loader, test lub dokument.

## Dokumentacja

- [Indeks dokumentacji i obszarów](docs/INDEX.md)
- [Kanały aktualizacji i lifecycle](docs/UPDATE-CHANNELS.md)
- [Struktura repozytorium](docs/REPOSITORY-LAYOUT.md)
- [Aktualny stan projektu](docs/PROJECT-STATE.md)
- [Integracja SIRK Platform i SIRK Portal](docs/portal-integration.md)
- [Router instrukcji](AGENTS.md)
- [Reguły projektu](docs/agent/11-Agent-SIRK-Portal.md)
- [Prompt startowy nowej rozmowy](docs/agent/Prompt-Start-SIRK-Portal-Conversation.md)

## Warstwy projektu

```text
backend Node / host-neutral core -> server/
samodzielny SIRK Portal         -> public/portal/
adapter natywnego MeshCentral   -> public/native/
frontend współdzielony          -> public/shared/
renderery modułów               -> public/modules/
panel administracyjny           -> web/admin/
widok panelu                     -> views/SIRK-Portal.handlebars
ikony                            -> assets/icons/
narzędzia instalacyjne          -> tools/install/
```

Szczegółowe mapy znajdują się w lokalnych plikach `INDEX.md` poszczególnych warstw.

## Moduły funkcjonalne

- Automation;
- Commands;
- Approvals;
- Device Transfers;
- Jira Integration;
- Security;
- Portal;
- System Updates.

Backend modułów znajduje się w `server/modules/`, a pojedyncze renderery frontendowe w `public/modules/`.

## Wspólny kontrakt UI Portalu

Wszystkie widoki SIRK Portal korzystają ze wspólnego systemu klas `sirk-*` dla powierzchni, kart, toolbarów, przycisków, pól formularzy, statusów, list i typografii.

Widok Devices zachowuje własną geometrię listy urządzeń, szczegółów hosta i workspace aktywnej sesji, ale korzysta z tych samych komponentów wizualnych co Overview oraz pozostałe zakładki.

## Entry pointy i loadery

Kanoniczne entrypointy MeshCentral:

```text
SIRKPortal.js
SIRKPortalAdmin.js
```

Identyfikator `SIRKPortal` celowo nie zawiera myślnika. MeshCentral wykorzystuje `shortName` jako nazwę właściwości w generowanym JavaScript głównego interfejsu, dlatego musi to być poprawny identyfikator JavaScript.

Łańcuch adaptera MeshCentral:

```text
SIRKPortal.js
  -> plugin-main-standalone.js
    -> plugin-main.js
      -> server/core/runtime-portal.js
        -> server/core/runtime.js
          -> server/modules/*
```

Samodzielny proces:

```text
server/standalone.js
  -> server/standalone-runtime.js
  -> server/http/api-router.js
  -> server/system-update-manager.js
```

## Dane trwałe

Dane runtime znajdują się w `sirk-platform-data` poza katalogiem kodu aplikacji. W adapterze MeshCentral jest to:

```text
meshcentral-data/sirk-platform-data
```

Dla procesu standalone lokalizację można ustawić przez:

```text
SIRK_DATA_ROOT
```

## Instalacja z Git

Uruchom jako Administrator:

```powershell
.\Install-SIRK-Portal-FromGit_RUN.ps1
```

Źródłowa implementacja instalatora:

```text
tools/install/Install-SIRK-Portal-FromGit.ps1
```

Repozytorium źródłowe:

```text
https://github.com/Eris92/SIRK-Portal
```

Instalator umieszcza plugin w:

```text
meshcentral-data/plugins/SIRKPortal
```

## Testy

```bash
npm test
```

Walidator struktury blokuje niebezpieczny identyfikator z myślnikiem, stare entrypointy i widoki `MyCompany`, backend poza `server/`, płaskie assety aplikacyjne w `public/`, `public/shared-ui/`, podwójne renderery i niekanoniczne ścieżki loaderów.
