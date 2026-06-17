<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import type { SongViewModel } from "$lib/viewmodels/songViewModel.svelte";

  let { vm }: { vm: SongViewModel } = $props();

  let fileInput = $state<HTMLInputElement | null>(null);
  let dragging = $state(false);
  let justUploaded = $state(0);

  const audioRe = /\.(mp3|wav)$/i;

  async function handleFiles(list: FileList | null | undefined) {
    if (!list) return;
    const files = [...list].filter(
      (f) => audioRe.test(f.name) || f.type.startsWith("audio/")
    );
    if (files.length === 0) return;
    justUploaded = 0;
    const before = vm.songs.length;
    await vm.uploadMany(files);
    justUploaded = vm.songs.length - before;
    if (fileInput) fileInput.value = ""; // allow re-uploading the same files
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
    const n = await vm.importFromLink(url);
    if (n > 0) {
      linkMsg = {
        ok: true,
        text: `Added ${n} track${n === 1 ? "" : "s"} from link`,
      };
      linkUrl = "";
    } else {
      linkMsg = { ok: false, text: vm.error ?? "Import failed" };
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

  {#if vm.error}
    <p class="msg err">{vm.error}</p>
  {:else if justUploaded > 0 && !vm.uploading}
    <p class="msg ok">
      <Icon name="check_circle" size={18} />
      Added {justUploaded} track{justUploaded === 1 ? "" : "s"} to your library.
    </p>
  {/if}

  <div class="divider"><span>or paste a link</span></div>

  <form class="link-row" onsubmit={submitLink}>
    <input
      class="link-input"
      type="url"
      placeholder="Paste a YouTube/SoundCloud/… link"
      bind:value={linkUrl}
      disabled={vm.importing}
    />
    <button type="submit" class="link-btn" disabled={vm.importing || !linkUrl.trim()}>
      {#if vm.importing}
        <Icon name="progress_activity" size={18} /> Importing…
      {:else}
        <Icon name="download" size={18} /> Add
      {/if}
    </button>
  </form>
  {#if vm.importing}
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
  {:else}
    <p class="link-hint">Downloads the audio (as MP3, with cover art) and adds it to your library.</p>
  {/if}
  {#if linkMsg}
    <p class="msg" class:ok={linkMsg.ok} class:err={!linkMsg.ok}>
      {#if linkMsg.ok}<Icon name="check_circle" size={18} />{/if}{linkMsg.text}
    </p>
  {/if}

  <p class="hint">
    {vm.songs.length} track{vm.songs.length === 1 ? "" : "s"} in your library
  </p>
</div>

<style>
  .upload-view {
    max-width: 640px;
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
  .dropzone:hover {
    background: var(--hover);
    border-color: var(--accent-text);
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
  .link-btn:hover:not(:disabled) {
    background: var(--accent-hover);
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
</style>
