# Deploying the music app (beats = DEV, playlist = PROD)

One script, two environments, immutable builds. DEV tests a build first; PROD only accepts that
exact build once it has run healthy on DEV for 24 h.

```
merge to main ──CI──▶ Docker Hub  mrkane7/music-{backend,frontend}:build-<run_id>-<sha7>   (immutable)
                        │  (job summary prints the build tag + digests)
sudo music-deploy dev  --build build-<run_id>-<sha7>     # resolves to digests, pins them in DEV .env
        … use beats.mrkane.dev for ≥ 24 h …
sudo music-deploy prod --promote                          # exactly what DEV runs; soak-gated; asks to confirm
```

| Command | What it does |
|---|---|
| `music-deploy <env> --build <build-tag>` | resolve a `build-*`/`sha-*` tag to digests and deploy them |
| `music-deploy <env> <backend@sha256:…> <frontend@sha256:…>` | deploy explicit digests |
| `music-deploy prod --promote` | deploy DEV's current digests to PROD (refused unless healthy on DEV ≥ `SOAK_HOURS`) |
| `music-deploy <env> --rollback` | go back to the previous code version (refused if the last deploy migrated the DB) |
| `music-deploy <env> --status` / `--check` | show versions/history / run all preflight checks, change nothing |
| `music-deploy <env> --baseline` | once per env: record the running images + schema as the starting state (changes nothing) |
| `--dry-run` `--yes` `--no-public` `--allow-active-writes` | plan only / skip prompt / skip public URL checks / don't wait for DB quiet |

## What a deploy does, in order
1. **Lock** (one deploy per env) and **preflight**: stack + `.env` + data dir look right; images are pinned by
   digest; config resolves; ≥ 5 GB free; previous deploy finished; live DB passes `quick_check`.
2. **Version checks**: refs must be `repo@sha256:` from the configured repo (`:latest`/`:dev` refused); images
   must exist locally or in the registry; no **downgrade across a migration**; PROD: **promotion gate**.
3. **Activity check**: refuses while an import runs (yt-dlp/spotdl/ffmpeg/aeneas in the backend); waits for the
   DB to be quiet (someone using the app) and refuses if it never is.
4. **Backup**: SQLite online backup of `app.db` → `BACKUP_DIR/<ts>-<env>-<old-digest>.db`, full `integrity_check`.
   **Any failure aborts before anything changes.**
5. Record `started` in `/var/lib/music-deploy/<env>.jsonl`, update `.env` atomically (other lines verified
   byte-identical), pull the new digest, recreate **backend + frontend only** (tunnel untouched).
6. **Verify**: containers healthy, local + public URLs 200, `quick_check` ok, key row counts ≥ before, music files ≥ before.
7. Record `success`. On failure:
   * schema unchanged → **automatic code rollback** to the previous digests (exit 2);
   * schema changed (migration ran) → **left as-is, alert, human decides** (exit 3). The script **never restores a
     database**; see runbook §9.5 for the manual, approved procedure;
   * previous version back but checks still fail → exit 4 ("probably not this deploy": tunnel/DNS/Caddy).
8. Every failure posts a `MusicDeployFailed` alert to Alertmanager (→ ntfy) and writes a log under
   `/var/lib/music-deploy/logs/`.

Interrupted (Ctrl-C / SIGTERM): before the recreate, `.env` is restored and nothing else changed; after it,
the run is recorded `interrupted` and `--rollback` returns to the version that ran before.

## Files
* `deploy.sh`: the script (install as `/usr/local/bin/music-deploy`)
* `conf/dev.conf`, `conf/prod.conf`: install to `/etc/music-deploy/`.
* `compose.dev.yaml`: the image-based DEV stack (Phase 4).
* `pin-images.sh`: give pinned PROD digests a permanent `pinned-*` Docker Hub tag (dry run by default; never overwrites).

PROD only accepts a build that was **deployed through `music-deploy` on DEV** (baselines don't count), ran healthy
there for `SOAK_HOURS`, and whose DEV runs include PROD's current DB schema (so a promotion can never be a downgrade
across a migration). The tool must run as root, and its config files must be root-owned and not group/world-writable.
* Tests: `~/music-phase3/tests/run-tests.sh` (disposable stacks; never touches live data).
