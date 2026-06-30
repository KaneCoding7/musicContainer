<script lang="ts">
  import { onMount } from "svelte";
  import Icon from "$lib/components/Icon.svelte";
  import {
    getListenBrainzStats,
    getRecommendations,
    getFreshReleases,
    type ListenBrainzStats,
    type Recommendation,
    type FreshRelease,
    type StatsRange,
  } from "$lib/services/listenBrainzService";
  import { getLastfmStats, getLastfmStatus } from "$lib/services/lastfmService";
  import { searchYouTube, importLink } from "$lib/services/songService";
  import type { SongViewModel } from "$lib/viewmodels/songViewModel.svelte";

  // `vm` (shared with the Upload page) so an added track lands in the review
  // list instantly. onConnect lets the not-connected state jump to Settings.
  let { vm, onConnect }: { vm: SongViewModel; onConnect?: () => void } = $props();

  const RANGES: { id: StatsRange; label: string }[] = [
    { id: "week", label: "Week" },
    { id: "month", label: "Month" },
    { id: "year", label: "Year" },
    { id: "all_time", label: "All time" },
  ];

  // Stats can be powered by either service; Last.fm only when the server has it.
  type Source = "listenbrainz" | "lastfm";
  let source = $state<Source>("listenbrainz");
  let lastfmAvailable = $state(false);
  const sourceLabel = $derived(source === "lastfm" ? "Last.fm" : "ListenBrainz");

  let range = $state<StatsRange>("month");
  let data = $state<ListenBrainzStats | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  onMount(async () => {
    try {
      const lf = await getLastfmStatus();
      lastfmAvailable = lf.configured;
    } catch {
      /* Last.fm unavailable */
    }
  });

  // (Re)load whenever the range or source changes.
  $effect(() => {
    const r = range;
    const s = source;
    let cancelled = false;
    loading = true;
    error = null;
    const load = s === "lastfm" ? getLastfmStats(r) : getListenBrainzStats(r);
    load
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
    !!(data?.artists?.length || data?.recordings?.length || data?.releases?.length)
  );

  // Activity bar chart: scale each bucket against the busiest one.
  const activityMax = $derived(
    Math.max(1, ...(data?.activity ?? []).map((b) => b.count))
  );

  // Recommendations + fresh releases are range-independent, so load them once.
  let recs = $state<Recommendation[]>([]);
  let fresh = $state<FreshRelease[]>([]);
  onMount(() => {
    getRecommendations().then((r) => (recs = r)).catch(() => {});
    getFreshReleases().then((f) => (fresh = f)).catch(() => {});
  });

  // One-click "discover → import": find the track on YouTube and stage it for
  // review (lands in the Upload review list, like any import). Tracked per-row in
  // a Set so several can import at once — adding one never blocks the others.
  let adding = $state<Set<string>>(new Set());
  const isAdding = (key: string) => adding.has(key);
  let toast = $state<{ ok: boolean; text: string } | null>(null);
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  function flashToast(ok: boolean, text: string) {
    toast = { ok, text };
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = null), 6000);
  }

  // onAdded runs after a successful import so the caller can drop the row from
  // its discover list.
  async function importByName(
    query: string,
    label: string,
    key: string,
    onAdded?: () => void
  ) {
    if (adding.has(key)) return;
    adding = new Set(adding).add(key);
    try {
      const results = await searchYouTube(query);
      if (!results.length) throw new Error("No match found on YouTube");
      const songs = await importLink(results[0].url);
      if (!songs.length) throw new Error("Import failed");
      // Push into the shared review list so Upload updates instantly.
      vm.addStaged(songs);
      onAdded?.();
      flashToast(true, `Added “${label}” to your review list — open Upload to confirm.`);
    } catch (e) {
      flashToast(false, e instanceof Error ? e.message : "Couldn't import");
    } finally {
      const next = new Set(adding);
      next.delete(key);
      adding = next;
    }
  }

  const fmtDate = (d: string | null) => {
    if (!d) return "";
    const t = Date.parse(d);
    if (Number.isNaN(t)) return d;
    return new Date(t).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };
</script>

