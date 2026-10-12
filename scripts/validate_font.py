"""Independent check of a Glyphsmith export, using fontTools.

    .venv/bin/python scripts/validate_font.py Font.ttf [Font.woff2]

fontTools shares no code with the TypeScript writer, so it catches the kind of
mistake a round trip through one's own parser never would. Prints a JSON
report and exits non-zero on the first failed check.
"""
from __future__ import annotations

import json
import sys
from io import BytesIO

from fontTools.pens.boundsPen import BoundsPen
from fontTools.ttLib import TTFont

UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
CHARSET = UPPER + UPPER.lower() + "0123456789" + ".,;:!?'\"-()[]{}/\\&@#$%*+=<>_"
REQUIRED = ["OS/2", "cmap", "glyf", "head", "hhea", "hmtx", "loca", "maxp", "name", "post"]


def fail(message: str) -> None:
    print(json.dumps({"ok": False, "error": message}))
    sys.exit(1)


def check(path: str) -> dict:
    font = TTFont(path)
    for tag in REQUIRED:
        if tag not in font:
            fail(f"{path}: missing table {tag}")
        font[tag]  # force a full decompile of every table

    if font.sfntVersion != "\x00\x01\x00\x00":
        fail(f"{path}: not TrueType flavoured")
    if font["head"].unitsPerEm != 1000:
        fail(f"{path}: unitsPerEm is {font['head'].unitsPerEm}")

    cmap = font.getBestCmap()
    glyph_set = font.getGlyphSet()
    missing, empty = [], []
    points = 0
    for ch in CHARSET:
        name = cmap.get(ord(ch))
        if not name or name == ".notdef":
            missing.append(ch)
            continue
        pen = BoundsPen(glyph_set)
        glyph_set[name].draw(pen)
        if pen.bounds is None:
            empty.append(ch)
        if font["hmtx"][name][0] <= 0:
            fail(f"{path}: {ch!r} has no advance width")
        glyph = font["glyf"][name]
        points += len(glyph.coordinates) if glyph.numberOfContours > 0 else 0
    if missing:
        fail(f"{path}: no glyph for {''.join(missing)!r}")
    if empty:
        fail(f"{path}: empty outline for {''.join(empty)!r}")
    if 32 not in cmap:
        fail(f"{path}: no space")

    # Recompile from scratch. If our bytes were subtly malformed, this is
    # where fontTools would raise or produce different tables.
    out = BytesIO()
    font.save(out)
    again = TTFont(BytesIO(out.getvalue()))
    if again.getGlyphOrder() != font.getGlyphOrder():
        fail(f"{path}: glyph order changed on recompile")

    return {
        "file": path,
        "flavor": font.flavor or "ttf",
        "glyphs": len(font.getGlyphOrder()),
        "covered": len(CHARSET),
        "points": points,
        "family": font["name"].getDebugName(1),
        "italicAngle": round(font["post"].italicAngle, 2),
        "xHeight": font["OS/2"].sxHeight,
    }


def main() -> None:
    if len(sys.argv) < 2:
        fail("usage: validate_font.py Font.ttf [Font.woff2]")
    reports = [check(p) for p in sys.argv[1:]]
    if len(reports) == 2:
        a, b = (TTFont(p) for p in sys.argv[1:3])
        for name in a.getGlyphOrder():
            if a["glyf"][name] != b["glyf"][name]:
                fail(f"woff2 and ttf disagree on glyph {name}")
    print(json.dumps({"ok": True, "fonts": reports}, indent=2))


if __name__ == "__main__":
    main()
