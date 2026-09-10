#!/bin/sh
set -eu

if [ "$#" -ne 2 ]; then
    echo "usage: backup_sqlite.sh SOURCE_DB DESTINATION_DB" >&2
    exit 2
fi

python3 - "$1" "$2" <<'PY'
import sqlite3
import sys
from pathlib import Path

source = Path(sys.argv[1])
destination = Path(sys.argv[2])
destination.parent.mkdir(parents=True, exist_ok=True)
with sqlite3.connect(source) as source_connection, sqlite3.connect(destination) as destination_connection:
    source_connection.backup(destination_connection)
print(f"backup_created={destination}")
PY