<div class="stats">
  {#if lastfmAvailable}
    <div class="source">
      <button class="src" class:active={source === "listenbrainz"} onclick={() => (source = "listenbrainz")}>
        ListenBrainz
      </button>
      <button class="src" class:active={source === "lastfm"} onclick={() => (source = "lastfm")}>
        Last.fm
      </button>
    </div>
  {/if}

  {#if loading && !data}
    <p class="status"><Icon name="progress_activity" size={20} /> Loading your stats…</p>
  {:else if error}
    <p class="status err">{error}</p>
  {:else if !connected}
    <div class="connect">
      <Icon name="insights" size={40} />
      <p class="big">See your listening stats</p>
      <p class="sub">
        Connect a {sourceLabel} account to track your top artists, tracks and
        albums over time.
      </p>
      {#if onConnect}
        <button class="connect-btn" onclick={onConnect}>
          <Icon name="link" size={18} /> Connect in Settings
        </button>
      {/if}
      <a
        class="signup"
        href={source === "lastfm" ? "https://www.last.fm/join" : "https://listenbrainz.org/login/"}
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
          <span class="sub">{sourceLabel} · {data.username}</span>
        {/if}
        <span class="total">{fmt(data?.listenCount)} <span class="total-l">all-time {source === "lastfm" ? "scrobbles" : "listens"}</span></span>
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
        No listening data for this range yet. {sourceLabel} updates stats
        periodically — check back once you've scrobbled some plays.
      </p>
    {/if}

    {#if data?.activity?.length}
      <section class="activity">
        <h3>Listening activity</h3>
        <div class="bars">
          {#each data.activity as b (b.label)}
            <div class="bar-col" title={`${b.label}: ${plays(b.count)}`}>
              <div class="bar-track">
                <div
                  class="bar-fill"
                  style="height:{Math.round((b.count / activityMax) * 100)}%"
                ></div>
              </div>
              <span class="bar-label">{b.label}</span>
            </div>
          {/each}
        </div>
      </section>
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

      <section class="col">
        <h3>Top albums</h3>
        {#if data?.releases?.length}
          <ol class="list">
            {#each data.releases as al, i (al.name + i)}
              <li>
                <span class="rank">{i + 1}</span>
                <span class="name">
                  {al.name}
                  {#if al.subtitle}<span class="by">{al.subtitle}</span>{/if}
                </span>
                <span class="count">{plays(al.count)}</span>
              </li>
            {/each}
          </ol>
        {:else}
          <p class="empty">—</p>
        {/if}
      </section>
    </div>

    {#if source === "listenbrainz" && recs.length}
      <section class="discover">
        <h3>Recommended for you</h3>
        <p class="discover-sub">Picked by ListenBrainz from your listening. Add any to your library.</p>
        <ul class="disc-list">
          {#each recs as r (r.recordingMbid)}
            <li>
              <span class="disc-meta">
                <span class="disc-name">{r.track}</span>
                <span class="disc-by">{[r.artist, r.release].filter(Boolean).join(" · ")}</span>
              </span>
              <button
                class="disc-add"
                disabled={isAdding(`rec:${r.recordingMbid}`)}
                onclick={() =>
                  importByName(
                    `${r.artist ?? ""} ${r.track}`.trim(),
                    r.track,
                    `rec:${r.recordingMbid}`,
                    () => (recs = recs.filter((x) => x.recordingMbid !== r.recordingMbid))
                  )}
              >
                {#if isAdding(`rec:${r.recordingMbid}`)}
                  <Icon name="progress_activity" size={16} /> Adding…
                {:else}
                  <Icon name="add" size={16} /> Add
                {/if}
              </button>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if source === "listenbrainz" && fresh.length}
      <section class="discover">
        <h3>Fresh releases</h3>
        <p class="discover-sub">New &amp; upcoming from artists you listen to.</p>
        <ul class="disc-list">
          {#each fresh as f, i (f.releaseMbid ?? f.release + i)}
            <li>
              <span class="disc-meta">
                <span class="disc-name">
                  {f.release}
                  {#if f.type}<span class="disc-tag">{f.type}</span>{/if}
                </span>
                <span class="disc-by">{[f.artist, fmtDate(f.date)].filter(Boolean).join(" · ")}</span>
              </span>
              <button
                class="disc-add"
                disabled={isAdding(`fresh:${f.releaseMbid ?? f.release}`)}
                onclick={() =>
                  importByName(
                    `${f.artist ?? ""} ${f.release}`.trim(),
                    f.release,
                    `fresh:${f.releaseMbid ?? f.release}`,
                    () => (fresh = fresh.filter((x) => x !== f))
                  )}
              >
                {#if isAdding(`fresh:${f.releaseMbid ?? f.release}`)}
                  <Icon name="progress_activity" size={16} /> Adding…
                {:else}
                  <Icon name="add" size={16} /> Add
                {/if}
              </button>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
    </div>
  {/if}

  {#if toast}
    <p class="toast" class:err={!toast.ok}>
      {#if toast.ok}<Icon name="check_circle" size={18} />{/if}{toast.text}
    </p>
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

  /* Source toggle (ListenBrainz ⇄ Last.fm) */
  .source {
    display: inline-flex;
    gap: 0.25rem;
    margin-bottom: 1.25rem;
    padding: 0.2rem;
    background: var(--surface-2);
    border-radius: 0.6rem;
  }
  .src {
    padding: 0.4rem 0.9rem;
    background: transparent;
    border: none;
    border-radius: 0.45rem;
    color: var(--muted);
    font: inherit;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
  }
  .src.active {
    background: var(--surface);
    color: var(--text);
  }
  @media (hover: hover) {
    .src:not(.active):hover {
      color: var(--text);
    }
  }

  /* Two columns of top lists */
  .cols {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1.5rem;
  }
  @media (max-width: 820px) {
    .cols {
      grid-template-columns: 1fr 1fr;
    }
  }
  @media (max-width: 560px) {
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

  /* Listening activity bar chart */
  .activity {
    margin-bottom: 1.75rem;
  }
  .activity h3 {
    margin: 0 0 0.6rem;
    font-size: 0.95rem;
  }
  .bars {
    display: flex;
    align-items: flex-end;
    gap: 3px;
    height: 120px;
    padding-top: 0.5rem;
  }
  .bar-col {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.35rem;
    height: 100%;
  }
  .bar-track {
    flex: 1;
    width: 100%;
    display: flex;
    align-items: flex-end;
    justify-content: center;
  }
  .bar-fill {
    width: 100%;
    max-width: 28px;
    min-height: 2px;
    background: var(--accent);
    border-radius: 3px 3px 0 0;
    transition: height 0.25s ease;
  }
  .bar-label {
    font-size: 0.62rem;
    color: var(--dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }

  /* Discover: recommendations + fresh releases */
  .discover {
    margin-top: 1.75rem;
  }
  .discover h3 {
    margin: 0;
    font-size: 0.95rem;
  }
  .discover-sub {
    margin: 0.15rem 0 0.7rem;
    color: var(--dim);
    font-size: 0.82rem;
  }
  .disc-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .disc-list li {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    padding: 0.5rem 0;
    border-top: 1px solid var(--surface-2);
  }
  .disc-list li:first-child {
    border-top: none;
  }
  .disc-meta {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .disc-name {
    color: var(--text);
    font-size: 0.9rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .disc-tag {
    margin-left: 0.4rem;
    padding: 0.02rem 0.35rem;
    border-radius: 0.3rem;
    background: var(--surface-2);
    color: var(--dim);
    font-size: 0.66rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    vertical-align: middle;
  }
  .disc-by {
    color: var(--dim);
    font-size: 0.78rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .disc-add {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    flex-shrink: 0;
    padding: 0.4rem 0.7rem;
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--border-strong);
    border-radius: 0.45rem;
    font: inherit;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
  }
  @media (hover: hover) {
    .disc-add:hover:not(:disabled) {
      background: var(--hover);
      border-color: var(--accent-text);
    }
  }
  .disc-add:disabled {
    opacity: 0.55;
    cursor: default;
  }
  .disc-add :global(.material-symbols-rounded) {
    color: var(--accent-text);
  }
  .disc-add:disabled :global(.material-symbols-rounded) {
    animation: spin 1s linear infinite;
  }

  /* Discover-import toast */
  .toast {
    position: sticky;
    bottom: 0.5rem;
    display: flex;
    align-items: center;
    gap: 0.45rem;
    margin: 1.5rem 0 0;
    padding: 0.7rem 0.9rem;
    background: color-mix(in srgb, var(--accent) 14%, var(--surface));
    border: 1px solid var(--accent);
    border-radius: 0.6rem;
    color: var(--accent-text);
    font-size: 0.88rem;
    font-weight: 600;
  }
  .toast.err {
    background: var(--danger-bg);
    border-color: var(--danger-text);
    color: var(--danger-text);
  }
  .toast :global(.material-symbols-rounded) {
    color: var(--accent-text);
  }
</style>
