# Group-bound SIRK Agent installer

SIRK Portal can generate a Windows executable for a selected computer group. The operator passes only the generated `.exe` file to the target user or deployment system.

Security contract:

- the executable is bound to exactly one Portal origin and one computer group;
- it contains a random enrollment ticket, never the reusable group enrollment token;
- only a SHA-256 hash of the ticket is stored by Portal;
- the ticket is short-lived and accepted for one successful device enrollment only;
- a failed EXE build revokes the issued ticket;
- the download response is `no-store` and audited;
- the bootstrap executable downloads the official SIRK Agent Setup asset and the existing installation flow verifies its published SHA-256 checksum before execution;
- the generated IExpress wrapper is not Authenticode-signed. The official inner SIRK Agent Setup executable remains the release artifact verified by checksum.

The reusable group token remains available only for controlled automation and backward-compatible enrollment. New operator-driven deployments should use the generated single-use installer.
