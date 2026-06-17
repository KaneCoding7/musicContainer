<script lang="ts">
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
  <section class="card">
    <h3>Appearance</h3>
    <div class="setting">
      <div class="label">
        <span class="title">Dark mode</span>
        <span class="sub">Use a dark color scheme</span>
      </div>
      <button
        class="switch"
        role="switch"
        aria-checked={theme === "dark"}
        aria-label="Dark mode"
        onclick={onToggleTheme}><span class="knob"></span></button
      >
    </div>
  </section>

  <section class="card">
    <h3>Playback</h3>
    <div class="setting">
      <div class="label">
        <span class="title">Volume normalization</span>
        <span class="sub">Play all tracks at a consistent loudness</span>
      </div>
      <button
        class="switch"
        role="switch"
        aria-checked={songVm.normalize}
        aria-label="Volume normalization"
        onclick={onToggleNormalize}><span class="knob"></span></button
      >
    </div>
    <div class="setting">
      <div class="label">
        <span class="title">Loudness analysis</span>
        <span class="sub">
          {#if pendingLoudness === 0}
            All tracks analyzed
          {:else}
            {pendingLoudness} track{pendingLoudness === 1 ? "" : "s"} pending
          {/if}
        </span>
      </div>
      <button
        class="btn"
        onclick={runAnalyze}
        disabled={analyzing || pendingLoudness === 0}
      >
        {analyzing ? "Analyzing…" : "Analyze"}
      </button>
    </div>
    {#if analyzeMsg}
      <p class="msg" class:err={!analyzeMsg.ok}>{analyzeMsg.text}</p>
    {/if}
  </section>

  <form class="card" onsubmit={saveName}>
    <h3>Profile</h3>
    <label class="field">
      <span>Display name</span>
      <input bind:value={name} autocomplete="name" required />
    </label>
    <p class="email">Signed in as {vm.user?.email}</p>
    {#if nameMsg}<p class="msg" class:err={!nameMsg.ok}>{nameMsg.text}</p>{/if}
    <div class="card-actions">
      <button class="btn primary" type="submit" disabled={nameBusy}>
        {nameBusy ? "Saving…" : "Save"}
      </button>
    </div>
  </form>

  <form class="card" onsubmit={savePassword}>
    <h3>Change password</h3>
    <label class="field">
      <span>Current password</span>
      <input
        type="password"
        bind:value={currentPassword}
        autocomplete="current-password"
        required
      />
    </label>
    <label class="field">
      <span>New password</span>
      <input
        type="password"
        bind:value={newPassword}
        autocomplete="new-password"
        minlength="8"
        required
      />
    </label>
    {#if pwMsg}<p class="msg" class:err={!pwMsg.ok}>{pwMsg.text}</p>{/if}
    <div class="card-actions">
      <button class="btn primary" type="submit" disabled={pwBusy}>
        {pwBusy ? "Saving…" : "Update password"}
      </button>
    </div>
  </form>
</div>

<style>
  .settings {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    max-width: 480px;
  }
  .card {
    background: var(--surface);
    border: 1px solid var(--surface-2);
    border-radius: 0.75rem;
    padding: 1.1rem 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
  }
  h3 {
    margin: 0;
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
  }
  .setting {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }
  .label {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }
  .label .title {
    font-size: 0.92rem;
    color: var(--text);
  }
  .label .sub {
    font-size: 0.78rem;
    color: var(--dim);
  }

  /* Toggle switch */
  .switch {
    flex-shrink: 0;
    width: 44px;
    height: 26px;
    padding: 0;
    border-radius: 13px;
    background: var(--surface-2);
    border: 1px solid var(--border-strong);
    position: relative;
    cursor: pointer;
    transition:
      background 0.15s ease,
      border-color 0.15s ease;
  }
  .switch[aria-checked="true"] {
    background: var(--accent);
    border-color: var(--accent);
  }
  .knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.15s ease;
  }
  .switch[aria-checked="true"] .knob {
    transform: translateX(18px);
  }

  /* Form fields */
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    font-size: 0.82rem;
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
  input:focus {
    outline: none;
    border-color: var(--accent);
  }
  .email {
    margin: 0;
    color: var(--dim);
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

  .card-actions {
    display: flex;
    justify-content: flex-end;
  }
  .btn {
    padding: 0.5rem 1rem;
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--border-strong);
    border-radius: 0.5rem;
    font: inherit;
    font-weight: 600;
    font-size: 0.85rem;
    cursor: pointer;
  }
  .btn:hover:not(:disabled) {
    background: var(--hover);
  }
  .btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  .btn.primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }
  .btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>
