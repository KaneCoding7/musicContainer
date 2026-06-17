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
  <p class="section">Appearance</p>
  <div class="row">
    <span class="t">Dark mode</span>
    <button
      class="switch"
      role="switch"
      aria-checked={theme === "dark"}
      aria-label="Dark mode"
      onclick={onToggleTheme}><span class="knob"></span></button
    >
  </div>

  <p class="section">Playback</p>
  <div class="row">
    <div class="info">
      <span class="t">Volume normalization</span>
      <span class="sub">Consistent loudness across tracks</span>
    </div>
    <button
      class="switch"
      role="switch"
      aria-checked={songVm.normalize}
      aria-label="Volume normalization"
      onclick={onToggleNormalize}><span class="knob"></span></button
    >
  </div>
  <div class="row">
    <div class="info">
      <span class="t">Loudness analysis</span>
      <span class="sub">
        {#if pendingLoudness === 0}
          All tracks analyzed
        {:else}
          {pendingLoudness} pending
        {/if}
      </span>
    </div>
    <button
      class="ghost"
      onclick={runAnalyze}
      disabled={analyzing || pendingLoudness === 0}
    >
      {analyzing ? "Analyzing…" : "Analyze"}
    </button>
  </div>
  {#if analyzeMsg}<p class="msg" class:err={!analyzeMsg.ok}>{analyzeMsg.text}</p>{/if}

  <p class="section">Profile</p>
  <form onsubmit={saveName}>
    <div class="field-wrap">
      <input
        class="inp"
        bind:value={name}
        placeholder="Display name"
        autocomplete="name"
        required
      />
      <button
        class="in-btn"
        type="submit"
        disabled={nameBusy}
        title="Save"
        aria-label="Save name"
      >
        <Icon name={nameBusy ? "progress_activity" : "check"} size={18} />
      </button>
    </div>
  </form>
  <p class="sub email">Signed in as {vm.user?.email}</p>
  {#if nameMsg}<p class="msg" class:err={!nameMsg.ok}>{nameMsg.text}</p>{/if}

  <p class="section">Password</p>
  <form class="pw-form" onsubmit={savePassword}>
    <input
      class="inp"
      type="password"
      bind:value={currentPassword}
      placeholder="Current password"
      autocomplete="current-password"
      required
    />
    <div class="field-wrap">
      <input
        class="inp"
        type="password"
        bind:value={newPassword}
        placeholder="New password"
        autocomplete="new-password"
        minlength="8"
        required
      />
      <button
        class="in-btn"
        type="submit"
        disabled={pwBusy}
        title="Update password"
        aria-label="Update password"
      >
        <Icon name={pwBusy ? "progress_activity" : "check"} size={18} />
      </button>
    </div>
  </form>
  {#if pwMsg}<p class="msg" class:err={!pwMsg.ok}>{pwMsg.text}</p>{/if}
</div>

<style>
  .settings {
    max-width: 440px;
  }
  .section {
    margin: 1.75rem 0 0.25rem;
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--dim);
  }
  .section:first-child {
    margin-top: 0;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.7rem 0;
    border-bottom: 1px solid var(--surface-2);
  }
  .info {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
  }
  .t {
    color: var(--text);
    font-size: 0.92rem;
  }
  .sub {
    color: var(--dim);
    font-size: 0.78rem;
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

  /* Forms */
  .pw-form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .field-wrap {
    position: relative;
    display: flex;
    align-items: center;
    max-width: 320px;
    margin-top: 0.6rem;
  }
  .pw-form .field-wrap {
    margin-top: 0;
  }
  .inp {
    flex: 1;
    min-width: 0;
    padding: 0.45rem 0.15rem;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--border-strong);
    border-radius: 0;
    color: var(--text);
    font: inherit;
    transition: border-color 0.15s ease;
  }
  .field-wrap .inp {
    padding-right: 2rem;
  }
  .inp:focus {
    outline: none;
    border-bottom-color: var(--accent);
  }
  .inp::placeholder {
    color: var(--dim);
  }
  .in-btn {
    position: absolute;
    right: 0;
    display: inline-flex;
    align-items: center;
    background: transparent;
    border: none;
    color: var(--accent-text);
    cursor: pointer;
    padding: 0.2rem;
  }
  .in-btn:hover:not(:disabled) {
    color: var(--accent);
  }
  .in-btn:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .email {
    margin: 0.5rem 0 0;
  }
  .msg {
    margin: 0.5rem 0 0;
    color: var(--accent-text);
    font-size: 0.85rem;
  }
  .msg.err {
    color: var(--danger-text);
  }

  .ghost {
    flex-shrink: 0;
    padding: 0.4rem 0.85rem;
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--border-strong);
    border-radius: 0.5rem;
    font: inherit;
    font-weight: 600;
    font-size: 0.82rem;
    cursor: pointer;
  }
  .ghost:hover:not(:disabled) {
    background: var(--hover);
  }
  .ghost:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>
