from __future__ import annotations

import sqlite3
import subprocess
import os
import sys
from pathlib import Path

from app.db import build_engine, initialize_database, session_factory
from app.models import User
from app.settings import Settings

ROOT = Path(__file__).parents[1]


def test_deployment_files_enforce_single_worker_data_mount_and_secret_hygiene():
    dockerfile = (ROOT / "Dockerfile").read_text()
    compose = (ROOT / "docker-compose.yml").read_text()

    assert "--workers\", \"1" in dockerfile
    assert "./data:/app/data" in compose
    assert "OPENROUTER_API_KEY" not in dockerfile
    assert "healthcheck:" in compose
    assert (ROOT / "alembic" / "env.py").exists()


def test_health_endpoint_is_available_in_app():
    from fastapi.testclient import TestClient
    from app.main import create_app

    assert TestClient(create_app()).get("/healthz").json() == {"status": "ok"}


def test_backup_and_restore_check_preserve_expected_records(tmp_path):
    source = tmp_path / "source.db"
    backup = tmp_path / "backup.db"
    engine = build_engine(Settings(database_url=f"sqlite:///{source}", data_dir=tmp_path))
    initialize_database(engine)
    with session_factory(engine)() as session:
        session.add(User(google_subject="backup-subject", email="backup@example.com"))
        session.commit()

    subprocess.run([str(ROOT / "scripts" / "backup_sqlite.sh"), str(source), str(backup)], check=True)
    result = subprocess.run([str(ROOT / "scripts" / "restore_check.sh"), str(backup)], capture_output=True, text=True, check=True)

    assert "integrity_check=ok" in result.stdout
    with sqlite3.connect(backup) as connection:
        assert connection.execute("SELECT google_subject FROM users").fetchone() == ("backup-subject",)


def test_alembic_upgrade_runs_on_fresh_database(tmp_path):
    env = os.environ.copy()
    env["DATABASE_URL"] = f"sqlite:///{tmp_path / 'migrated.db'}"

    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr


def test_requirements_declare_google_auth_requests_transport():
    """app/auth.py imports google.auth.transport.requests to verify ID tokens.

    That module needs the `requests` package, which google-auth only installs
    through its `requests` extra. Declaring bare google-auth builds a container
    where the OAuth callback raises at runtime.
    """
    requirements = (ROOT / "requirements.txt").read_text()
    assert "google-auth[requests]" in requirements


def test_alembic_can_import_the_app_from_its_own_directory():
    """`alembic upgrade head` runs as a console script, which does not add the
    working directory to sys.path. Without this the documented deploy command
    fails inside the container with ModuleNotFoundError: No module named 'app'.
    """
    assert "prepend_sys_path = ." in (ROOT / "alembic.ini").read_text()
