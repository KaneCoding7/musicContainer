# Develop, preview, and deploy without interrupting playback

Two goals:

1. **Develop & preview** changes safely, without touching the live library or
   interrupting anyone.
2. **Hold the live rebuild until midnight**, so merging during the day doesn't
   restart the server while people are listening.

> **Which branch is "live"?** This repo's default branch — the one everyone uses
> and the live server tracks — is currently **`claude/music-container-repo-72yqub`**
> (there is no branch literally named `main`). The deploy tooling below
> auto-detects whatever branch the live checkout is on, so you don't have to
> hardcode that name anywhere.

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

Today, merging rebuilds the live server right away — which interrupts playback.
Instead, let the live branch collect work all day and rebuild the server
**once, at midnight**, via a systemd timer. Merges during the day change
nothing on the server until then.

### Install it (once, on the live host)

From the cloned repo on the live server, run the installer. It writes the
systemd units pointed at this repo (no manual path editing), pins the branch the
checkout is currently on, and enables the timer:

```bash
sudo ./scripts/install-nightly-deploy.sh
# deploying a different branch? sudo DEPLOY_BRANCH=some-branch ./scripts/install-nightly-deploy.sh
```

Check it:

```bash
systemctl list-timers music-deploy.timer    # see the next midnight run
journalctl -u music-deploy.service -f        # watch a run's output
```

What the nightly run does (`scripts/deploy.sh`):

- fetches the live branch (the one the checkout is on, unless `DEPLOY_BRANCH` is set),
- if there are **no** new commits, does nothing (no needless rebuild),
- otherwise updates the working tree and runs `docker compose up -d --build`,
- prunes old images.

> **One thing you must do:** disable whatever rebuilds the server on merge today,
> so the timer is the only thing that deploys. There is no auto-deploy in this
> repo (CI only runs tests/builds), so this is whatever you or a teammate runs by
> hand or wired up on the host.

Need to ship a hotfix immediately (any time of day)?

```bash
./scripts/deploy.sh           # rebuild now if there are new commits
FORCE=1 ./scripts/deploy.sh   # rebuild now no matter what
```

No `cron`/`systemd` on the host? Same effect with a crontab line (uses host
local time; adjust the path to your clone):

```cron
0 0 * * *  cd /opt/musicContainer && ./scripts/deploy.sh >> /var/log/music-deploy.log 2>&1
```

---

## TL;DR

- Preview a branch:  `./scripts/preview.sh`  → http://localhost:3100
- Install once on the host:  `sudo ./scripts/install-nightly-deploy.sh`
- Live server then rebuilds at **local midnight**, only if there's new work.
- Merge whenever you want during the day — nobody's music skips.
- Emergency push:  `FORCE=1 ./scripts/deploy.sh` on the host.
