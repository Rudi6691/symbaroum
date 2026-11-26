#!/usr/bin/env python3
"""Symbaroum V14 - Auslieferungs-Schnürung (Testumgebung v1, Entscheidung A1).

Bündelt Rudolfs Auslieferungs-Konventionen als ausführbaren Code, damit
nicht jede Lieferung von Hand geschnürt wird:

  1. installation.zip   - git archive des Release-Stands (respektiert
     .gitattributes export-ignore) plus die neuen/geänderten Dateien der
     Lieferung: der komplette Modulbaum in einem reproduzierbaren Schritt.
  2. overlay.zip        - NUR die neuen/geändarten Dateien einer Lieferung
     (zum Überstülpen über einen bestehenden Baum).
  3. Hash-Tabelle       - MD5 und SHA-256 je Datei als Markdown-Tabelle
     fürs Auslieferungsdoc (Copy&Paste-ready).
  4. Roundtrip-Prüfung  - nach dem Schnüren wird jedes Archiv wieder
     gelesen: Einträge vorhanden, Inhalte byte-identisch zur Quelle.

Nur Python-Standardbibliothek (git wird als subprocess aufgerufen).

Beispiele:
    python scripts/package_delivery.py --name Symbaroum-V14-Testumgebung-v1 \
        --files package.json vitest.config.mjs AGENTS.md scripts/validate.mjs

    python scripts/package_delivery.py --overlay-only --name Beispiel \
        --files dialog.js
"""

from __future__ import annotations

import argparse
import hashlib
import io
import subprocess
import sys
import zipfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def fail(message: str) -> None:
    print(f"FEHLER: {message}", file=sys.stderr)
    sys.exit(1)


def git_archive_bytes(treeish: str = "HEAD") -> bytes:
    """git archive als ZIP-Bytes (respektiert export-ignore)."""
    result = subprocess.run(
        ["git", "archive", "--format=zip", treeish],
        cwd=REPO_ROOT,
        capture_output=True,
    )
    if result.returncode != 0:
        fail(f"git archive schlug fehl: {result.stderr.decode(errors='replace').strip()}")
    return result.stdout


def read_files(file_list: list[str]) -> dict[str, bytes]:
    """Liest die gelisteten Dateien (Repo-relativ) ein."""
    contents: dict[str, bytes] = {}
    for name in file_list:
        path = REPO_ROOT / name
        if not path.is_file():
            fail(f"Datei nicht gefunden: {name}")
        contents[name.replace("\\", "/")] = path.read_bytes()
    return contents


def build_zip(entries: dict[str, bytes], out_path: Path) -> None:
    """Schreibt alle Einträge (Pfad -> Bytes) in ein ZIP mit deterministischer
    Reihenfolge (Stabilität statt Zeitstempel)."""
    with zipfile.ZipFile(out_path, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
        for name in sorted(entries):
            bundle.writestr(name, entries[name])


def verify_roundtrip(out_path: Path, expected: dict[str, bytes]) -> None:
    """Roundtrip: Archiv lesen, jeden Eintrag byte-identisch vergleichen."""
    with zipfile.ZipFile(out_path) as bundle:
        names = set(bundle.namelist())
        missing = set(expected) - names
        if missing:
            fail(f"Roundtrip: Einträge fehlen im ZIP: {sorted(missing)}")
        for name in sorted(expected):
            if bundle.read(name) != expected[name]:
                fail(f"Roundtrip: Inhalt weicht ab: {name}")


def hash_line(data: bytes) -> tuple[str, str]:
    md5 = hashlib.md5(data).hexdigest()
    sha256 = hashlib.sha256(data).hexdigest()
    return md5, sha256


def markdown_table(title: str, entries: dict[str, bytes]) -> str:
    """Hash-Tabelle fürs Auslieferungsdoc (MD5 + SHA-256 je Datei)."""
    lines = [f"**{title}**", "", "| Datei | MD5 | SHA-256 |", "| --- | --- | --- |"]
    for name in sorted(entries):
        md5, sha256 = hash_line(entries[name])
        lines.append(f"| `{name}` | `{md5}` | `{sha256}` |")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--name", required=True, help="Basisname der Zips, z. B. Symbaroum-V14-Testumgebung-v1")
    parser.add_argument("--files", nargs="+", required=True, help="neue/geänderte Dateien (Repo-relativ)")
    parser.add_argument("--overlay-only", action="store_true", help="nur overlay.zip schnüren (ohne git archive)")
    parser.add_argument("--out", default=".", help="Ausgabe-Ordner (Default: aktuelles Verzeichnis)")
    args = parser.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    changed = read_files(args.files)

    if not args.overlay_only:
        # 1. installation.zip: git archive + Lieferungs-Dateien.
        base = io.BytesIO(git_archive_bytes())
        installation: dict[str, bytes] = {}
        with zipfile.ZipFile(base) as archive:
            for name in archive.namelist():
                installation[name] = archive.read(name)
        overlaps = set(installation) & set(changed)
        if overlaps:
            print(f"Hinweis: {len(overlaps)} Datei(en) ersetzen den Archiv-Stand: {sorted(overlaps)}")
        installation.update(changed)
        installation_path = out_dir / f"{args.name}-Installation.zip"
        build_zip(installation, installation_path)
        verify_roundtrip(installation_path, installation)
        print(f"[OK] {installation_path.name}: {len(installation)} Dateien, Roundtrip grün")
        print(markdown_table(f"Hashes {installation_path.name}", {installation_path.name: installation_path.read_bytes()}))
        print()

    # 2. overlay.zip: nur die Lieferungs-Dateien.
    overlay_path = out_dir / f"{args.name}-Overlay.zip"
    build_zip(changed, overlay_path)
    verify_roundtrip(overlay_path, changed)
    print(f"[OK] {overlay_path.name}: {len(changed)} Dateien, Roundtrip grün")
    print(markdown_table(f"Hashes {overlay_path.name} (Einzeldateien)", changed))

    print("\nFERTIG - Hash-Tabellen oben ins Auslieferungsdoc übernehmen.")


if __name__ == "__main__":
    main()
