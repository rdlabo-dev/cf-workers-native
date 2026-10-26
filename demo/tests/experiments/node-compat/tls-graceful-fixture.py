"""TLS peer that explicitly sends close_notify, unlike the truncation fixture."""
import json
import socket
import ssl
import sys
import threading

context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
context.load_cert_chain(sys.argv[1], sys.argv[2])


def serve_peer(peer, mode):
    try:
        peer.settimeout(10)
        if mode == "upgrade":
            command = bytearray()
            while not command.endswith(b"\n"):
                chunk = peer.recv(1)
                if not chunk:
                    return
                command.extend(chunk)
            peer.sendall(b"READY\n")
        tls = context.wrap_socket(peer, server_side=True)
        if mode == "http":
            request = bytearray()
            while b"\r\n\r\n" not in request and len(request) < 65536:
                chunk = tls.recv(4096)
                if not chunk:
                    return
                request.extend(chunk)
            tls.sendall(b"HTTP/1.1 404 Not Found\r\nContent-Length: 9\r\nConnection: close\r\n\r\nNot found")
        else:
            tls.sendall(b"data")
        # unwrap initiates the TLS shutdown exchange and waits for the peer's
        # close_notify. A finally block still releases aborted test connections.
        raw = tls.unwrap()
        raw.close()
    except (OSError, ssl.SSLError):
        pass
    finally:
        peer.close()


def accept(listener, mode):
    while True:
        peer, _ = listener.accept()
        threading.Thread(target=serve_peer, args=(peer, mode), daemon=True).start()


ports = {}
for name, mode in (("gracefulTls", "direct"), ("gracefulUpgrade", "upgrade"), ("gracefulHttp", "http")):
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen()
    ports[name] = listener.getsockname()[1]
    threading.Thread(target=accept, args=(listener, mode), daemon=True).start()
print(json.dumps(ports), flush=True)
threading.Event().wait()
