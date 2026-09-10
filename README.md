# Glass Orchard

Glass Orchard is a self-managed, play-money Texas Hold'em table service. Version one is a single FastAPI process with an in-process room actor, SQLite WAL storage, Google OIDC sessions, and optional OpenRouter decision adapters for AI seats.

## Local deployment

1. Copy `.env.example` to `.env` and set a long random `SESSION_SECRET`, the Google OAuth client values, and the public `ALLOWED_ORIGIN`.
2. Run `docker compose up -d --build`.
3. Check `curl http://127.0.0.1:8000/healthz` and inspect `docker compose ps`.

The service binds only to the VM loopback interface, mounts `./data` at `/app/data`, and runs exactly one Uvicorn worker. Never commit `.env`, the mounted data directory, or provider credentials.

## Migrations and backups

Run migrations inside the service container with `docker compose exec card-games alembic upgrade head`. The application also performs an idempotent metadata check during startup so a fresh mounted volume can boot safely.

Create a consistent SQLite backup with:

```sh
./scripts/backup_sqlite.sh data/card_games.db backups/card_games-$(date +%Y%m%d-%H%M%S).db
./scripts/restore_check.sh backups/card_games-YYYYMMDD-HHMMSS.db
```

Keep backups outside the live `data` mount and periodically test restoring one to a temporary file before relying on it.

## Nginx reverse proxy

Terminate TLS at the existing VM Nginx and proxy HTTP and WebSocket traffic to `127.0.0.1:8000`. The table socket needs HTTP/1.1 upgrade headers:

```nginx
location / {
    proxy_pass http://127.0.0.1:8000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 75s;
}
```

Use a certificate for the public hostname, redirect HTTP to HTTPS, and set `ALLOWED_ORIGIN` to the exact HTTPS origin. Session cookies become Secure in production. Do not expose the container port publicly when Nginx runs on the same VM.

## Development

```sh
python3 -m pytest -q
docker compose config
```

The game engine is deterministic given injected random bytes, while production shuffling and room-code generation use cryptographically secure randomness. The canonical game state stays server-side; each connected seat receives its own projection.
