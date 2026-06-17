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
</script>

<div class="upload-view">
  <button
    type="button"
    class="dropzone"
    class:dragging
    class:busy={vm.uploading}
    disabled={vm.uploading}
    onclick={() => fileInput?.click()}
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
  </button>
  <input
    class="file-hidden"
    bind:this={fileInput}
    type="file"
    accept=".mp3,.wav,audio/mpeg,audio/wav"
    multiple
    onchange={onChange}
    tabindex="-1"
    aria-hidden="true"
  />

  {#if vm.error}
    <p class="msg err">{vm.error}</p>
  {:else if justUploaded > 0 && !vm.uploading}
    <p class="msg ok">
      <Icon name="check_circle" size={18} />
      Added {justUploaded} track{justUploaded === 1 ? "" : "s"} to your library.
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
  /* Hidden input opened programmatically via the dropzone's click (reliable on
     iOS Safari). Not display:none, so the click reaches it. */
  .file-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
  }
  .dropzone {
    width: 100%;
    box-sizing: border-box;
    font: inherit;
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
</style>
