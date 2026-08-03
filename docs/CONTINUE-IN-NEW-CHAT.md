Kontynuuj rozwój SIRK Portal z repozytorium `Eris92/SIRK-Portal`.

Aktualna architektura: wyłącznie ASP.NET Core / .NET 10 LTS, bez Node.js. Pełny frontend znajduje się w `public/**` i jest publikowany przez `src/Sirk.Portal/Sirk.Portal.csproj`. Backend znajduje się w `src/Sirk.Portal/**`. Testy .NET: `tests/Sirk.Portal.ProtocolTests`. Kanoniczny installer: `install.ps1`.

Nie przywracaj `package.json`, katalogów `server`, `test`, `scripts`, `npm`, `node.exe`, `node-windows`, WinSW ani starych instalatorów. Każda zmiana musi przejść workflow `SIRK Portal .NET 10 CI`, w tym Windows clean-install.
