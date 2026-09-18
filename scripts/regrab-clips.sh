#!/usr/bin/env bash
# Drop cached canvas clips so the player re-grabs them at the CURRENT clip
# length. Run this after changing CLIP_SECONDS (or the 15s default), otherwise
# the existing clips stay at whatever length they were generated at -- the
# POST /api/songs/:id/clip route is idempotent and returns early when a clip
# already exists.
#
# Nothing is re-downloaded here. Clearing a song's clip_filename makes the
# expanded player regenerate that clip in the background the next time the song
# is opened, so clips come back lazily, at the new length, only for tracks you
# actually play.
#
#   ./scripts/regrab-clips.sh music-backend --dry-run   # preview (dev)
#   ./scripts/regrab-clips.sh music-backend             # dev
#   ./scripts/regrab-clips.sh music-backend-prod        # prod
#
# Only songs with a source_url are cleared: a clip with no source could not be
# regenerated, so dropping it would lose it permanently. Songs whose clip is
# hidden (clip_disabled) are cleared too, but they only regenerate once the
# clip is re-enabled for that song.
set -euo pipefail

CONTAINER="${1:-}"
DRY=0
[ "${2:-}" = "--dry-run" ] && DRY=1

if [ -z "$CONTAINER" ]; then
  echo "usage: $0 <backend-container> [--dry-run]" >&2
  exit 2
fi
if ! docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep -q true; then
  echo "$CONTAINER is not running" >&2
  exit 1
fi

docker exec -i -e DRY="$DRY" "$CONTAINER" node - <<'NODE'
const { unlinkSync, statSync } = require("node:fs");
const { join } = require("node:path");
const Database = require("better-sqlite3");

const dry = process.env.DRY === "1";
const dataDir = process.env.DATA_DIR || "/data";
const clipsDir = join(dataDir, "clips");
const db = new Database(join(dataDir, "app.db"));

const rows = db
  .prepare(
    "SELECT id, clip_filename, source_url, clip_disabled FROM songs WHERE clip_filename IS NOT NULL"
  )
  .all();

const regen = rows.filter((r) => r.source_url);
const orphan = rows.filter((r) => !r.source_url);
const hidden = regen.filter((r) => r.clip_disabled).length;

let bytes = 0;
for (const r of regen) {
  try {
    bytes += statSync(join(clipsDir, r.clip_filename)).size;
  } catch {
    /* file already gone; the row is cleared regardless */
  }
}
const mb = (bytes / 1048576).toFixed(1);

console.log(`cached clips:        ${rows.length}`);
console.log(`will re-grab:        ${regen.length} (${mb} MB freed)`);
console.log(`hidden (clip off):   ${hidden} — regenerate once re-enabled`);
console.log(`skipped, no source:  ${orphan.length}`);

if (dry) {
  console.log("\n--dry-run: nothing changed");
  process.exit(0);
}
if (regen.length === 0) {
  console.log("\nnothing to do");
  process.exit(0);
}

// Clear the rows first, then remove the files. If a file removal fails the row
// is still cleared, so the clip regenerates and only a stale file is left over.
const clear = db.prepare("UPDATE songs SET clip_filename = NULL WHERE id = ?");
db.transaction(() => {
  for (const r of regen) clear.run(r.id);
})();

let removed = 0;
for (const r of regen) {
  try {
    unlinkSync(join(clipsDir, r.clip_filename));
    removed++;
  } catch {
    /* already gone */
  }
}
console.log(`\ncleared ${regen.length} rows, deleted ${removed} files (${mb} MB)`);
console.log("clips regenerate at the current length as songs are played");
NODE
