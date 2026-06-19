<script lang="ts">
  import { onMount } from "svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { apiBase } from "$lib/services/apiBase";
  import type { AuthViewModel } from "$lib/viewmodels/authViewModel.svelte";

  let { vm, onAuthed }: { vm: AuthViewModel; onAuthed: () => void } = $props();

  let mode = $state<"login" | "register">("login");
  let email = $state("");
  let password = $state("");
  let name = $state("");
  let invite = $state("");
  // Whether registration requires an invite code — read from the server so the
  // UI follows the INVITE_ONLY setting without redeploying the frontend.
  let inviteRequired = $state(false);

  onMount(async () => {
    // An invite link (?invite=CODE) prefills the code and opens registration.
    const code = new URLSearchParams(window.location.search).get("invite");
    if (code) {
      invite = code;
      mode = "register";
    }
    // Reflect the server's invite-only setting in the form.
    try {
      const res = await fetch(`${apiBase()}/api/config`);
      if (res.ok) inviteRequired = (await res.json()).inviteOnly === true;
    } catch {
      /* leave default; the server enforces it regardless */
    }
  });

  async function submit(e: Event) {
    e.preventDefault();
    const ok =
      mode === "login"
        ? await vm.login(email.trim(), password)
        : await vm.register(email.trim(), password, name.trim(), invite.trim());
    if (ok) onAuthed();
  }

  function switchMode(next: "login" | "register") {
    mode = next;
    vm.error = null;
  }
</script>

<div class="screen">
  <form class="card" onsubmit={submit}>
    <div class="brand">
      <Icon name="library_music" fill size={30} /> Music Server
    </div>

    <div class="tabs">
      <button
        type="button"
        class:active={mode === "login"}
        onclick={() => switchMode("login")}>Sign in</button
      >
      <button
        type="button"
        class:active={mode === "register"}
        onclick={() => switchMode("register")}>Register</button
      >
    </div>

    {#if mode === "register"}
      <label>
        Name
        <input bind:value={name} autocomplete="name" required />
      </label>
      <label>
        Invite code {#if !inviteRequired}<span class="opt">(optional)</span>{/if}
        <input
          bind:value={invite}
          placeholder={inviteRequired ? "Enter your invite code" : "Optional"}
          required={inviteRequired}
        />
      </label>
    {/if}
    <label>
      Email
      <input type="email" bind:value={email} autocomplete="email" required />
    </label>
    <label>
      Password
      <input
        type="password"
        bind:value={password}
        autocomplete={mode === "login" ? "current-password" : "new-password"}
        minlength="8"
        required
      />
    </label>

    {#if vm.error}
      <p class="error">{vm.error}</p>
    {/if}

    <button class="submit" type="submit" disabled={vm.busy}>
      {vm.busy
        ? "Please wait…"
        : mode === "login"
          ? "Sign in"
          : "Create account"}
    </button>
  </form>
</div>

<style>
  .screen {
    height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    box-sizing: border-box;
  }
  .card {
    width: min(380px, 100%);
    background: var(--surface);
    border: 1px solid var(--surface-2);
    border-radius: 0.75rem;
    padding: 1.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }
  .brand {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--accent-text);
    margin-bottom: 0.5rem;
  }
  .tabs {
    display: flex;
    gap: 0.25rem;
    background: var(--bg);
    border-radius: 0.5rem;
    padding: 0.25rem;
    margin-bottom: 0.5rem;
  }
  .tabs button {
    flex: 1;
    padding: 0.5rem;
    background: transparent;
    border: none;
    border-radius: 0.4rem;
    color: var(--muted);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .tabs button.active {
    background: var(--surface-2);
    color: var(--text);
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    font-size: 0.85rem;
    color: var(--muted);
  }
  .opt {
    color: var(--dim);
    font-weight: 400;
  }
  input {
    padding: 0.55rem 0.7rem;
    background: var(--bg);
    border: 1px solid var(--border-strong);
    border-radius: 0.5rem;
    color: var(--text);
    font: inherit;
  }
  .error {
    margin: 0;
    background: var(--danger-bg);
    color: var(--danger-text);
    padding: 0.5rem 0.75rem;
    border-radius: 0.5rem;
    font-size: 0.85rem;
  }
  .submit {
    margin-top: 0.25rem;
    padding: 0.65rem;
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: 0.5rem;
    font-weight: 600;
    cursor: pointer;
  }
  @media (hover: hover) {
    .submit:hover:not(:disabled) {
      background: var(--accent-hover);
    }
  }
  .submit:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>
