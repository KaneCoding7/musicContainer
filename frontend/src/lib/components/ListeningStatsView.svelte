<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import {
    getListenBrainzStats,
    type ListenBrainzStats,
    type StatsRange,
  } from "$lib/services/listenBrainzService";

  // Lets the not-connected state jump to Settings → ListenBrainz.
  let { onConnect }: { onConnect?: () => void } = $props();

  const RANGES: { id: StatsRange; label: string }[] = [
    { id: "week", label: "Week" },
    { id: "month", label: "Month" },
    { id: "year", label: "Year" },
    { id: "all_time", label: "All time" },
  ];

  let range = $state<StatsRange>("month");
  let data = $state<ListenBrainzStats | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  // (Re)load whenever the range changes.
  $effect(() => {
    const r = range;
    let cancelled = false;
    loading = true;
    error = null;
    getListenBrainzStats(r)
      .then((d) => {
        if (!cancelled) data = d;
      })
      .catch((e) => {
        if (!cancelled) error = e instanceof Error ? e.message : "Couldn't load stats";
      })
      .finally(() => {
        if (!cancelled) loading = false;
      });
    return () => {
      cancelled = true;
    };
  });

  const fmt = (n: number | null | undefined) =>
    n == null ? "—" : n.toLocaleString();
  const plays = (n: number) => `${n.toLocaleString()} play${n === 1 ? "" : "s"}`;

  const connected = $derived(data?.connected === true);
  const hasData = $derived(
    !!(data?.artists?.length || data?.recordings?.length)
  );
</script>

<div class="stats">
  {#if loading && !data}
    <p class="status"><Icon name="progress_activity" size={20} /> Loading your stats…</p>
  {:else if error}
    <p class="status err">{error}</p>
  {:else if !connected}
    <div class="connect">
      <Icon name="insights" size={40} />
      <p class="big">See your listening stats</p>
      <p class="sub">
        Connect a ListenBrainz account to track your top artists and tracks over
        time.
      </p>
      {#if onConnect}
        <button class="connect-btn" onclick={onConnect}>
          <Icon name="link" size={18} /> Connect in Settings
        </button>
      {/if}
      <a
        class="signup"
        href="https://listenbrainz.org/login/"
        target="_blank"
        rel="noopener noreferrer"
      >
        Don't have an account? Create a free one →
      </a>
    </div>
  {:else}
    <div class="data">
    <div class="head">
      <div class="who">
        {#if data?.username}
          <span class="sub">ListenBrainz · {data.username}</span>
        {/if}
        <span class="total">{fmt(data?.listenCount)} <span class="total-l">all-time listens</span></span>
      </div>
      <div class="ranges">
        {#each RANGES as r (r.id)}
          <button
            class="range"
            class:active={range === r.id}
            onclick={() => (range = r.id)}
          >
            {r.label}
          </button>
        {/each}
      </div>
    </div>

    {#if loading}
      <p class="status"><Icon name="progress_activity" size={18} /> Updating…</p>
    {:else if !hasData}
      <p class="status">
        No listening data for this range yet. ListenBrainz updates stats roughly
        daily — check back once you've scrobbled some plays.
      </p>
    {/if}

    <div class="cols">
      <section class="col">
        <h3>Top artists</h3>
        {#if data?.artists?.length}
          <ol class="list">
            {#each data.artists as a, i (a.name + i)}
              <li>
                <span class="rank">{i + 1}</span>
                <span class="name">{a.name}</span>
                <span class="count">{plays(a.count)}</span>
              </li>
            {/each}
          </ol>
        {:else}
          <p class="empty">—</p>
        {/if}
      </section>

      <section class="col">
        <h3>Top tracks</h3>
        {#if data?.recordings?.length}
          <ol class="list">
            {#each data.recordings as t, i (t.name + i)}
              <li>
                <span class="rank">{i + 1}</span>
                <span class="name">
                  {t.name}
                  {#if t.subtitle}<span class="by">{t.subtitle}</span>{/if}
                </span>
                <span class="count">{plays(t.count)}</span>
              </li>
            {/each}
          </ol>
        {:else}
          <p class="empty">—</p>
        {/if}
      </section>
    </div>
    </div>
  {/if}
</div>

<style>
  /* .stats is full width so the not-connected panel can center across the whole
     view; the connected stats/data is left-aligned (like other views), capped. */
  .data {
    max-width: 900px;
  }
  .status {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--muted);
    font-size: 0.9rem;
  }
  .status.err {
    color: var(--danger-text);
  }
  .status :global(.material-symbols-rounded) {
    animation: spin 1.2s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* Not-connected state — centered in the available view, both axes. */
  .connect {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    gap: 0.5rem;
    min-height: 70vh;
    padding: 2.5rem 1rem;
    color: var(--muted);
  }
  .connect :global(.material-symbols-rounded) {
    color: var(--accent-text);
  }
  .big {
    margin: 0.3rem 0 0;
    font-size: 1.15rem;
    font-weight: 600;
    color: var(--text);
  }
  .sub {
    margin: 0;
    color: var(--dim);
    font-size: 0.9rem;
  }
  .connect-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    margin-top: 0.8rem;
    padding: 0.55rem 1rem;
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: 0.5rem;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .connect-btn :global(.material-symbols-rounded) {
    color: #fff;
  }
  .signup {
    margin-top: 0.9rem;
    color: var(--accent-text);
    font-size: 0.85rem;
    text-decoration: none;
  }
  @media (hover: hover) {
    .signup:hover {
      text-decoration: underline;
    }
  }

  /* Header: total + range selector */
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 0.8rem;
    margin-bottom: 1.25rem;
  }
  .who {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .total {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--text);
  }
  .total-l {
    font-size: 0.85rem;
    font-weight: 500;
    color: var(--dim);
  }
  .ranges {
    display: inline-flex;
    gap: 0.25rem;
    padding: 0.2rem;
    background: var(--surface-2);
    border-radius: 0.6rem;
  }
  .range {
    padding: 0.4rem 0.8rem;
    background: transparent;
    border: none;
    border-radius: 0.45rem;
    color: var(--muted);
    font: inherit;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
  }
  .range.active {
    background: var(--surface);
    color: var(--text);
  }
  @media (hover: hover) {
    .range:not(.active):hover {
      color: var(--text);
    }
  }

  /* Two columns of top lists */
  .cols {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.5rem;
  }
  @media (max-width: 640px) {
    .cols {
      grid-template-columns: 1fr;
    }
  }
  .col h3 {
    margin: 0 0 0.6rem;
    font-size: 0.95rem;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .list li {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    padding: 0.5rem 0;
    border-top: 1px solid var(--surface-2);
  }
  .list li:first-child {
    border-top: none;
  }
  .rank {
    flex-shrink: 0;
    width: 1.4rem;
    color: var(--dim);
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    text-align: right;
  }
  .name {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    color: var(--text);
    font-size: 0.9rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .by {
    color: var(--dim);
    font-size: 0.78rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .count {
    flex-shrink: 0;
    color: var(--muted);
    font-size: 0.8rem;
    font-variant-numeric: tabular-nums;
  }
  .empty {
    color: var(--dim);
    font-size: 0.9rem;
  }
</style>
