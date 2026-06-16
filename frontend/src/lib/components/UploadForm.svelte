<script lang="ts">
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

<div class="upload">
  <label class="btn">
    {vm.uploading ? "Uploading…" : "Upload song"}
    <input
      bind:this={fileInput}
      type="file"
      accept=".mp3,.wav,audio/mpeg,audio/wav"
      onchange={onChange}
      disabled={vm.uploading}
      hidden
    />
  </label>
  <span class="hint">MP3 or WAV</span>
</div>

<style>
  .upload {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .btn {
    display: inline-block;
    padding: 0.55rem 1.1rem;
    background: #6d28d9;
    color: white;
    border-radius: 0.5rem;
    cursor: pointer;
    font-weight: 600;
    user-select: none;
  }
  .btn:hover {
    background: #5b21b6;
  }
  .hint {
    color: #9ca3af;
    font-size: 0.85rem;
  }
</style>
