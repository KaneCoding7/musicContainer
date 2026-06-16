<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import type { SongViewModel } from "$lib/viewmodels/songViewModel.svelte";

  let { vm }: { vm: SongViewModel } = $props();

  let fileInput = $state<HTMLInputElement | null>(null);

  async function onChange(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const ok = await vm.upload(file);
    if (ok && fileInput) fileInput.value = ""; // reset for re-uploads
  }
</script>

<label class="btn" title="MP3 or WAV">
  <Icon name={vm.uploading ? "progress_activity" : "upload"} size={20} />
  {vm.uploading ? "Uploading…" : "Upload"}
  <input
    bind:this={fileInput}
    type="file"
    accept=".mp3,.wav,audio/mpeg,audio/wav"
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
  }
  .btn:hover {
    background: var(--accent-hover);
  }
</style>
