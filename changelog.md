## 1.8.36-dev.83

- Bootstrap embedded MeshCentral sessions with the target device and native view before opening a remote tunnel.
- Fix the MeshCentral login iframe when `Referrer-Policy: no-referrer` suppresses its Referer header.
- Add authenticated per-device SIRK Agent enrollment and check-in credentials.
- Persist only SHA-256 device credential hashes in the Portal registry.
- Add a live Windows service enrollment/check-in E2E harness.
- Deliver queued signed policies only to their enrolled tenant/device.
- Retain queued policies until the Agent acknowledges the active policy ID.
- Require every enrolled Agent check-in to carry a fresh ECDSA P-256 device proof.
- Reject stale timestamps, reused nonces, missing proofs, and invalid device keys.

## 1.8.36-dev.25

- Fix Portal view visibility persistence when the new UI submits settings through module options.

## 1.8.36-dev.24

- Keep the standalone device tab rail compact at 44px so it is only slightly taller than its buttons.

## 1.8.36-dev.23

- Organize Settings into Portal Modules, separate Commands, and per-module Permissions with a visual separator.

## 1.8.36-dev.22

- Persist per-view visibility from the view settings section and remove disabled views from both navigation columns.

## 1.8.36-dev.21

- Hide disabled module views from the left menu and restore Assets module settings so disabled integrations can be enabled.

## 1.8.36-dev.20

- Rename user-facing My Commands labels to Commands in the new Portal UI.

## 1.8.36-dev.19

- Fix standalone Settings save so Commands module enablement and options are persisted.

## 1.8.36-dev.18

- Force uncached update status requests so newly published versions are visible immediately.

## 1.8.36-dev.17

- Clean up Settings: add Overview visibility controls, hide disabled views, make module Enabled the parent switch, and separate Permissions from device commands.

## 1.8.36-dev.16

- Add Overview visibility controls to Settings and persist each tile's enabled state.

## 1.8.36-dev.15

- Add current and available system version status to the Overview page.

## 1.8.36-dev.14

- Keep the current update section visible while checking for updates instead of replacing it with a loading screen.

## 1.8.36-dev.13

- Separate device Commands from the Automation menu and prepare the server SIRK scheduler area.

## 1.8.36-dev.12

- Combine update history and jobs into one status table with success, pending and failure information.

## 1.8.36-dev.11

- Remove the duplicate Overview entry from the Settings secondary navigation.

## 1.8.36-dev.10

- Stop interrupted update jobs from being retried after restart and require a valid staged job before offering a restart.

## 1.8.36-dev.9

- Merge Service, Debug and System settings under one Server area and expose Plugins in its secondary column.

## 1.8.36-dev.8

- Use the MeshCentral login session for the new Portal login instead of a separate local credential form.

## 1.8.36-dev.7

- Keep the mounted Portal details panel visible behind a loading overlay during view refreshes to prevent flicker.

## 1.8.36-dev.6

- Reorganized Portal settings by the main menu areas and made every nested settings section collapsed by default.

## 1.8.36-dev.5

- Reduced the standalone device tabs bar to 46px so it stays only slightly taller than its buttons.

## 1.8.36-dev.4

- Added a visible service-restart screen with readiness polling, return to the active System section and an up-to-date confirmation after restart.

## 1.8.36-dev.3

- Disabled browser caching for Portal HTML, redirects and runtime assets.
- Added a live asset revision so updated files are fetched immediately without waiting for the host process to reload.

## 1.8.36-dev.2

- Kept the complete Portal shell visible during refresh while permissions and device workspaces are restored.

## 1.8.36-dev.1

- Fixed device inventory transport selection between standalone `/api/devices` and the MeshCentral `portal/devices` provider.

## 1.8.3-dev.1

- Added the `Usługa` subcategory under `Serwer` for MeshCentral service status and restart controls.

## 1.8.1

- Fixed JavaScript syntax damaged by the global class migration.
- Restored Portal startup and icon rendering.
- Validated critical Portal startup scripts before publishing.

## 1.8.0

- Published the independent SIRK Portal updater on the Stable (`main`) channel.
- Moved System lifecycle controls into `Ustawienia -> System` with Aktualizacje, Backupy, Historia and Kanał aktualizacji.
- Replaced blocking backup, extraction and staging operations with asynchronous jobs and progress polling.
- Added an explicit `Zapisz` action for update-channel changes.
- Unified Portal view classes and removed menu-specific frontend class contracts.

## 1.7.0-dev.1

