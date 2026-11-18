# Develop, preview, and deploy without interrupting playback

Two goals:

1. **Develop & preview** changes safely, without touching the live library or
   interrupting anyone.
2. **Deploy deliberately**: a merge publishes an immutable build; it reaches DEV
   (beats) only when you deploy it, and PROD (playlist) only when you promote it.

> **Nothing runs from a git checkout.** Both servers run pinned image digests;
> merging to `main` never changes a running server by itself.

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
3. Happy with it? Merge the PR into `main`. CI publishes an immutable
   `build-<run_id>-<sha7>`; deploy it to DEV, then promote it (section 2).

So nothing I do reaches `main` — or anyone's playback — until you merge.

> Prefer hot-reload while coding? `docker-compose.dev.yml` is still there for
> live source reloading. The preview stack is for testing a *built* copy that
> behaves like production.

---

## 2. Deploy: DEV first, then promote to PROD

There is no automatic deploy. On the host:

```bash
sudo music-deploy dev --build build-<run_id>-<sha7>   # from the CI job summary
# use beats.mrkane.dev; after >= 24 h healthy on DEV:
sudo music-deploy prod --promote                      # exactly what DEV runs
sudo music-deploy prod --status                       # what's running + history
```

Every deploy backs up the database first, refuses during imports, verifies
health and data afterwards, and rolls code back automatically if it fails
(unless a migration ran: then it stops and a human decides; it never restores a
database). Full details: [`deploy/README.md`](./deploy/README.md).
