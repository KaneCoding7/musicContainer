# Develop, preview, and deploy without interrupting playback

Two goals:

1. **Develop & preview** changes safely, without touching the live library or
   interrupting anyone.
2. **Hold the live rebuild until midnight**, so merging during the day doesn't
   restart the server while people are listening.

> **Which branch is "live"?** The default branch — the one everyone uses and the
> live server tracks — is **`main`**. The deploy tooling below auto-detects
> whatever branch the live checkout is on, so renaming/changing it later needs
> no edits here.

---

## 1. Preview any branch alongside the live server

The preview stack is a full, isolated copy of the app:

| | Live (production) | Preview |
|---|---|---|
| Frontend | http://localhost:3000 | http://localhost:3100 |
| Backend  | http://localhost:3001 | http://localhost:3101 |
| Data dir | `./data` (real library) | `./data-preview` (sandbox) |
| Containers | `music-*` | `music-preview-*` |

Preview the branch you're on, or name a branch to fetch + preview it:

```bash
./scripts/preview.sh                     # the branch you're on
./scripts/preview.sh claude/some-branch  # fetch + preview a specific branch
# open http://localhost:3100
```

Because it has its own database and audio dir, you can upload junk, delete
things, and break stuff freely — the live server and everyone's music are
untouched. Tear it down with:

```bash
docker compose -p music-preview -f docker-compose.preview.yml down
```

(The `./data-preview` folder is git-ignored, so it never gets committed.)

> Run previews from a **dev clone or your laptop**, not the live server's deploy
> folder — that way switching branches to preview can't disturb what the nightly
> deploy ships.

### Previewing changes I (Claude) make for you

The flow that keeps `main` safe:

1. I make changes on a **feature branch** and open a PR — `main` is untouched.
2. You preview that branch:  `./scripts/preview.sh <the-branch-name>`  →
   http://localhost:3100. The live server (`:3000`) and `main` are unaffected
   because nothing has merged yet.
3. Happy with it? Merge the PR into `main`. The live server picks it up at the
   next **midnight** rebuild (or `FORCE=1 ./scripts/deploy.sh` for an immediate
   push).

So nothing I do reaches `main` — or anyone's playback — until you merge.

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
