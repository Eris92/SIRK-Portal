# SIRK Portal — stan projektu

## Wersja

`3.0.0-dev.2`, ASP.NET Core / .NET 10 LTS.

## Zrealizowane

- pełny frontend standalone publikowany razem z aplikacją,
- logowanie Break-Glass, RBAC, CSRF, rate limiting i Data Protection,
- Agent enrollment, check-in, commands, policies i desktop relay,
- Central heartbeat, signed requests i tunnel,
- ustawienia, skrypty, approvals, workflows i audit log,
- natywna usługa Windows z recovery przez SCM,
- self-contained Windows/Linux publish,
- Kestrel HTTPS i automatyczny certyfikat,
- jednolinijkowy clean installer,
- integracja SIRK Updater v2,
- kompletne smoke tests UI/API oraz Windows clean-install.

## Usunięte

- Node.js runtime,
- npm i package manifests,
- backend `server/`,
- Node watchdog i enrollment CLI,
- node-windows/WinSW Portal wrapper,
- stare instalatory i testy Node.
