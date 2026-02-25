#!/usr/bin/env python3
"""
Find referenced .png and .ipynb assets inside .html/.js/.css files in a folder tree,
and print all unique filenames.

Usage:
  python find_asset_refs.py /path/to/folder
  python find_asset_refs.py . --extensions .png .ipynb
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path
from typing import Iterable, Set, Tuple


def iter_source_files(root: Path, exts: Tuple[str, ...]) -> Iterable[Path]:
    for p in root.rglob("*"):
        if p.is_file() and p.suffix.lower() in exts:
            yield p


def compile_ref_regex(target_exts: Tuple[str, ...]) -> re.Pattern:
    """
    Matches strings that look like paths/URLs ending in one of the target extensions.
    Attempts to avoid trailing punctuation and query/hash fragments.
    """
    # Example matches:
    #   images/foo.png
    #   ./bar/baz.ipynb
    #   https://x/y/z.png?raw=1#v
    #   "foo.png"
    # We'll capture up to the extension; ignore ?... and #...
    escaped = "|".join(re.escape(e.lstrip(".").lower()) for e in target_exts)
    pattern = rf"""
        (?P<full>
            (?:
                [a-zA-Z]+://[^\s"'()<>\]]+ |     # URL-ish
                [^\s"'()<>\]]+                   # path-ish
            )
            \.(?:{escaped})
        )
        (?:\?[^\s"'()<>\]]*)?                   # optional query
        (?:\#[^\s"'()<>\]]*)?                   # optional hash
    """
    return re.compile(pattern, re.VERBOSE | re.IGNORECASE)


def extract_filenames_from_text(text: str, ref_re: re.Pattern) -> Set[str]:
    found: Set[str] = set()
    for m in ref_re.finditer(text):
        full = m.group("full")
        # Strip possible surrounding punctuation that sometimes sticks
        full = full.strip('"\';,).]}')
        # Take basename
        base = os.path.basename(full)
        if base:
            found.add(base)
    return found


def read_text_file(path: Path) -> str:
    # Try UTF-8 first; fall back to latin-1 to avoid crashing on odd encodings
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return path.read_text(encoding="latin-1", errors="replace")


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Find referenced .png and .ipynb inside .html/.js/.css files and print unique filenames."
    )
    ap.add_argument(
        "root",
        nargs="?",
        default=".",
        help="Folder to scan (default: current directory).",
    )
    ap.add_argument(
        "--source-exts",
        nargs="*",
        default=[".html", ".js", ".css"],
        help="Source file extensions to scan (default: .html .js .css).",
    )
    ap.add_argument(
        "--extensions",
        nargs="*",
        default=[".png", ".ipynb"],
        help="Target referenced extensions to find (default: .png .ipynb).",
    )

    args = ap.parse_args()
    root = Path(args.root).resolve()

    if not root.exists() or not root.is_dir():
        print(f"Error: root folder does not exist or is not a directory: {root}", file=sys.stderr)
        return 2

    source_exts = tuple(e.lower() if e.startswith(".") else f".{e.lower()}" for e in args.source_exts)
    target_exts = tuple(e.lower() if e.startswith(".") else f".{e.lower()}" for e in args.extensions)

    ref_re = compile_ref_regex(target_exts)

    all_found: Set[str] = set()
    scanned_files = 0

    for src in iter_source_files(root, source_exts):
        scanned_files += 1
        text = read_text_file(src)
        all_found |= extract_filenames_from_text(text, ref_re)

    for name in sorted(all_found, key=str.lower):
        print(name)

    print(f"\nScanned {scanned_files} source files under: {root}", file=sys.stderr)
    print(f"Found {len(all_found)} unique filenames ending in {', '.join(target_exts)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())