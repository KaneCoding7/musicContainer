<script lang="ts">
  import { searchUsers, type UserMatch } from "$lib/services/shareService";

  let {
    onSelect,
    placeholder = "Search people by name or email…",
  }: {
    onSelect: (user: UserMatch) => void;
    placeholder?: string;
  } = $props();

  let query = $state("");
  let results = $state<UserMatch[]>([]);
  let open = $state(false);
  let active = $state(0);
  let loading = $state(false);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let seq = 0; // guards against out-of-order responses

  function onInput() {
    if (timer) clearTimeout(timer);
    const q = query.trim();
    if (!q) {
      results = [];
      open = false;
      return;
    }
    loading = true;
    open = true;
    const mine = ++seq;
    timer = setTimeout(async () => {
      const found = await searchUsers(q);
      if (mine !== seq) return; // a newer query superseded this one
      results = found;
      active = 0;
      loading = false;
    }, 200);
  }

  function choose(u: UserMatch) {
    onSelect(u);
    query = "";
    results = [];
    open = false;
  }

  function onKey(e: KeyboardEvent) {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      active = Math.min(active + 1, results.length - 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      active = Math.max(active - 1, 0);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[active]) choose(results[active]);
    } else if (e.key === "Escape") {
      open = false;
    }
  }
</script>

<div class="ac">
  <input
    type="text"
    {placeholder}
    bind:value={query}
    oninput={onInput}
    onkeydown={onKey}
    onfocus={() => results.length && (open = true)}
    onblur={() => setTimeout(() => (open = false), 150)}
    autocomplete="off"
  />
  {#if open && (loading || results.length > 0)}
    <ul class="results">
      {#if loading && results.length === 0}
        <li class="empty">Searching…</li>
      {:else}
        {#each results as u, i (u.id)}
          <li>
            <button
              type="button"
              class:active={i === active}
              onmousedown={(e) => e.preventDefault()}
              onclick={() => choose(u)}
              onmouseenter={() => (active = i)}
            >
              <span class="nm">{u.name}</span>
              <span class="em">{u.email}</span>
            </button>
          </li>
        {/each}
      {/if}
    </ul>
  {/if}
</div>

<style>
  .ac {
    position: relative;
    flex: 1;
    min-width: 0;
  }
  .ac input {
    width: 100%;
    box-sizing: border-box;
    padding: 0.45rem 0.6rem;
    background: var(--bg);
    border: 1px solid var(--border-strong);
    border-radius: 0.4rem;
    color: var(--text);
    font: inherit;
  }
  .ac input:focus {
    outline: none;
    border-color: var(--accent);
  }
  .results {
    position: absolute;
    z-index: 40;
    top: calc(100% + 0.25rem);
    left: 0;
    right: 0;
    margin: 0;
    padding: 0.25rem;
    list-style: none;
    max-height: 260px;
    overflow-y: auto;
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: 0.5rem;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  }
  .results button {
    display: flex;
    flex-direction: column;
    width: 100%;
    gap: 0.05rem;
    padding: 0.4rem 0.55rem;
    background: transparent;
    border: none;
    border-radius: 0.35rem;
    text-align: left;
    cursor: pointer;
  }
  .results button.active {
    background: var(--hover);
  }
  .nm {
    color: var(--text);
    font-size: 0.9rem;
  }
  .em {
    color: var(--dim);
    font-size: 0.78rem;
  }
  .empty {
    padding: 0.5rem 0.55rem;
    color: var(--dim);
    font-size: 0.85rem;
  }
</style>
