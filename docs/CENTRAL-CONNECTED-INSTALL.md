# Instalacja SIRK Portal polaczonego z SIRK Central

## Wymagany flow

1. W SIRK Central otworz **Portale**.
2. Utworz rekord Portalu.
3. Pobierz chroniony plik `SIRK-Portal-<portal-id>-connection.json`.
4. Skopiuj plik na docelowy Windows Server albo pozostaw go w katalogu `Downloads`.
5. Uruchom ponizsze polecenie w Windows PowerShell.

Instalator:

- wyszukuje najnowszy plik `SIRK-Portal-*-connection.json` w `Downloads`;
- waliduje origin Central, endpoint `wss://.../tunnel`, Portal ID i token;
- instaluje framework-dependent SIRK Portal na wspoldzielonym .NET 10 Runtime;
- generuje certyfikat HTTPS i opcjonalnie dodaje go do `LocalMachine\Root`;
- kopiuje polaczenie do `C:\ProgramData\SIRK\Portal\central-connection.json`;
- ogranicza ACL pliku do `SYSTEM` i lokalnych `Administrators`;
- uruchamia usluge `SirkPortal`;
- czeka na heartbeat zaakceptowany przez Central;
- usuwa zrodlowy plik z `Downloads` dopiero po poprawnym polaczeniu;
- wyswietla gotowy URL Break-Glass Portalu.

## Jednolinijkowa instalacja

Uruchom w zwyklym PowerShell. Polecenie samo wywola UAC:

```powershell
$f=Get-ChildItem "$env:USERPROFILE\Downloads\SIRK-Portal-*-connection.json" -File|Sort-Object LastWriteTimeUtc -Descending|Select-Object -First 1;if(!$f){throw 'Najpierw pobierz plik polaczenia z SIRK Central'};$p="$env:TEMP\install-connected-dotnet10.ps1";iwr -UseBasicParsing https://raw.githubusercontent.com/Eris92/SIRK-Portal/main/install-connected-dotnet10.ps1 -OutFile $p;Start-Process powershell.exe -Verb RunAs -Wait -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$p,'-ConnectionFile',$f.FullName)
```

Instalator zapyta o:

- lokalna nazwe DNS Portalu;
- haslo konta Break-Glass przy pierwszej instalacji.

Domyslnie:

- HTTPS: TCP/443;
- certyfikat zostaje dodany do zaufanych certyfikatow komputera;
- dane sa zachowywane przy reinstallu;
- tunel Central jest wlaczony;
- plik z Downloads jest usuwany po udanym heartbeat.

## Czysty reinstall

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install-connected-dotnet10.ps1 -ConnectionFile .\SIRK-Portal-example-connection.json -RemoveData
```

`-RemoveData` usuwa lokalna tozsamosc, konfiguracje, urzadzenia i pozostale dane Portalu. Wymaga ustawienia nowego hasla Break-Glass.

## Zachowanie pliku zrodlowego

Tylko do kontrolowanego troubleshooting:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install-connected-dotnet10.ps1 -ConnectionFile .\SIRK-Portal-example-connection.json -KeepSourceConnectionFile
```

Plik zawiera aktywny token Portalu. Nie nalezy przechowywac go w katalogu uzytkownika po poprawnym imporcie.

## Oczekiwany wynik

```text
SIRK Portal connected install: PASS
Portal ID:          <portal-id>
Portal URL:         https://<portal-fqdn>
Central:            https://central.sirkportal.com
Heartbeat:          connected
Configuration:      protected-file
Connection file:    C:\ProgramData\SIRK\Portal\central-connection.json
Break-Glass URL:    https://<portal-fqdn>/login#access=<access-code>
```

## Weryfikacja lokalna

```powershell
curl.exe -k -sS https://localhost/api/v1/portal/status
```

Oczekiwane pola:

```json
{
  "central": {
    "configured": true,
    "connected": true,
    "status": "connected",
    "configurationSource": "protected-file"
  }
}
```

## Bezpieczenstwo

Pobranie nowego pliku polaczenia z Central rotuje token Portalu. Poprzedni plik przestaje dzialac. Pliku nie nalezy wysylac w tresci wiadomosci, umieszczac w repozytorium ani przechowywac na udziale sieciowym.
