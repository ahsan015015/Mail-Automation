# Deployment Guide

Mail Automation is designed for operational simplicity: a single Node.js process with a single SQLite database file. It does not require Redis, Postgres, external queue workers, or third-party telemetry services.

---

## Architecture & Single-Instance Constraint

- **Embedded Database**: The backend utilizes Node.js built-in `node:sqlite` with Write-Ahead Logging (`PRAGMA journal_mode=WAL`).
- **In-Process Send Engine**: Background dispatching, rate limits, sending windows, retries, and drip sequence progression are driven by an internal loop in the same process.
- **Exactly One Instance**: You **must run exactly one instance** of Mail Automation. Because SQLite is file-based and the sending engine executes in-process, running multiple instances sharing a filesystem will cause lock contention, database corruption, and duplicate sends.

---

## 1. Docker / VPS Deployment

Mount a persistent directory to `/app/var` inside the container:

```bash
# Build the image
docker build -t mail-automation .

# Run with persistent volume
docker run -d \
  --name mail-automation \
  --restart unless-stopped \
  -p 8787:8787 \
  -e SESSION_SECRET="$(openssl rand -hex 32)" \
  -v /var/data/mail-automation:/app/var \
  mail-automation
```

### Docker Compose Example (`docker-compose.yml`)

```yaml
services:
  mail-automation:
    image: mail-automation
    build: .
    restart: unless-stopped
    ports:
      - "8787:8787"
    environment:
      - PORT=8787
      - HOST=0.0.0.0
      - DB_PATH=/app/var/mail-automation.db
      - MAIL_DIR=/app/var/mail
      - SESSION_SECRET=replace-with-a-random-32-byte-hex-string
      - NODE_ENV=production
    volumes:
      - mail_data:/app/var

volumes:
  mail_data:
```

---

## 2. Fly.io Deployment

The repository includes a ready-to-use `fly.toml` configuration.

### Steps:

1. **Launch App Configuration**:
   ```bash
   fly launch --no-deploy
   ```

2. **Create Persistent Volume**:
   ```bash
   fly volumes create mail_data --region iad --size 1
   ```

3. **Set Secrets**:
   ```bash
   fly secrets set SESSION_SECRET="$(openssl rand -hex 32)"
   ```

4. **Deploy**:
   ```bash
   fly deploy
   ```

> **Note**: `fly.toml` is pre-configured with `min_machines_running = 1` and `auto_stop_machines = "off"` to ensure continuous execution of the background sending engine. Do not scale beyond 1 machine (`fly scale count 1`).

---

## 3. Render Deployment

Render supports persistent disks on Starter and higher plans using the included `render.yaml` blueprint.

### Steps:

1. Connect your repository in the Render Dashboard.
2. Select **New Blueprint Instance** and choose `render.yaml`.
3. Render will provision:
   - A Web Service with Docker runtime.
   - A Persistent Disk mounted at `/app/var`.
   - Exactly 1 instance (`numInstances: 1`).
   - Automatically generated `SESSION_SECRET`.

---

## 4. GitHub Pages Static Demo Mode

When hosting on GitHub Pages (or any static CDN/bucket), the Express backend cannot run. Build with `VITE_DEMO=1` to enable the in-browser mock API backed by `localStorage`:

```bash
# Build for GitHub Pages (replace <repo-name> with your repository slug)
VITE_BASE=/<repo-name>/ VITE_DEMO=1 npm run build:client

# Copy index.html to 404.html for SPA routing fallback
cp dist/client/index.html dist/client/404.html

# Prevent Jekyll from ignoring files
touch dist/client/.nojekyll
```

The GitHub Actions workflow in `.github/workflows/pages.yml` automates this build on push to `main`.

---

## 5. SQLite WAL Mode & Backup Strategy

Mail Automation enables SQLite Write-Ahead Logging (`WAL` mode) for high-performance concurrent reads and writes.

### Understanding SQLite WAL Files

When the application is running, SQLite produces three related files in `/app/var`:
1. `mail-automation.db`: The main database file.
2. `mail-automation.db-wal`: The write-ahead log containing uncommitted or uncheckpointed transactions.
3. `mail-automation.db-shm`: The shared-memory index file used to coordinate readers and writers.

> **CRITICAL**: Copying only `mail-automation.db` while the server is running will result in a **corrupted or outdated backup**, because recent writes reside in `mail-automation.db-wal`.

### Safe Live Backup Methods

#### Method A: SQLite Online Backup (Recommended)

Run the SQLite CLI backup command, which takes a safe, transactionally consistent single-file snapshot while the application continues to write:

```bash
sqlite3 /app/var/mail-automation.db ".backup /backups/mail-automation-$(date +%Y%m%d%H%M%S).db"
```

Or using SQLite SQL statement (`VACUUM INTO`):

```sql
VACUUM INTO '/backups/mail-automation-backup.db';
```

#### Method B: Atomic Archive of All Three Files

If backing up files directly from the host filesystem, you **must archive all three files together**:

```bash
tar -czvf backup-$(date +%Y%m%d%H%M%S).tar.gz \
  /app/var/mail-automation.db \
  /app/var/mail-automation.db-wal \
  /app/var/mail-automation.db-shm
```

### Automated Backup Script Example (Cron)

```bash
#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="/var/backups/mail-automation"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
mkdir -p "$BACKUP_DIR"

# Perform online snapshot
sqlite3 /app/var/mail-automation.db ".backup ${BACKUP_DIR}/backup_${TIMESTAMP}.db"

# Compress and clean up older than 14 days
gzip "${BACKUP_DIR}/backup_${TIMESTAMP}.db"
find "$BACKUP_DIR" -name "*.db.gz" -mtime +14 -delete
```
