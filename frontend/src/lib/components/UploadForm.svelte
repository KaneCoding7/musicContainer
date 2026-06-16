<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import type { SongViewModel } from "$lib/viewmodels/songViewModel.svelte";

  let { vm }: { vm: SongViewModel } = $props();

  let fileInput = $state<HTMLInputElement | null>(null);
  let dragging = $state(false);

  const audioRe = /\.(mp3|wav)$/i;

  async function handleFiles(list: FileList | null | undefined) {
    if (!list) return;
    const files = [...list].filter(
      (f) => audioRe.test(f.name) || f.type.startsWith("audio/")
    );
    if (files.length === 0) return;
    await vm.uploadMany(files);
    if (fileInput) fileInput.value = ""; // reset for re-uploads
  }

  async function onChange(event: Event) {
    await handleFiles((event.target as HTMLInputElement).files);
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    dragging = false;
    if (!vm.uploading) handleFiles(event.dataTransfer?.files);
  }
</script>

<label
  class="btn"
  class:dragging
  title="MP3 or WAV — drop files or click"
  ondragover={(e) => {
    e.preventDefault();
    dragging = true;
  }}
  ondragleave={() => (dragging = false)}
  ondrop={onDrop}
>
  <Icon name={vm.uploading ? "progress_activity" : "upload"} size={20} />
  {#if vm.uploading}
    Uploading {vm.uploadDone}/{vm.uploadTotal}…
  {:else}
    Upload
  {/if}
  <input
    bind:this={fileInput}
    type="file"
    accept=".mp3,.wav,audio/mpeg,audio/wav"
    multiple
    onchange={onChange}
    disabled={vm.uploading}
    hidden
  />
</label>

<style>
  .btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    width: 100%;
    box-sizing: border-box;
    padding: 0.6rem 1rem;
    background: var(--accent);
    color: white;
    border-radius: 0.5rem;
    cursor: pointer;
    font-weight: 600;
    user-select: none;
    border: 1px dashed transparent;
  }
  .btn:hover {
    background: var(--accent-hover);
  }
  .btn.dragging {
    background: var(--accent-hover);
    border-color: #fff;
  }
</style>
