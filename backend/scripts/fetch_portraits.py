#!/usr/bin/env python3
"""Pull freely-licensed driver portraits from Wikimedia Commons.

Build-time only. Writes JPEGs into frontend/public/drivers/ plus a credits file,
so the running app never touches the network. Any image whose Commons licence is
not clearly free is skipped rather than shipped.

Usage:
    python scripts/fetch_portraits.py          # every driver in TITLES
    python scripts/fetch_portraits.py DEV ...  # only these codes
"""
from __future__ import annotations

import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "frontend" / "public" / "drivers"
OUT.mkdir(parents=True, exist_ok=True)

# Longest side, matching the portraits already in the repo (520px tall).
LONG_EDGE = 520
JPEG_QUALITY = 72

UA = "SilentCoDriver-Hackathon/1.0 (offline demo; contact: akshats@damcogroup.com)"

TITLES = {
    "VER": "Max Verstappen",
    "PER": "Sergio Pérez",
    "HAM": "Lewis Hamilton",
    "RUS": "George Russell (racing driver)",
    "LEC": "Charles Leclerc",
    "SAI": "Carlos Sainz Jr.",
    "NOR": "Lando Norris",
    "PIA": "Oscar Piastri",
    "ALO": "Fernando Alonso",
    "STR": "Lance Stroll",
    "OCO": "Esteban Ocon",
    "GAS": "Pierre Gasly",
    "ALB": "Alexander Albon",
    "SAR": "Logan Sargeant",
    "COL": "Franco Colapinto",
    "TSU": "Yuki Tsunoda",
    "RIC": "Daniel Ricciardo",
    "LAW": "Liam Lawson",
    "DEV": "Nyck de Vries",
    "BOT": "Valtteri Bottas",
    "ZHO": "Zhou Guanyu",
    "MAG": "Kevin Magnussen",
    "HUL": "Nico Hülkenberg",
}

# Anything not on this list is treated as unclear and skipped.
FREE = ("cc0", "cc by", "cc-by", "public domain", "pd-", "attribution", "ogl")


def get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=25) as r:
        return r.read()


def summary(title: str) -> dict:
    slug = urllib.parse.quote(title.replace(" ", "_"), safe="")
    return json.loads(get(f"https://en.wikipedia.org/api/rest_v1/page/summary/{slug}"))


def licence(filename: str) -> dict:
    q = urllib.parse.urlencode(
        {
            "action": "query",
            "titles": f"File:{filename}",
            "prop": "imageinfo",
            "iiprop": "extmetadata",
            "format": "json",
        }
    )
    data = json.loads(get(f"https://commons.wikimedia.org/w/api.php?{q}"))
    page = next(iter(data["query"]["pages"].values()))
    meta = page["imageinfo"][0]["extmetadata"]
    strip = lambda s: __import__("re").sub(r"<[^>]+>", "", s or "").strip()
    return {
        "licence": strip(meta.get("LicenseShortName", {}).get("value")),
        "author": strip(meta.get("Artist", {}).get("value")),
        "url": meta.get("LicenseUrl", {}).get("value", ""),
    }


wanted = [c.upper() for c in sys.argv[1:]]
unknown = [c for c in wanted if c not in TITLES]
if unknown:
    sys.exit(
        f"Unknown driver code(s): {', '.join(unknown)}\n"
        f"Known: {', '.join(sorted(TITLES))}"
    )
targets = {c: TITLES[c] for c in wanted} if wanted else TITLES

credits = {}
for code, title in targets.items():
    try:
        s = summary(title)
        src = (s.get("originalimage") or s.get("thumbnail") or {}).get("source")
        if not src:
            print(f"  – {code}: no image on {title!r}", file=sys.stderr)
            continue

        filename = urllib.parse.unquote(src.split("?")[0].rsplit("/", 1)[-1])
        # Thumbnails of the "px-" form carry a size prefix; drop it.
        if filename.split("-")[0].endswith("px"):
            filename = filename.split("-", 1)[1]

        lic = licence(filename)
        if not any(tag in lic["licence"].lower() for tag in FREE):
            print(f"  ✗ {code}: {lic['licence']!r} is not clearly free — skipped", file=sys.stderr)
            continue

        # Special:FilePath renders a scaled copy server-side.
        scaled = (
            "https://commons.wikimedia.org/wiki/Special:FilePath/"
            + urllib.parse.quote(filename)
            + "?width=560"
        )
        raw = OUT / f"{code}.raw"
        raw.write_bytes(get(scaled))

        # Pillow rather than macOS `sips`, which this used to shell out to and
        # which does not exist off a Mac. `thumbnail` matches `sips -Z`: fit the
        # longest side, aspect preserved, never upscale. RGB because a Commons
        # source may be a palettised or alpha PNG and JPEG takes neither.
        dest = OUT / f"{code}.jpg"
        with Image.open(raw) as im:
            im = im.convert("RGB")
            im.thumbnail((LONG_EDGE, LONG_EDGE), Image.LANCZOS)
            im.save(dest, "JPEG", quality=JPEG_QUALITY, optimize=True)
        raw.unlink()

        credits[code] = {
            "name": s["title"],
            "file": filename,
            "licence": lic["licence"],
            "author": lic["author"],
            "licenceUrl": lic["url"],
        }
        print(f"  ✓ {code}: {lic['licence']} — {dest.stat().st_size // 1024} KB", file=sys.stderr)
    except Exception as e:  # noqa: BLE001 — one bad driver must not stop the run
        print(f"  ! {code}: {e}", file=sys.stderr)

print(json.dumps(credits, ensure_ascii=False, indent=2))
