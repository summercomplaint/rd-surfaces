"""
Tiny local remesh server for the web UI.
Run:  python remesh_server.py
Then open web/index.html via a local HTTP server (e.g. python -m http.server 8080 -d web).

The web app will POST an OBJ or STL to http://localhost:5174/remesh and receive
back a binary STL of the isotropically remeshed result.
"""

import io
import sys
import tempfile
import traceback
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import numpy as np
import trimesh

sys.path.insert(0, str(Path(__file__).parent))
from mesh_utils import auto_subdivide, load_mesh

PORT = 5174
ALLOW_ORIGIN = "*"   # any localhost page can call us


def remesh_bytes(data: bytes, ext: str, min_faces: int = 12000) -> bytes:
    """Load mesh from bytes, remesh, return binary STL bytes."""
    with tempfile.NamedTemporaryFile(suffix=f".{ext}", delete=False) as f:
        f.write(data)
        tmp = Path(f.name)
    try:
        mesh = load_mesh(str(tmp))
        mesh = auto_subdivide(mesh, min_faces=min_faces)
        stl_bytes = mesh.export(file_type="stl")
        return stl_bytes
    finally:
        tmp.unlink(missing_ok=True)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f"[server] {fmt % args}")

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", ALLOW_ORIGIN)
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Filename")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self):
        from urllib.parse import urlparse, parse_qs
        parsed = urlparse(self.path)
        if parsed.path != "/remesh":
            self.send_error(404)
            return
        params   = parse_qs(parsed.query)
        min_faces = int(params.get("faces", ["12000"])[0])
        length = int(self.headers.get("Content-Length", 0))
        data = self.rfile.read(length)
        filename = self.headers.get("X-Filename", "mesh.stl")
        ext = filename.rsplit(".", 1)[-1].lower()
        if ext not in ("stl", "obj"):
            self.send_error(400, "Only OBJ and STL supported")
            return
        try:
            result = remesh_bytes(data, ext, min_faces=min_faces)
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(len(result)))
            self.end_headers()
            self.wfile.write(result)
        except Exception:
            traceback.print_exc()
            self.send_error(500, "Remesh failed — see server console")


if __name__ == "__main__":
    print(f"Remesh server listening on http://localhost:{PORT}")
    print("Press Ctrl-C to stop.\n")
    HTTPServer(("localhost", PORT), Handler).serve_forever()
