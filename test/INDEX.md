# Test index

Wybierz test na podstawie zmienianego kontraktu. Nie czytaj wszystkich testów przed ustaleniem obszaru.

| Obszar | Test |
|---|---|
| security | `security.test.js` |
| lokalizacja skryptów | `script-localization.test.js` |
| folder permissions | `folder-access.test.js` |
| dostęp do widoków Portalu | `portal-view-access.test.js` |
| integracje i health | `integration-health.test.js` |
| połączenie wychodzące z Portal Central | `central-tunnel-client.test.js` |
| dostęp i Desktop | `portal-access-and-desktop-connect.test.js` |
| Terminal | `portal-terminal-connect.test.js` |
| aktualizacje pluginów | `plugin-update-manager.test.js` |
| rollback | `plugin-rollback-manager.test.js` |
| wykrywanie backupów | `plugin-backup-discovery.test.js` |
| marketplace | `plugin-marketplace.test.js` |
| trwałe zakładki urządzeń | `portal-device-tabs.test.js` |
| wspólny kontrakt UI | `portal-ui-contract.test.js` |
| cache i rewizja assetów Portalu | `portal-cache-invalidation.test.js`, `portal-runtime-assets.test.js` |
| restart usługi i powrót do strony | `portal-restart-flow.test.js` |
| struktura ustawień Portalu | `portal-settings-structure.test.js` |
| cleanup Portalu | `portal-cleanup.test.js` |
| izolacja GUI | `portal-gui-isolation-script.test.js` |

Po teście celowanym uruchom `npm test`, jeżeli zmiana wpływa na wiele warstw albo wspólny kontrakt.
