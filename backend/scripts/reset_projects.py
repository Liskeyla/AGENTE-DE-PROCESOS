"""Elimina todos los proyectos y limpia uploads (solo desarrollo local)."""
import json
import shutil
import urllib.request
from pathlib import Path

BASE = "http://127.0.0.1:8002/api/v1"


def req(method: str, path: str, token: str | None = None, data: dict | None = None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    body = json.dumps(data).encode() if data else None
    request = urllib.request.Request(BASE + path, data=body, headers=headers, method=method)
    with urllib.request.urlopen(request) as resp:
        return json.loads(resp.read().decode())


def main():
    login = req("POST", "/auth/login", data={"email": "demo@empresa.com", "password": "demo1234"})
    token = login["access_token"]
    projects = req("GET", "/projects", token=token)
    print(f"Proyectos encontrados: {len(projects)}")
    for p in projects:
        req("DELETE", f"/projects/{p['id']}", token=token)
        print(f"  Eliminado: {p['name']}")
    remaining = req("GET", "/projects", token=token)
    print(f"Proyectos restantes: {len(remaining)}")

    uploads = Path(__file__).resolve().parent.parent / "uploads"
    if uploads.exists():
        shutil.rmtree(uploads)
    uploads.mkdir(exist_ok=True)
    print("Carpeta uploads limpiada")


if __name__ == "__main__":
    main()
