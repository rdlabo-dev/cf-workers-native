# Workers TLS adapter

Adapted from workerd 5358e3d337336eaf696a48bc1563d808b10feba5.
The public tls, \_tls_wrap and \_stream_wrap imports share their constructors.
Certificate hostname checks, ALPN conversion, constants, options validation and
Workers stubs follow the pinned profile. Direct TLS connections use the existing
native socket transport and platform certificate verification. The original
hostname or explicit servername survives DNS resolution and reaches the native
TLS verifier and SNI configuration.

The native expansion suite verifies successful TLS exchange and hostname mismatch
rejection in both page and Dedicated Worker on iOS and Android. Dedicated Workers
use the normal owned socket relay, including disposal. Trust overrides are confined
to the independent debug test consumer and simulator CA store.

Direct TLS and upgrades use the same authenticated record engine. Upgrades
preserve the existing TCP connection and protocol state. iOS uses OpenSSL memory
BIOs with mandatory SecTrust chain and hostname validation; Android uses the
existing Netty channel and platform SSLEngine. Both engines distinguish TLS close_notify
from a truncated connection, including a peer reset. Application reads and writes wait for authentication. The native suite
covers TLS 1.2 and 1.3, repeated write-half-close followed by response reads, and
rejection of hostname mismatch and an untrusted root in both execution modes.
Custom Duplex wrapping follows Workers' byte-forwarding path and does not itself
encrypt traffic. Shared contracts cover its EOF, destruction, invalid chunks,
write errors and listener ordering separately from the native TLS exchanges.

STARTTLS follows Workers' transport semantics: its `secureConnect` notification
inherits the already-established TCP connection and may precede certificate
verification. Application IO still waits for verification. A failed handshake
cannot send or deliver application bytes. STARTTLS read failures surface as EOF,
while writes fail with `Network connection lost.`; direct TLS retains its failure
errors. An application must not interpret STARTTLS `secureConnect` or readable EOF
as proof of a successfully authenticated, cleanly terminated TLS exchange.

Closing a direct TLS socket during its handshake waits for connection establishment
to succeed or fail, matching Workers' close ordering. Closing an upgraded socket
can interrupt authentication because its TCP connection is already established.

Whole-module acceptance remains open pending the complete operation inventory.
Workers itself rejects server mode, custom
verification callbacks, ALPN negotiation options and several introspection APIs
in the pinned profile; retain those explicit failures.
