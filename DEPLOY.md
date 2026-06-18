# Develop, preview, and deploy without interrupting playback

Two goals:

1. **Develop & preview** changes safely, without touching the live library or
   interrupting anyone.
2. **Hold the live rebuild until midnight**, so merging during the day doesn't
   restart the server while people are listening.

---

## 1. Preview any branch alongside the live server

The preview stack is a full, isolated copy of the app:

| | Live (production) | Preview |
|---|---|---|
| Frontend | http://localhost:3000 | http://localhost:3100 |
| Backend  | http://localhost:3001 | http://localhost:3101 |
| Data dir | `./data` (real library) | `./data-preview` (sandbox) |
| Containers | `music-*` | `music-preview-*` |

Check out the branch you want to try, then:

```bash
./scripts/preview.sh
# open http://localhost:3100
```

Because it has its own database and audio dir, you can upload junk, delete
things, and break stuff freely — the live server and everyone's music are
untouched. Tear it down with:

```bash
docker compose -p music-preview -f docker-compose.preview.yml down
```

(The `./data-preview` folder is git-ignored, so it never gets committed.)

> Prefer hot-reload while coding? `docker-compose.dev.yml` is still there for
> live source reloading. The preview stack is for testing a *built* copy that
> behaves like production.

---

## 2. Deploy only at midnight (not on every merge)

Today, merging to `main` rebuilds the live server right away — which interrupts
playback. Instead, let `main` collect work all day and rebuild the live server
**once, at midnight**. Pick ONE of the two ways below.

### Option A — Nightly rebuild on the host (recommended)

The live server rebuilds itself at local midnight via a systemd timer. Merges
during the day change nothing on the server until then.

On the live host, from the cloned repo, run the installer once. It writes the
systemd units pointed at this repo (no manual path editing) and enables the
timer:

```bash
sudo ./scripts/install-nightly-deploy.sh
# deploying a different branch? sudo DEPLOY_BRANCH=production ./scripts/install-nightly-deploy.sh
```

Check it:

```bash
systemctl list-timers music-deploy.timer    # see the next midnight run
journalctl -u music-deploy.service -f        # watch a run's output
```

What the nightly run does (`scripts/deploy.sh`):

- fetches the deploy branch (`main` by default),
- if there are **no** new commits, does nothing (no needless rebuild),
- otherwise updates the working tree and runs `docker compose up -d --build`,
- prunes old images.

**Disable whatever currently rebuilds on merge** so the timer is the only thing
that deploys.

Need to ship a hotfix immediately (any time of day)?

```bash
./scripts/deploy.sh           # rebuild now if there are new commits
FORCE=1 ./scripts/deploy.sh   # rebuild now no matter what
```

No `cron`/`systemd`? The same effect with cron:

```cron
0 0 * * *  cd /opt/musicContainer && ./scripts/deploy.sh >> /var/log/music-deploy.log 2>&1
```

### Option B — Nightly branch promotion (if the host auto-deploys a branch)

If your live server auto-deploys whatever lands on a branch (a webhook, a
poller, etc.), point it at a **`production`** branch instead of `main`, and let
`.github/workflows/nightly-promote.yml` fast-forward `production` to `main` at
midnight. Then:

- everyone merges into `main` all day → live server untouched,
- at midnight, `production` catches up to `main` → live server deploys once.

Create the branch once:

```bash
git push origin main:production
```

> Heads up: GitHub Actions cron is **UTC**. Edit the `cron:` line in the
> workflow to match your local midnight. You can also run it on demand from the
> Actions tab ("Run workflow").

---

## TL;DR

- Preview a branch:  `./scripts/preview.sh`  → http://localhost:3100
- Live server rebuilds at **midnight** (Option A timer, or Option B promote).
- Merge to `main` whenever you want during the day — nobody's music skips.
- Emergency push:  `FORCE=1 ./scripts/deploy.sh` on the host.
