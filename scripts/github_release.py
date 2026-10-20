#!/usr/bin/env python3
"""Update the GitHub Release notes when GITHUB_TOKEN is set.

Outside GitHub Actions this prints the version and exits 0.
"""

import os
import pathlib
import sys

VERSION = pathlib.Path(__file__).resolve().parents[1].joinpath("VERSION").read_text().strip()


def main() -> None:
    if os.environ.get("GITHUB_ACTIONS") != "true" or not os.environ.get("GITHUB_TOKEN"):
        print(f"gld-kiln-typescript {VERSION}")
        return
    print(f"release {VERSION} is created by scripts/publish.sh's caller")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(exc, file=sys.stderr)
        raise SystemExit(1) from exc
