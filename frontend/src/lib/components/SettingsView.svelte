<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import { analyzeLoudness } from "$lib/services/songService";
  import type { AuthViewModel } from "$lib/viewmodels/authViewModel.svelte";
  import type { SongViewModel } from "$lib/viewmodels/songViewModel.svelte";

  let {
    vm,
    songVm,
    theme,
    onToggleTheme,
    onToggleNormalize,
  }: {
    vm: AuthViewModel;
    songVm: SongViewModel;
    theme: "dark" | "light";
    onToggleTheme: () => void;
    onToggleNormalize: () => void;
  } = $props();

  // How many tracks still need loudness analysis for normalization.
  const pendingLoudness = $derived(
    songVm.songs.filter((s) => s.loudness == null).length
  );
  let analyzing = $state(false);
  let analyzeMsg = $state<{ ok: boolean; text: string } | null>(null);

  async function runAnalyze() {
    analyzing = true;
    analyzeMsg = null;
    try {
      let remaining = Infinity;
      let total = 0;
      let guard = 0;
      while (remaining > 0 && guard++ < 1000) {
        const r = await analyzeLoudness();
        total += r.analyzed;
        remaining = r.remaining;
        analyzeMsg = { ok: true, text: `Analyzing… ${remaining} left` };
      }
      await songVm.load(); // pull in the new loudness values
      analyzeMsg = {
        ok: true,
        text: `Done — analyzed ${total} track${total === 1 ? "" : "s"}`,
      };
    } catch (e) {
      analyzeMsg = {
        ok: false,
        text: e instanceof Error ? e.message : "Analysis failed",
      };
    } finally {
      analyzing = false;
    }
  }

  let name = $state("");
  let nameInited = false;
  // Seed the field from the loaded user once (avoids capturing reactive state).
  $effect(() => {
    if (!nameInited && vm.user) {
      name = vm.user.name;
      nameInited = true;
    }
  });
  let nameMsg = $state<{ ok: boolean; text: string } | null>(null);
  let nameBusy = $state(false);

  let currentPassword = $state("");
  let newPassword = $state("");
  let pwMsg = $state<{ ok: boolean; text: string } | null>(null);
  let pwBusy = $state(false);

  async function saveName(e: Event) {
    e.preventDefault();
    nameBusy = true;
    nameMsg = null;
    const err = await vm.changeName(name);
    nameMsg = err ? { ok: false, text: err } : { ok: true, text: "Saved" };
    nameBusy = false;
  }

  async function savePassword(e: Event) {
    e.preventDefault();
    pwBusy = true;
    pwMsg = null;
    const err = await vm.changePassword(currentPassword, newPassword);
    if (err) {
      pwMsg = { ok: false, text: err };
    } else {
      pwMsg = { ok: true, text: "Password changed" };
      currentPassword = "";
      newPassword = "";
    }
    pwBusy = false;
  }
</script>

<div class="settings">
  <div class="card">
    <h3>Appearance</h3>
    <div class="row">
      <span class="row-label">Theme</span>
      <button class="theme-btn" onclick={onToggleTheme}>
        <Icon name={theme === "dark" ? "light_mode" : "dark_mode"} size={18} />
        {theme === "dark" ? "Switch to light" : "Switch to dark"}
      </button>
    </div>
  </div>

  <div class="card">
    <h3>Playback</h3>
    <div class="row">
      <span class="row-label">
        Volume normalization
        <span class="hint">Play all tracks at a consistent loudness</span>
      </span>
      <button
        class="theme-btn"
        class:on={songVm.normalize}
        onclick={onToggleNormalize}
      >
        <Icon name={songVm.normalize ? "graphic_eq" : "volume_off"} size={18} />
        {songVm.normalize ? "On" : "Off"}
      </button>
    </div>
    <div class="row">
      <span class="row-label">
        Loudness analysis
        <span class="hint">
          {#if pendingLoudness === 0}
            All tracks analyzed
          {:else}
            {pendingLoudness} track{pendingLoudness === 1 ? "" : "s"} not analyzed yet
          {/if}
        </span>
      </span>
      <button
        class="theme-btn"
        onclick={runAnalyze}
        disabled={analyzing || pendingLoudness === 0}
      >
        <Icon name="equalizer" size={18} />
        {analyzing ? "Analyzing…" : "Analyze library"}
      </button>
    </div>
    {#if analyzeMsg}
      <p class="msg" class:err={!analyzeMsg.ok}>{analyzeMsg.text}</p>
    {/if}
  </div>

  <form class="card" onsubmit={saveName}>
    <h3>Profile</h3>
    <label>
      Display name
      <input bind:value={name} autocomplete="name" required />
    </label>
    <p class="email">Signed in as {vm.user?.email}</p>
    {#if nameMsg}
      <p class="msg" class:err={!nameMsg.ok}>{nameMsg.text}</p>
    {/if}
    <button type="submit" disabled={nameBusy}>
      {nameBusy ? "Saving…" : "Save name"}
    </button>
  </form>

  <form class="card" onsubmit={savePassword}>
    <h3>Change password</h3>
    <label>
      Current password
      <input
        type="password"
        bind:value={currentPassword}
        autocomplete="current-password"
        required
      />
    </label>
    <label>
      New password
      <input
        type="password"
        bind:value={newPassword}
        autocomplete="new-password"
        minlength="8"
        required
      />
    </label>
    {#if pwMsg}
      <p class="msg" class:err={!pwMsg.ok}>{pwMsg.text}</p>
    {/if}
    <button type="submit" disabled={pwBusy}>
      {pwBusy ? "Saving…" : "Change password"}
    </button>
  </form>
</div>

<style>
  .settings {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    max-width: 440px;
  }
  .card {
    background: var(--surface);
    border: 1px solid var(--surface-2);
    border-radius: 0.6rem;
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  h3 {
    margin: 0;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }
  .row-label {
    color: var(--text);
    font-size: 0.9rem;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .hint {
    color: var(--dim);
    font-size: 0.78rem;
  }
  .theme-btn.on {
    background: var(--active-bg);
    border-color: var(--accent);
    color: var(--accent-text);
  }
  .theme-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .theme-btn {
    align-self: auto;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.5rem 0.9rem;
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--border-strong);
    border-radius: 0.5rem;
    font: inherit;
    font-weight: 500;
    cursor: pointer;
  }
  .theme-btn:hover {
    background: var(--hover);
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    font-size: 0.85rem;
    color: var(--muted);
  }
  input {
    padding: 0.55rem 0.7rem;
    background: var(--bg);
    border: 1px solid var(--border-strong);
    border-radius: 0.5rem;
    color: var(--text);
    font: inherit;
  }
  .email {
    margin: 0;
    color: var(--muted);
    font-size: 0.8rem;
  }
  .msg {
    margin: 0;
    color: var(--accent-text);
    font-size: 0.85rem;
  }
  .msg.err {
    color: var(--danger-text);
  }
  button {
    align-self: flex-start;
    padding: 0.55rem 1.1rem;
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: 0.5rem;
    font-weight: 600;
    cursor: pointer;
  }
  button:hover:not(:disabled) {
    background: var(--accent-hover);
  }
  button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>
