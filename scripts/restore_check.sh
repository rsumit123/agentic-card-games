#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
    echo "usage: restore_check.sh BACKUP_DB" >&2
    exit 2
fi

python3 - "$1" <<'PY'
import sqlite3
import sys

with sqlite3.connect(sys.argv[1]) as connection:
    result = connection.execute("PRAGMA integrity_check").fetchone()[0]
if result != "ok":
    raise SystemExit(f"integrity_check_failed={result}")
print("integrity_check=ok")
PY
