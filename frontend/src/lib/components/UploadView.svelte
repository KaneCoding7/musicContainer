<script lang="ts">
  import EditSongDialog from "$lib/components/EditSongDialog.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { thumbUrl, updateSongMeta } from "$lib/services/songService";
  import type { SongViewModel } from "$lib/viewmodels/songViewModel.svelte";

  let { vm }: { vm: SongViewModel } = $props();

  let fileInput = $state<HTMLInputElement | null>(null);
  let dragging = $state(false);

  // Review state for staged uploads.
  let editingId = $state<number | null>(null);
  const editingItem = $derived(
    vm.staged.find((s) => s.id === editingId) ?? null
  );
  let finalizing = $state(false);
  let reviewMsg = $state<{ ok: boolean; text: string } | null>(null);

  const audioRe = /\.(mp3|wav)$/i;

  // --- Duplicate detection (client-side) ---------------------------------
  // A staged track is flagged as a duplicate if it matches a track already in
  // the library (or an earlier track in this same batch) by source link, or by
  // normalized title + artist.
  const norm = (s: string | null | undefined) =>
    (s ?? "")
      .toLowerCase()
      .replace(/\.(mp3|wav)$/i, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const metaKey = (s: { originalFilename: string; artist: string | null }) =>
    `${norm(s.originalFilename)}|${norm(s.artist)}`;

  // A stable id for a source link so re-imports match even if the URL has extra
  // params (e.g. &list=) or the track was later renamed. YouTube → the 11-char
  // video id; otherwise the URL minus its query/fragment.
  const srcId = (url: string | null | undefined): string | null => {
    if (!url) return null;
    const yt = url.match(
      /(?:[?&]v=|youtu\.be\/|\/shorts\/|\/embed\/)([A-Za-z0-9_-]{11})/
    );
    if (yt) return `yt:${yt[1]}`;
    return url.split(/[?#]/)[0].toLowerCase().replace(/\/+$/, "");
  };

  // Staged ids the user chose to "keep both" on — treated as new, no longer flagged.
  let acceptedDups = $state<Set<number>>(new Set());

  // Transient confirmation shown after a bulk duplicate action.
  let dupMsg = $state<string | null>(null);
  let dupMsgTimer: ReturnType<typeof setTimeout> | null = null;
  function flashDupMsg(text: string) {
    dupMsg = text;
    if (dupMsgTimer) clearTimeout(dupMsgTimer);
    dupMsgTimer = setTimeout(() => (dupMsg = null), 5000);
  }

  // Map of staged-song id -> the existing library song it duplicates. Matches on
  // the source video id (robust to URL params / renames) OR title + artist.
  const duplicates = $derived.by(() => {
    const byKey = new Map<string, (typeof vm.songs)[number]>();
    const bySrc = new Map<string, (typeof vm.songs)[number]>();
    for (const s of vm.songs) {
      byKey.set(metaKey(s), s);
      const sid = srcId(s.sourceUrl);
      if (sid) bySrc.set(sid, s);
    }
    const result = new Map<number, (typeof vm.songs)[number]>();
    for (const s of vm.staged) {
      const sid = srcId(s.sourceUrl);
      const match =
        (sid && bySrc.get(sid)) || byKey.get(metaKey(s)) || null;
      if (match) result.set(s.id, match);
      // Index this staged item too, so a later identical one in the batch flags.
      if (!byKey.has(metaKey(s))) byKey.set(metaKey(s), s);
      if (sid && !bySrc.has(sid)) bySrc.set(sid, s);
    }
    return result;
  });

  // Unresolved duplicates (excluding ones the user accepted as "keep both").
  const activeDups = $derived(
    new Map([...duplicates].filter(([id]) => !acceptedDups.has(id)))
  );
  const dupCount = $derived(activeDups.size);

  // Replace: delete the existing library copy and keep this new import (which
  // then becomes the library version on finalize). Drops the dup flag.
  async function replaceDuplicate(stagedId: number) {
    const match = duplicates.get(stagedId);
    if (!match) return;
    await vm.remove(match.id);
  }

  // Keep both: accept this import as a separate new track (un-flag it).
  function keepBoth(stagedId: number) {
    acceptedDups = new Set(acceptedDups).add(stagedId);
  }

  // Keep all duplicates as new tracks (accept every flagged one at once).
  function keepAllDuplicates() {
    const n = activeDups.size;
    acceptedDups = new Set([...acceptedDups, ...activeDups.keys()]);
    flashDupMsg(`Keeping ${n} as new track${n === 1 ? "" : "s"}.`);
  }

  // Replace all: delete every existing library copy that a staged item dupes,
  // keeping the imports. Dedupe match ids so a shared match isn't deleted twice.
  async function replaceAllDuplicates() {
    const n = activeDups.size;
    const matchIds = [...new Set([...activeDups.values()].map((m) => m.id))];
    for (const id of matchIds) await vm.remove(id);
    flashDupMsg(
      `Replaced ${n} — old cop${n === 1 ? "y" : "ies"} removed. Confirm below to add the new version${n === 1 ? "" : "s"}.`
    );
  }

  async function removeDuplicates() {
    const n = activeDups.size;
    for (const id of [...activeDups.keys()]) await vm.removeStaged(id);
    flashDupMsg(`Removed ${n} duplicate${n === 1 ? "" : "s"}.`);
  }

  async function handleFiles(list: FileList | null | undefined) {
    if (!list) return;
    const files = [...list].filter(
      (f) => audioRe.test(f.name) || f.type.startsWith("audio/")
    );
    if (files.length === 0) return;
    reviewMsg = null;
    await vm.uploadMany(files);
    if (fileInput) fileInput.value = ""; // allow re-uploading the same files
  }

  async function confirmAll() {
    finalizing = true;
    const n = await vm.finalizeStaged();
    finalizing = false;
    reviewMsg =
      n > 0
        ? { ok: true, text: `Added ${n} track${n === 1 ? "" : "s"} to your library` }
        : { ok: false, text: vm.error ?? "Couldn't add to library" };
  }

  async function discardAll() {
    if (!confirm(`Discard all ${vm.staged.length} pending upload(s)?`)) return;
    for (const s of [...vm.staged]) await vm.removeStaged(s.id);
  }

  function subtitle(artist: string | null, album: string | null): string {
    return [artist, album].filter(Boolean).join(" · ") || "No artist / album";
  }

  function onChange(event: Event) {
    handleFiles((event.target as HTMLInputElement).files);
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    dragging = false;
    if (!vm.uploading) handleFiles(event.dataTransfer?.files);
  }

  const pct = $derived(
    vm.uploadTotal ? Math.round((vm.uploadDone / vm.uploadTotal) * 100) : 0
  );

  let linkUrl = $state("");
  let linkMsg = $state<{ ok: boolean; text: string } | null>(null);
  let playlistUrl = $state("");
  let playlistMsg = $state<{ ok: boolean; text: string } | null>(null);
  // Which import is running, so the progress bar shows in the right section.
  let activeImport = $state<"track" | "playlist" | null>(null);

  function stageLabel(stage: string, pct: number | null): string {
    if (stage === "download")
      return pct != null ? `Downloading… ${Math.floor(pct)}%` : "Downloading…";
    if (stage === "convert") return "Converting to MP3…";
    if (stage === "art") return "Adding cover art…";
    if (stage === "ingest") return "Finishing up…";
    return "Working…";
  }

  async function submitLink(e: Event) {
    e.preventDefault();
    const url = linkUrl.trim();
    if (!url || vm.importing) return;
    linkMsg = null;
    activeImport = "track";
    const n = await vm.importFromLink(url);
    activeImport = null;
    if (n > 0) {
      linkMsg = { ok: true, text: "Imported — review it below" };
      linkUrl = "";
    } else {
      linkMsg = { ok: false, text: vm.error ?? "Import failed" };
    }
  }

  async function submitPlaylist(e: Event) {
    e.preventDefault();
    const url = playlistUrl.trim();
    if (!url || vm.importing) return;
    playlistMsg = null;
    activeImport = "playlist";
    const n = await vm.importFromLink(url, true);
    activeImport = null;
    if (n > 0) {
      playlistMsg = {
        ok: true,
        text: `Imported ${n} track${n === 1 ? "" : "s"} — review below`,
      };
      playlistUrl = "";
    } else {
      playlistMsg = { ok: false, text: vm.error ?? "Import failed" };
    }
  }
</script>

<div class="upload-view">
  <input
    id="audio-file-input"
    class="file-hidden"
    bind:this={fileInput}
    type="file"
    accept=".mp3,.wav,audio/mpeg,audio/wav"
    multiple
    onchange={onChange}
  />
  <div class="import-box">
  <label
    for="audio-file-input"
    class="dropzone"
    class:dragging
    class:busy={vm.uploading}
    ondragover={(e) => {
      e.preventDefault();
      if (!vm.uploading) dragging = true;
    }}
    ondragleave={() => (dragging = false)}
    ondrop={onDrop}
  >
    <Icon
      name={vm.uploading ? "progress_activity" : "cloud_upload"}
      size={60}
    />
    {#if vm.uploading}
      <p class="big">Uploading {vm.uploadDone} / {vm.uploadTotal}…</p>
      <div class="bar"><div class="fill" style="width:{pct}%"></div></div>
    {:else}
      <p class="big">Drag &amp; drop your music here</p>
      <p class="sub">or click to browse — MP3 or WAV, as many as you like</p>
    {/if}
  </label>

  {#if vm.error && !vm.staged.length}
    <p class="msg err">{vm.error}</p>
  {/if}

  {#snippet progressBar()}
    <div class="link-progress">
      <div class="pbar">
        <div
          class="pfill"
          class:indeterminate={vm.importPercent == null}
          style={vm.importPercent != null ? `width:${vm.importPercent}%` : ""}
        ></div>
      </div>
      <span class="pstage">{stageLabel(vm.importStage, vm.importPercent)}</span>
    </div>
  {/snippet}

  <div class="divider"><span>or add a track from a link</span></div>

  <form class="link-row" onsubmit={submitLink}>
    <input
      class="link-input"
      type="url"
      placeholder="Paste a YouTube, Spotify, SoundCloud… link"
      bind:value={linkUrl}
      disabled={vm.importing}
    />
    <button type="submit" class="link-btn" disabled={vm.importing || !linkUrl.trim()}>
      {#if activeImport === "track"}
        <Icon name="progress_activity" size={18} /> Importing…
      {:else}
        <Icon name="download" size={18} /> Add
      {/if}
    </button>
  </form>
  {#if activeImport === "track"}
    {@render progressBar()}
  {:else}
    <p class="link-hint">Grabs one track's audio as MP3 (with cover art). Spotify links match the song on YouTube.</p>
  {/if}
  {#if linkMsg}
    <p class="msg" class:ok={linkMsg.ok} class:err={!linkMsg.ok}>
      {#if linkMsg.ok}<Icon name="check_circle" size={18} />{/if}{linkMsg.text}
    </p>
  {/if}

  <div class="divider"><span>or import a whole playlist</span></div>

  <form class="link-row" onsubmit={submitPlaylist}>
    <input
      class="link-input"
      type="url"
      placeholder="Paste a YouTube or Spotify playlist link"
      bind:value={playlistUrl}
      disabled={vm.importing}
    />
    <button type="submit" class="link-btn" disabled={vm.importing || !playlistUrl.trim()}>
      {#if activeImport === "playlist"}
        <Icon name="progress_activity" size={18} /> Importing…
      {:else}
        <Icon name="playlist_add" size={18} /> Import
      {/if}
    </button>
  </form>
  {#if activeImport === "playlist"}
    {@render progressBar()}
  {:else}
    <p class="link-hint">Imports up to 50 tracks from the playlist into your review list. This can take a while.</p>
  {/if}
  {#if playlistMsg}
    <p class="msg" class:ok={playlistMsg.ok} class:err={!playlistMsg.ok}>
      {#if playlistMsg.ok}<Icon name="check_circle" size={18} />{/if}{playlistMsg.text}
    </p>
  {/if}
  </div>

  {#if vm.staged.length > 0}
    <section class="review">
      <div class="review-head">
        <h3>Review {vm.staged.length} upload{vm.staged.length === 1 ? "" : "s"}</h3>
        <p class="review-sub">Edit or remove, then add them to your library.</p>
      </div>
      {#if dupCount > 0}
        <div class="dup-banner">
          <span class="dup-banner-text">
            <Icon name="content_copy" size={18} />
            {dupCount}
            {dupCount === 1 ? "track is" : "tracks are"} already in your library
          </span>
          <span class="dup-banner-actions">
            <button class="dbtn primary" onclick={replaceAllDuplicates}>
              Replace all
            </button>
            <button class="dbtn neutral" onclick={keepAllDuplicates}>
              Keep all as new
            </button>
            <button class="dbtn danger" onclick={removeDuplicates}>
              Delete duplicate{dupCount === 1 ? "" : "s"}
            </button>
          </span>
        </div>
      {/if}
      {#if dupMsg}
        <p class="dup-done"><Icon name="check_circle" size={18} /> {dupMsg}</p>
      {/if}
      <ul class="staged-list">
        {#each vm.staged as s (s.id)}
          <li class="staged" class:is-dup={activeDups.has(s.id)}>
            <span class="sthumb">
              {#if s.hasArt}
                <img src={thumbUrl(s.id, 96)} alt="" />
              {:else}
                <Icon name="music_note" size={22} />
              {/if}
            </span>
            <div class="smeta">
              <span class="stitle">
                {s.originalFilename}
                {#if activeDups.has(s.id)}
                  <span
                    class="dup-tag"
                    title={`Already in your library: ${activeDups.get(s.id)?.originalFilename}`}
                  >Duplicate</span>
                {/if}
              </span>
              <span class="ssub">{subtitle(s.artist, s.album)}</span>
            </div>
            {#if activeDups.has(s.id)}
              <button
                class="dup-act"
                title="Replace the existing library copy with this import"
                onclick={() => replaceDuplicate(s.id)}>Replace</button
              >
              <button
                class="dup-act"
                title="Keep both — add this as a new track"
                onclick={() => keepBoth(s.id)}>Keep both</button
              >
            {/if}
            <button class="sbtn" title="Edit" aria-label="Edit" onclick={() => (editingId = s.id)}>
              <Icon name="edit" size={18} />
            </button>
            <button
              class="sbtn danger"
              title={activeDups.has(s.id) ? "Delete this duplicate" : "Remove"}
              aria-label="Remove"
              onclick={() => vm.removeStaged(s.id)}
            >
              <Icon name="close" size={18} />
            </button>
          </li>
        {/each}
      </ul>
      <div class="review-foot">
        <button class="discard-btn" onclick={discardAll} disabled={finalizing}>
          Discard all
        </button>
        <button class="confirm-btn" onclick={confirmAll} disabled={finalizing}>
          <Icon name="check_circle" size={18} />
          {finalizing ? "Adding…" : `Add ${vm.staged.length} to library`}
        </button>
      </div>
    </section>
  {/if}
  {#if reviewMsg}
    <p class="msg" class:ok={reviewMsg.ok} class:err={!reviewMsg.ok}>
      {#if reviewMsg.ok}<Icon name="check_circle" size={18} />{/if}{reviewMsg.text}
    </p>
  {/if}

  <p class="hint">
    {vm.songs.length} track{vm.songs.length === 1 ? "" : "s"} in your library
  </p>
</div>

{#if editingItem}
  <EditSongDialog
    song={editingItem}
    onSave={async (id, fields) => {
      const updated = await updateSongMeta(id, fields);
      vm.replaceStaged(updated);
    }}
    onArtChanged={(s) => vm.replaceStaged(s)}
    onClose={() => (editingId = null)}
  />
{/if}

<style>
  .upload-view {
    max-width: min(1100px, 100%);
  }
  /* Import controls match the review table width (full width). */
  .import-box {
    max-width: 100%;
  }
  /* "Bulletproof" hidden file input opened by the for-associated dropzone label
     — the pattern iOS Safari reliably honors. */
  .file-hidden {
    width: 0.1px;
    height: 0.1px;
    opacity: 0;
    overflow: hidden;
    position: absolute;
    z-index: -1;
  }
  .dropzone {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    text-align: center;
    padding: 3rem 1.5rem;
    border: 2px dashed var(--border-strong);
    border-radius: 0.9rem;
    background: var(--surface);
    color: var(--muted);
    cursor: pointer;
    transition:
      border-color 0.15s ease,
      background 0.15s ease;
  }
  @media (hover: hover) {
    .dropzone:hover {
      background: var(--hover);
      border-color: var(--accent-text);
    }
  }
  .dropzone.dragging {
    background: var(--active-bg);
    border-color: var(--accent);
    color: var(--text);
  }
  .dropzone.busy {
    cursor: default;
  }
  .dropzone :global(.material-symbols-rounded) {
    color: var(--accent-text);
  }
  .dropzone.busy :global(.material-symbols-rounded) {
    animation: spin 1.2s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .big {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 600;
    color: var(--text);
  }
  .sub {
    margin: 0;
    font-size: 0.9rem;
  }
  .bar {
    width: min(320px, 80%);
    height: 6px;
    background: var(--surface-2);
    border-radius: 3px;
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: var(--accent);
    transition: width 0.2s ease;
  }
  .msg {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin: 1rem 0 0;
    font-size: 0.9rem;
  }
  .msg.ok {
    color: var(--accent-text);
  }
  .msg.err {
    color: var(--danger-text);
  }
  .hint {
    margin: 1rem 0 0;
    color: var(--dim);
    font-size: 0.85rem;
  }

  /* Import from link */
  .divider {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin: 1.5rem 0 1rem;
    color: var(--dim);
    font-size: 0.8rem;
  }
  .divider::before,
  .divider::after {
    content: "";
    flex: 1;
    height: 1px;
    background: var(--surface-2);
  }
  .link-row {
    display: flex;
    gap: 0.5rem;
  }
  .link-input {
    flex: 1;
    min-width: 0;
    padding: 0.6rem 0.8rem;
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: 0.5rem;
    color: var(--text);
    font: inherit;
  }
  .link-input:focus {
    outline: none;
    border-color: var(--accent);
  }
  .link-input::placeholder {
    color: var(--dim);
  }
  .link-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    flex-shrink: 0;
    padding: 0.6rem 1rem;
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: 0.5rem;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  @media (hover: hover) {
    .link-btn:hover:not(:disabled) {
      background: var(--accent-hover);
    }
  }
  .link-btn:disabled {
    opacity: 0.55;
    cursor: default;
  }
  .link-btn :global(.material-symbols-rounded) {
    color: #fff;
  }
  .link-hint {
    margin: 0.5rem 0 0;
    color: var(--dim);
    font-size: 0.8rem;
  }
  .link-progress {
    margin-top: 0.85rem;
  }
  .pbar {
    width: 100%;
    height: 8px;
    background: var(--surface-2);
    border-radius: 4px;
    overflow: hidden;
  }
  .pfill {
    height: 100%;
    background: var(--accent);
    border-radius: 4px;
    transition: width 0.2s ease;
  }
  /* Sliding bar while a stage has no measurable percent (convert/art/ingest). */
  .pfill.indeterminate {
    width: 40%;
    animation: slide 1.1s ease-in-out infinite;
  }
  @keyframes slide {
    0% {
      margin-left: -40%;
    }
    100% {
      margin-left: 100%;
    }
  }
  .pstage {
    display: block;
    margin-top: 0.4rem;
    color: var(--muted);
    font-size: 0.82rem;
    font-variant-numeric: tabular-nums;
  }

  /* Review / staging */
  .review {
    margin-top: 1.75rem;
    border: 1px solid var(--border-strong);
    border-radius: 0.75rem;
    background: var(--surface);
    overflow: hidden;
  }
  .review-head {
    padding: 0.9rem 1rem 0.6rem;
  }
  .review-head h3 {
    margin: 0;
    font-size: 1rem;
  }
  .review-sub {
    margin: 0.15rem 0 0;
    color: var(--dim);
    font-size: 0.82rem;
  }
  .staged-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  /* Duplicate banner + per-row badge */
  .dup-banner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem 0.9rem;
    margin: 0 1rem 0.4rem;
    padding: 0.7rem 0.9rem;
    background: var(--surface-2);
    border: 1px solid var(--border-strong);
    border-radius: 0.6rem;
  }
  .dup-banner-text {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    color: var(--text);
    font-size: 0.9rem;
    font-weight: 600;
  }
  .dup-banner-text :global(.material-symbols-rounded) {
    color: var(--accent-text);
  }
  .dup-banner-actions {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  /* Shared pill button; one accent (primary), one neutral, one danger. */
  .dbtn {
    padding: 0.45rem 0.9rem;
    border-radius: 0.5rem;
    border: 1px solid transparent;
    font: inherit;
    font-size: 0.82rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.12s ease, border-color 0.12s ease;
  }
  .dbtn.primary {
    background: var(--accent);
    color: #fff;
  }
  .dbtn.neutral {
    background: var(--surface);
    color: var(--text);
    border-color: var(--border-strong);
  }
  .dbtn.danger {
    background: #dc2626;
    color: #fff;
    border-color: #dc2626;
  }
  @media (hover: hover) {
    .dbtn.primary:hover {
      background: var(--accent-hover);
    }
    .dbtn.neutral:hover {
      background: var(--hover);
    }
    .dbtn.danger:hover {
      background: #b91c1c;
      border-color: #b91c1c;
    }
  }
  .dup-done {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin: 0 1rem 0.4rem;
    padding: 0.6rem 0.9rem;
    background: color-mix(in srgb, var(--accent) 14%, var(--surface-2));
    border: 1px solid var(--accent);
    border-radius: 0.6rem;
    color: var(--accent-text);
    font-size: 0.85rem;
    font-weight: 600;
  }
  .dup-done :global(.material-symbols-rounded) {
    color: var(--accent-text);
  }
  .dup-tag {
    display: inline-block;
    margin-left: 0.4rem;
    padding: 0.05rem 0.4rem;
    border-radius: 0.3rem;
    background: var(--danger-bg);
    color: var(--danger-text);
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    vertical-align: middle;
  }
  .dup-act {
    flex-shrink: 0;
    padding: 0.3rem 0.6rem;
    border: 1px solid var(--border-strong);
    border-radius: 0.4rem;
    background: var(--surface-2);
    color: var(--text);
    font: inherit;
    font-size: 0.78rem;
    font-weight: 600;
    cursor: pointer;
  }
  @media (hover: hover) {
    .dup-act:hover {
      background: var(--hover);
    }
  }
  .staged {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    border-top: 1px solid var(--surface-2);
  }
  /* Tint duplicate rows so they stand out in the list. */
  .staged.is-dup {
    background: color-mix(in srgb, var(--danger-bg) 35%, transparent);
  }
  .sthumb {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 40px;
    height: 40px;
    border-radius: 0.35rem;
    background: var(--surface-2);
    color: var(--dim);
    overflow: hidden;
  }
  .sthumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .smeta {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .stitle {
    color: var(--text);
    font-size: 0.9rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ssub {
    color: var(--dim);
    font-size: 0.78rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sbtn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    padding: 0.4rem;
    background: transparent;
    border: none;
    color: var(--muted);
    border-radius: 0.35rem;
    cursor: pointer;
  }
  @media (hover: hover) {
    .sbtn:hover {
      background: var(--surface-2);
      color: var(--text);
    }
  }
  @media (hover: hover) {
    .sbtn.danger:hover {
      color: var(--danger-text);
    }
  }
  .review-foot {
    display: flex;
    justify-content: flex-end;
    gap: 0.6rem;
    padding: 0.75rem 1rem;
    border-top: 1px solid var(--surface-2);
  }
  .discard-btn {
    padding: 0.5rem 0.9rem;
    background: transparent;
    color: var(--danger-text);
    border: 1px solid var(--border-strong);
    border-radius: 0.5rem;
    font: inherit;
    font-weight: 600;
    font-size: 0.85rem;
    cursor: pointer;
  }
  @media (hover: hover) {
    .discard-btn:hover:not(:disabled) {
      background: var(--danger-bg);
      border-color: var(--danger-bg);
    }
  }
  .confirm-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.5rem 1rem;
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: 0.5rem;
    font: inherit;
    font-weight: 600;
    font-size: 0.85rem;
    cursor: pointer;
  }
  @media (hover: hover) {
    .confirm-btn:hover:not(:disabled) {
      background: var(--accent-hover);
    }
  }
  .confirm-btn:disabled,
  .discard-btn:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .confirm-btn :global(.material-symbols-rounded) {
    color: #fff;
  }
</style>
