#!/usr/bin/env python3
"""
Minimal HTTP+WebSocket reverse proxy for Chrome DevTools Protocol (CDP).

Rewrites the Host header to "localhost" so Chrome 107+ accepts requests
arriving via Docker hostnames (e.g. "browser:9222").

Usage:
    cdp-host-proxy.py <listen-port> <target-port>
"""

import http.server
import http.client
import socket
import sys
import threading
import select

LISTEN_HOST = "0.0.0.0"


class CDPProxyHandler(http.server.BaseHTTPRequestHandler):
    """Forward HTTP requests to Chrome CDP, rewriting the Host header."""

    target_port = 9223  # overridden from main()

    def do_GET(self):
        self._proxy("GET")

    def do_POST(self):
        self._proxy("POST")

    def do_PUT(self):
        self._proxy("PUT")

    def do_DELETE(self):
        self._proxy("DELETE")

    def _proxy(self, method):
        try:
            conn = http.client.HTTPConnection("127.0.0.1", self.target_port, timeout=10)
            body = None
            content_length = self.headers.get("Content-Length")
            if content_length and int(content_length) > 0:
                body = self.rfile.read(int(content_length))

            # Forward all headers except Host (override to localhost)
            headers = {}
            for key, value in self.headers.items():
                if key.lower() == "host":
                    continue
                headers[key] = value
            headers["Host"] = "localhost"

            conn.request(method, self.path, body=body, headers=headers)
            resp = conn.getresponse()
            resp_body = resp.read()

            self.send_response(resp.status)
            for key, value in resp.getheaders():
                if key.lower() not in ("transfer-encoding",):
                    self.send_header(key, value)
            self.end_headers()
            self.wfile.write(resp_body)
        except Exception as e:
            self.send_error(502, f"Proxy error: {e}")

    def log_message(self, format, *args):
        # Suppress access logs to avoid noise
        pass


def handle_websocket_upgrade(handler):
    """Tunnel WebSocket connections at the TCP level after rewriting the
    initial HTTP upgrade request's Host header."""
    try:
        # Connect to Chrome's internal CDP port
        target = socket.create_connection(("127.0.0.1", CDPProxyHandler.target_port), timeout=10)

        # Reconstruct the upgrade request with Host: localhost
        client_sock = handler.request
        # The first line was already consumed by BaseHTTPRequestHandler, so we
        # rebuild the full upgrade request from the parsed data.
        request_line = f"{handler.command} {handler.path} HTTP/1.1\r\n"
        headers = ""
        for key, value in handler.headers.items():
            if key.lower() == "host":
                headers += "Host: localhost\r\n"
            else:
                headers += f"{key}: {value}\r\n"
        # Ensure Host is present even if client didn't send one
        if "host" not in [k.lower() for k in handler.headers]:
            headers += "Host: localhost\r\n"
        upgrade_request = request_line + headers + "\r\n"
        target.sendall(upgrade_request.encode())

        # Bidirectional tunnel
        def pump(src, dst):
            try:
                while True:
                    data = src.recv(65536)
                    if not data:
                        break
                    dst.sendall(data)
            except (OSError, BrokenPipeError):
                pass
            finally:
                try:
                    dst.shutdown(socket.SHUT_WR)
                except OSError:
                    pass

        t1 = threading.Thread(target=pump, args=(client_sock, target), daemon=True)
        t2 = threading.Thread(target=pump, args=(target, client_sock), daemon=True)
        t1.start()
        t2.start()
        t1.join()
        t2.join()
    except Exception:
        pass
    finally:
        try:
            target.close()
        except Exception:
            pass


class CDPProxyServer(http.server.HTTPServer):
    """HTTP server that detects WebSocket upgrades and tunnels them."""

    def finish_request(self, request, client_address):
        # Peek at the request to detect WebSocket upgrades
        handler = CDPProxyHandler(request, client_address, self)


# Override do_GET to detect WebSocket upgrades and tunnel them
_orig_do_GET = CDPProxyHandler.do_GET


def _ws_aware_do_GET(self):
    upgrade = self.headers.get("Upgrade", "").lower()
    if upgrade == "websocket":
        handle_websocket_upgrade(self)
    else:
        _orig_do_GET(self)


CDPProxyHandler.do_GET = _ws_aware_do_GET


def main():
    if len(sys.argv) != 3:
        print(f"Usage: {sys.argv[0]} <listen-port> <target-port>", file=sys.stderr)
        sys.exit(1)

    listen_port = int(sys.argv[1])
    target_port = int(sys.argv[2])
    CDPProxyHandler.target_port = target_port

    server = CDPProxyServer((LISTEN_HOST, listen_port), CDPProxyHandler)
    server.serve_forever()


if __name__ == "__main__":
    main()
