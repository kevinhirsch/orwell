"""Local-HTTPS CA root download (feature 0074 / ADR 0014).

A single UNAUTHENTICATED route that serves the on-box internal CA's PUBLIC root certificate, so a
fresh device can trust it ONCE and reach https://orwell.lan (and the LAN IP) with no browser warning.

Why unauthenticated: the root is a PUBLIC certificate (never a private key — that never leaves Caddy),
and a device must fetch + trust it BEFORE it can log in over HTTPS. The path is added to the FE's
AUTH_EXEMPT_EXACT set in app.py. Served only when the terminator has exported it
(data/tls/local-ca.crt — written by deploy/orwell-https.sh); 404 otherwise.

Vault-free: a static certificate file, no game state.
"""

import os

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

# Resolve the DEPLOY data tree the same way every ops lane does (DATA_DIR override honored).
from routes.admin_update_routes import _data_dir

CA_DOWNLOAD_PATH = "/orwell-local-ca.crt"


def _ca_path() -> str:
    return os.path.join(_data_dir(), "tls", "local-ca.crt")


def setup_local_ca_routes() -> APIRouter:
    router = APIRouter(tags=["local_ca"])

    @router.get(CA_DOWNLOAD_PATH)
    async def serve_local_ca_root():
        path = _ca_path()
        if not os.path.isfile(path):
            raise HTTPException(status_code=404, detail="No local CA root has been generated yet.")
        return FileResponse(
            path,
            media_type="application/x-x509-ca-cert",
            filename="orwell-local-ca.crt",
        )

    return router
