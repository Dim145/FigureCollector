# Backup & restore

Two stateful surfaces: **Postgres** (the relational graph) and **Garage** (the photo bucket).

## Postgres

### Daily logical dump

```bash
docker compose exec postgres pg_dump -U figurecollector --format=custom \
  > backups/figurecollector-$(date +%Y%m%d).dump
```

The `--format=custom` flag produces a binary dump that's smaller, supports parallel restore, and lets you selectively restore specific tables.

### Restore

```bash
# Wipe + restore (destructive)
docker compose down -v
docker compose up -d postgres
docker compose exec -T postgres \
  pg_restore -U figurecollector -d figurecollector --clean --if-exists \
  < backups/figurecollector-20260526.dump
docker compose up -d
```

Migrations are idempotent (`IF NOT EXISTS`/`OR REPLACE`), so the SeaORM runner will skip already-applied migrations on restart.

## Garage (S3 bucket)

Garage has its own snapshot mechanism but the simplest approach for a single-node Garage is to back up the volumes directly:

```bash
docker compose stop garage
tar czf backups/garage-data-$(date +%Y%m%d).tar.gz \
    -C /var/lib/docker/volumes/figurecollector_garage_data .
tar czf backups/garage-meta-$(date +%Y%m%d).tar.gz \
    -C /var/lib/docker/volumes/figurecollector_garage_meta .
docker compose start garage
```

For multi-node Garage, use `garage block sync` to replicate to a backup node instead.

## What about the photos themselves?

Photo content lives in Garage (or the filesystem fallback if you didn't configure S3). Backing up Garage covers it. The photo **metadata** (which user, which figure, primary flag, position) lives in Postgres — backing up Postgres covers that.

## Restore drill

Run a restore drill **before** you need it:

1. Spin up an empty stack on a side machine.
2. Restore the Postgres dump + Garage tarballs.
3. Sign in, browse to a figure with photos, confirm everything works.

A backup you've never restored isn't a backup.

## What's not backed up

- **Sessions** (`tower_sessions` rows in Postgres) — recreated on user login.
- **Service Worker caches** — recreated on user visit.
- **Notification dedup table** — rebuilds itself.
- **The `seaql_migrations` table** — restored along with the rest of Postgres; no special handling.