- Added an independent SIRK lifecycle manager owned by the new Portal instead of MeshCentral plugin management.
- Added Stable (`main`), Beta (`beta`) and Developer (`develop`) update channels.
- Added update checks, manual and automatic backups, restore, rollback history and health checks.
- Added staging and a detached update helper that performs the atomic file swap only after the running host stops.
- Moved standalone data outside the application directory so updates cannot remove runtime data.
- Made `develop` the mandatory working branch for all future development.

## 1.6.4

- Moved the final shared Portal surface rule into the last-loaded `portal-ui-contract.css` stylesheet.
- Removed the legacy Management-only radius override that defeated the global contract.
- Enforced clipping and a 10px radius for Automation, Approval, Management and all other module hosts.
- Updated regression coverage to validate the final loaded stylesheet.

## 1.6.3

- Made `.sirk-portal-view-host` the single owner of the Portal view frame, radius and clipping.
- Removed Management-specific outer padding and duplicate inner frames.
- Applied the same 10px corner radius to all module views through the global surface contract.
- Added regression coverage for the global view surface.

## 1.6.2

- Fixed Portal settings save by excluding the current `SIRKPortal` instance from obsolete standalone-plugin conflict detection.
- Prevented the admin save status from collapsing the save button on narrow layouts.
- Added regression coverage for the self-conflict and save-bar layout.

## 1.5.151

- Completed the standalone Portal asset manifest for all shared UI components and feature modules.
- Added the Portal UI contract JavaScript endpoint.
- Fixed Settings and Management URLs to use `SIRKPortal`.
- Replaced raw disabled-module JSON with the shared unavailable-state presentation.

## 1.5.150

- Fixed the standalone Portal bootstrap pin to use `SIRKPortal`.
- Added the missing `portal-ui-contract.css` asset route with a CSS MIME type.
- Added regression coverage for runtime Portal asset URLs.

# Changelog

## 1.5.144

- Zmieniono techniczny identyfikator pluginu MeshCentral z niebezpiecznego `SIRK-Portal` na poprawny identyfikator JavaScript `SIRKPortal`.
- Dodano kanoniczne entrypointy `SIRKPortal.js` i `SIRKPortalAdmin.js`.
- Usunięto entrypointy z myślnikiem, które powodowały błędny kod `obj.SIRK-Portal` w `pluginHandler.prepExports()` i biały ekran po zalogowaniu.
- Zaktualizowano instalator, aby używał katalogu `meshcentral-data/plugins/SIRKPortal` i usuwał wadliwe katalogi testowych identyfikatorów.
- Rozszerzono testy i walidator o wymóg JavaScript-safe `shortName`.

## 1.5.143

- Dodano administracyjny entrypoint delegujący obsługę panelu do kanonicznej implementacji `admin.js`.
- Wydanie zostało zastąpione przez `1.5.144`, ponieważ identyfikator z myślnikiem nie jest zgodny z generatorem JavaScript MeshCentral.

## 1.5.142

- Opublikowano uporządkowany layout repozytorium SIRK-Portal na branchu `main`.
- Zawarto finalny wspólny kontrakt UI dla Overview, Devices i pozostałych zakładek.
- Zsynchronizowano źródła wersji i dokumentację wydania do testów instalacyjnych.

## 1.5.141

- Rozszerzono kanoniczny kontrakt UI na wszystkie widoki SIRK Portal.
- Overview i Devices korzystają teraz ze wspólnych klas `mc-portal-*` dla surface, cards, toolbarów, przycisków, inputów, statusów, badge i list.
- Devices zachowuje własną geometrię listy, szczegółów i workspace sesji, ale nie utrzymuje już oddzielnego systemu wizualnego.
- Dodano test regresyjny blokujący ponowne odseparowanie Overview lub Devices od wspólnego kontraktu UI.

## 1.5.140

- Zmieniono kanoniczną nazwę repozytorium i wszystkie URL-e metadata na `Eris92/SIRK-Portal`.
- Usunięto z dokumentacji i instrukcji informacje o kompatybilności, fallbackach oraz migracji `MyCompany`.
- Ujednolicono dokumentację z finalnym layoutem `server/`, `public/`, `web/admin/` i `views/SIRK-Portal.handlebars`.
- Dodano hierarchię indeksów `AGENTS.md -> docs/INDEX.md -> <warstwa>/INDEX.md`.
- Wymuszono selektywny odczyt tylko właściwej części repozytorium i bezpośrednich zależności.
- Zaktualizowano reguły agenta, prompt startowy, stan projektu, integrację Portalu i dokumentację instalacji.
- Ustawiono nową bazę historii wersji dla SIRK Management Platform po świadomym zerwaniu kompatybilności z testową strukturą MyCompany.
