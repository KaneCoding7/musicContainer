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
    type StatEntry,
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

  // Activity bar chart. The busiest bucket sets the scale, but we round it up to
  // a "nice" round number so the gridlines/axis ticks read cleanly (e.g. a peak
  // of 37 scales to 40, ticked 0/10/20/30/40) instead of against a raw max.
  const activityPeak = $derived(
    Math.max(0, ...(data?.activity ?? []).map((b) => b.count))
  );
  function niceCeil(n: number): number {
    if (n <= 5) return 5;
    const pow = Math.pow(10, Math.floor(Math.log10(n)));
    const frac = n / pow;
    const step = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
    return step * pow;
  }
  const activityScale = $derived(niceCeil(activityPeak));
  // Axis ticks top → bottom (four gridlines + baseline), rendered as evenly
  // spaced horizontal rules with a value label on the left.
  const activityTicks = $derived(
    [1, 0.75, 0.5, 0.25, 0].map((f) => Math.round(activityScale * f))
  );
  const activityTotal = $derived(
    (data?.activity ?? []).reduce((n, b) => n + b.count, 0)
  );
  // Height of a bucket's fill as a % of the plot, with a small floor so a
  // non-zero-but-tiny bucket is still visible (zero stays flat/empty).
  const barHeight = (count: number) =>
    count <= 0 ? 0 : Math.max(2.5, (count / activityScale) * 100);
  // Bar the user has tapped/clicked to pin its value open (touch-friendly: no
  // hover needed). Toggled per bucket label; null when none is pinned.
  let selectedBar = $state<string | null>(null);
  // Dense ranges (a month = ~30–60 daily buckets) can't show a label per bar
  // without them colliding, so show ~8 evenly spaced. Also tighten the bar gap
  // when there are many buckets.
  const activityCount = $derived(data?.activity?.length ?? 0);
  const activityLabelStep = $derived(Math.max(1, Math.ceil(activityCount / 8)));
  const activityGap = $derived(activityCount > 30 ? "2px" : "4px");
  // Index of the last labelled bucket, so it can be right-aligned instead of
  // overflowing off the right edge of the chart.
  const activityLastLabelIdx = $derived(
    Math.floor(Math.max(0, activityCount - 1) / activityLabelStep) *
      activityLabelStep
  );
  // ListenBrainz hands back long, range-specific labels ("Monday 29 June 2026",
  // "01 May 2026", "January 2024", "2002"). Compress each to something that fits
  // under a bar: "29 Jun" / "1 May" (daily), "Jan ’24" (monthly), "2002" (yearly).
  function shortLabel(raw: string, r: StatsRange): string {
    if (r === "all_time") return raw.trim(); // already a bare year
    if (r === "year") {
      const m = raw.match(/^(\w+)\s+(\d{4})$/); // "January 2024"
      return m ? `${m[1].slice(0, 3)} ’${m[2].slice(2)}` : raw;
    }
    // week / month are daily; week labels also carry a weekday prefix.
    const m = raw.match(/(\d{1,2})\s+(\w+)\s+\d{4}$/);
    return m ? `${Number(m[1])} ${m[2].slice(0, 3)}` : raw;
  }

  // --- Recap / summary derived from the loaded stats -----------------------
  // listenCount is the ALL-TIME total; plays within the selected range are the
  // sum of the activity buckets.
  const clockTotal = $derived(
    (data?.hourly ?? []).reduce((n, h) => n + h.count, 0)
  );
  // Range total = the day-by-day activity sum, falling back to the clock's
  // hourly sum when ListenBrainz hasn't computed the listening-activity series
  // for this range yet (it builds each stat on its own schedule, so top artists
  // and the clock can be ready while the day-by-day series is still empty).
  const rangeListens = $derived(
    range === "all_time" && data?.listenCount != null
      ? data.listenCount // the canonical lifetime total (matches the header)
      : data?.periodListens != null
        ? data.periodListens // an explicit per-range total (Last.fm)
        : activityTotal > 0
          ? activityTotal
          : clockTotal
  );
  const rangeNoun = $derived(
    range === "week"
      ? "this week"
      : range === "month"
        ? "this month"
        : range === "year"
          ? "this year"
          : "all-time"
  );
  const scrobbleWord = $derived(source === "lastfm" ? "scrobbles" : "listens");
  // avg/day for the day-based ranges (week = 7 days; month uses the actual
  // bucket count when present, else ~30). Null for year/all-time.
  const daysInRange = $derived(
    range === "week"
      ? 7
      : range === "month"
        ? data?.activity?.length || 30
        : range === "year"
          ? 365
          : 0
  );
  const avgPerDay = $derived(
    daysInRange > 0 && rangeListens > 0
      ? Math.round(rangeListens / daysInRange)
      : null
  );
  // All-time has no meaningful "per day" (unbounded span), so the 4th tile
  // there shows average plays per artist instead — keeps the row at four tiles.
  const perArtist = $derived(
    data?.uniqueArtists ? Math.round(rangeListens / data.uniqueArtists) : null
  );
  const topArtist = $derived(data?.artists?.[0] ?? null);
  const topArtistPct = $derived(
    topArtist && rangeListens > 0
      ? Math.round((topArtist.count / rangeListens) * 100)
      : null
  );
  const topTracks3 = $derived((data?.recordings ?? []).slice(0, 3));
  const topTrack3Peak = $derived(
    Math.max(1, ...topTracks3.map((t) => t.count))
  );

  // Listening clock: 24 hour-of-day buckets. Same nice-ceil scaling as the
  // activity chart so the bars read against a clean max.
  const clockPeak = $derived(
    Math.max(0, ...(data?.hourly ?? []).map((h) => h.count))
  );
  const clockScale = $derived(niceCeil(clockPeak));
  const clockPeakHour = $derived.by(() => {
    const hs = data?.hourly ?? [];
    if (!hs.length) return null;
    return hs.reduce((best, h) => (h.count > best.count ? h : best), hs[0]);
  });
  function hourLabel(h: number): string {
    const suffix = h < 12 ? "a" : "p";
    const hr = h % 12 === 0 ? 12 : h % 12;
    return `${hr}${suffix}`;
  }
  // "Play the month/week/…": queue the library tracks that match this range's
  // top tracks (ListenBrainz names → library songs by title). No-op when none
  // are in the library.
  const playableTopTracks = $derived.by(() => {
    const names = new Set(
      (data?.recordings ?? []).map((r) => r.name.trim().toLowerCase())
    );
    return vm.songs.filter((s) =>
      names.has((s.originalFilename ?? "").trim().toLowerCase())
    );
  });
  function playTopTracks() {
    if (playableTopTracks.length) vm.playList(playableTopTracks);
  }

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

<!-- Ranked top list with a relative-magnitude bar behind each row (scaled to
     the list's #1), so the leaderboard reads as a mini bar chart. -->
{#snippet topList(items: StatEntry[])}
  {@const max = Math.max(1, ...items.map((x) => x.count))}
  <ol class="list">
    {#each items as it, i (it.name + i)}
      <li style="--pct:{Math.round((it.count / max) * 100)}%">
        <span class="rank" class:top={i < 3}>{i + 1}</span>
        <span class="name">
          {it.name}
          {#if it.subtitle}<span class="by">{it.subtitle}</span>{/if}
        </span>
        <span class="count">{plays(it.count)}</span>
      </li>
    {/each}
  </ol>
{/snippet}

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
        <span class="sub">
          {#if data?.username}{data.username} · {/if}{fmt(data?.listenCount)}
          all-time {scrobbleWord}
        </span>
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

    {#if hasData}
      <section class="recap">
        <div class="recap-main">
          <p class="recap-kicker">{rangeNoun} recap</p>
          <p class="recap-big">
            You logged {rangeListens.toLocaleString()}
            {scrobbleWord} {rangeNoun}.
          </p>
          {#if topArtist}
            <p class="recap-sub">
              {topArtist.name} led the way{#if data?.uniqueArtists}, across {fmt(
                  data.uniqueArtists
                )} artists{/if}.
            </p>
          {/if}
          {#if playableTopTracks.length}
            <button class="recap-play" onclick={playTopTracks}>
              <Icon name="play_arrow" fill size={18} /> Play top tracks
            </button>
          {/if}
        </div>
        {#if topArtist}
          <div class="recap-artist">
            <p class="recap-artist-l">Top artist {rangeNoun}</p>
            <p class="recap-artist-name">{topArtist.name}</p>
            <p class="recap-artist-sub">
              {plays(topArtist.count)}{#if topArtistPct} · {topArtistPct}% of all{/if}
            </p>
            {#if topTracks3.length}
              <ul class="mini-bars">
                {#each topTracks3 as t (t.name)}
                  <li>
                    <span class="mini-name" title={t.name}>{t.name}</span>
                    <span class="mini-track">
                      <span
                        class="mini-fill"
                        style="width:{Math.max(8, (t.count / topTrack3Peak) * 100)}%"
                      ></span>
                    </span>
                    <span class="mini-val">{fmt(t.count)}</span>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        {/if}
      </section>

      <div class="tiles">
        <div class="tile">
          <span class="tile-l">plays {rangeNoun}</span>
          <span class="tile-v">{fmt(rangeListens)}</span>
        </div>
        {#if avgPerDay !== null}
          <div class="tile">
            <span class="tile-l">avg per day</span>
            <span class="tile-v">{fmt(avgPerDay)}</span>
          </div>
        {:else if perArtist !== null}
          <div class="tile">
            <span class="tile-l">plays / artist</span>
            <span class="tile-v">{fmt(perArtist)}</span>
          </div>
        {/if}
        {#if data?.uniqueArtists != null}
          <div class="tile">
            <span class="tile-l">unique artists</span>
            <span class="tile-v">{fmt(data.uniqueArtists)}</span>
          </div>
        {/if}
        {#if data?.uniqueTracks != null}
          <div class="tile">
            <span class="tile-l">unique tracks</span>
            <span class="tile-v">{fmt(data.uniqueTracks)}</span>
          </div>
        {/if}
      </div>
    {/if}

    {#if loading}
      <p class="status"><Icon name="progress_activity" size={18} /> Updating…</p>
    {:else if !hasData}
      <div class="empty-range">
        <Icon name="bar_chart" size={34} />
        <p class="empty-range-t">No {sourceLabel} stats for {rangeNoun} yet</p>
        <p class="empty-range-s">
          {sourceLabel} computes each range on its own schedule — this one
          hasn't been built yet. Your all-time and shorter ranges are ready;
          check back for {rangeNoun}.
        </p>
      </div>
    {/if}

    {#if hasData}
    <div class="panels">
    {#if data?.activity?.length}
      <section class="activity panel">
        <div class="activity-head">
          <h3>Listening activity</h3>
          <span class="activity-sum"
            >{plays(activityTotal)} · peak {plays(activityPeak)}</span
          >
        </div>
        <!-- Single-series magnitude-over-time: one hue (theme accent), gridlines
             for scale, values on hover/focus (+ always on the peak) so they're
             reachable by touch and keyboard, not hover-only. -->
        <div class="chart" style="--bar-gap:{activityGap}">
          <div class="plot">
            <div class="grid" aria-hidden="true">
              {#each activityTicks as t (t)}
                <div class="grid-line"><span class="grid-val">{fmt(t)}</span></div>
              {/each}
            </div>
            <div class="bars">
              {#each data.activity as b (b.label)}
                <button
                  type="button"
                  class="bar-col"
                  class:selected={selectedBar === b.label}
                  aria-label={`${b.label}: ${plays(b.count)}`}
                  onclick={() =>
                    (selectedBar = selectedBar === b.label ? null : b.label)}
                >
                  <span class="bar-value">{fmt(b.count)}</span>
                  <div
                    class="bar-fill"
                    class:peak={b.count === activityPeak && b.count > 0}
                    class:empty={b.count === 0}
                    style="height:{barHeight(b.count)}%"
                  ></div>
                </button>
              {/each}
            </div>
          </div>
          <div class="xaxis" aria-hidden="true">
            {#each data.activity as b, i (b.label)}
              {@const show = i % activityLabelStep === 0}
              <span
                class="xlabel"
                class:edge-l={i === 0}
                class:edge-r={show && i === activityLastLabelIdx && i !== 0}
                >{show ? shortLabel(b.label, range) : ""}</span
              >
            {/each}
          </div>
        </div>
      </section>
    {/if}
    {#if data?.hourly?.length}
      <section class="clock panel">
        <div class="activity-head">
          <h3>Listening clock</h3>
          {#if clockPeakHour}
            <span class="activity-sum"
              >peak {hourLabel(clockPeakHour.hour)}–{hourLabel(
                (clockPeakHour.hour + 1) % 24
              )}</span
            >
          {/if}
        </div>
        <div class="clock-bars">
          {#each data.hourly as h (h.hour)}
            <div class="clock-col" title={`${hourLabel(h.hour)}: ${plays(h.count)}`}>
              <div
                class="clock-fill"
                class:peak={h.count === clockPeak && h.count > 0}
                style="height:{h.count <= 0
                  ? 0
                  : Math.max(3, (h.count / clockScale) * 100)}%"
              ></div>
            </div>
          {/each}
        </div>
        <div class="clock-axis" aria-hidden="true">
          <span>12a</span><span>6a</span><span>12p</span><span>6p</span><span>11p</span>
        </div>
      </section>
    {/if}
    </div>

    <div class="cols">
      <section class="col">
        <h3>Top artists</h3>
        {#if data?.artists?.length}
          {@render topList(data.artists)}
        {:else}
          <p class="empty">—</p>
        {/if}
      </section>

      <section class="col">
        <h3>Top tracks</h3>
        {#if data?.recordings?.length}
          {@render topList(data.recordings)}
        {:else}
          <p class="empty">—</p>
        {/if}
      </section>

      <section class="col">
        <h3>Top albums</h3>
        {#if data?.releases?.length}
          {@render topList(data.releases)}
        {:else}
          <p class="empty">—</p>
        {/if}
      </section>
    </div>
    {/if}

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
    max-width: 1000px;
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
    margin-bottom: 1.25rem;
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
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.7rem;
    padding: 0.5rem 0.5rem;
    border-top: 1px solid var(--surface-2);
  }
  .list li:first-child {
    border-top: none;
  }
  /* Relative-magnitude bar behind each row (scaled to the list's #1), so the
     leaderboard reads as a mini bar chart. Sits under the text. */
  .list li::before {
    content: "";
    position: absolute;
    left: 0;
    top: 2px;
    bottom: 2px;
    width: var(--pct, 0%);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    border-left: 2px solid color-mix(in srgb, var(--accent) 55%, transparent);
    border-radius: 0.25rem;
    z-index: 0;
  }
  .list li > * {
    position: relative;
    z-index: 1;
  }
  .rank {
    flex-shrink: 0;
    width: 1.4rem;
    color: var(--dim);
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    text-align: right;
  }
  /* Emphasize the top three. */
  .rank.top {
    color: var(--accent-text);
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
  .empty-range {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 0.4rem;
    padding: 2.5rem 1.5rem;
    margin-bottom: 1.5rem;
    background: var(--surface);
    border: 1px solid var(--surface-2);
    border-radius: 0.9rem;
    color: var(--muted);
  }
  .empty-range :global(.material-symbols-rounded) {
    color: var(--dim);
  }
  .empty-range-t {
    margin: 0.2rem 0 0;
    font-size: 1.05rem;
    font-weight: 600;
    color: var(--text);
  }
  .empty-range-s {
    margin: 0;
    max-width: 46ch;
    font-size: 0.88rem;
  }

  /* --- Recap hero ------------------------------------------------------- */
  .recap {
    display: flex;
    gap: 1.5rem;
    margin-bottom: 1.25rem;
    padding: 1.5rem 1.6rem;
    border-radius: 1rem;
    border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--surface-2));
    background:
      radial-gradient(
        130% 150% at 0% 0%,
        color-mix(in srgb, var(--accent) 26%, transparent),
        transparent 58%
      ),
      var(--surface);
  }
  .recap-main {
    flex: 1;
    min-width: 0;
  }
  .recap-kicker {
    margin: 0 0 0.4rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.7rem;
    font-weight: 700;
    color: var(--accent-text);
  }
  .recap-big {
    margin: 0 0 0.5rem;
    font-size: 1.9rem;
    line-height: 1.15;
    font-weight: 800;
    color: var(--text);
  }
  .recap-sub {
    margin: 0;
    color: var(--muted);
    font-size: 0.95rem;
    max-width: 44ch;
  }
  .recap-play {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    margin-top: 1rem;
    padding: 0.5rem 1.1rem;
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: 2rem;
    font: inherit;
    font-weight: 600;
    font-size: 0.9rem;
    cursor: pointer;
  }
  .recap-play :global(.material-symbols-rounded) {
    color: #fff;
  }
  @media (hover: hover) {
    .recap-play:hover {
      background: var(--accent-hover);
    }
  }
  .recap-artist {
    flex-shrink: 0;
    width: 300px;
    align-self: center;
  }
  .recap-artist-l {
    margin: 0 0 0.2rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 0.68rem;
    font-weight: 600;
    color: var(--dim);
  }
  .recap-artist-name {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 700;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .recap-artist-sub {
    margin: 0.1rem 0 0.7rem;
    color: var(--muted);
    font-size: 0.82rem;
  }
  .mini-bars {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .mini-bars li {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .mini-name {
    flex: 0 0 42%;
    min-width: 0;
    font-size: 0.8rem;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mini-track {
    flex: 1;
    height: 6px;
    background: var(--surface-2);
    border-radius: 3px;
    overflow: hidden;
  }
  .mini-fill {
    display: block;
    height: 100%;
    background: var(--accent);
    border-radius: 3px;
  }
  .mini-val {
    flex-shrink: 0;
    width: 1.6rem;
    text-align: right;
    font-size: 0.78rem;
    color: var(--dim);
    font-variant-numeric: tabular-nums;
  }
  @media (max-width: 720px) {
    .recap {
      flex-direction: column;
    }
    .recap-artist {
      width: auto;
    }
    .recap-big {
      font-size: 1.5rem;
    }
  }

  /* --- Stat tiles ------------------------------------------------------- */
  .tiles {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.9rem;
    margin-bottom: 1.5rem;
  }
  @media (max-width: 720px) {
    .tiles {
      grid-template-columns: 1fr 1fr;
    }
  }
  .tile {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    padding: 0.9rem 1rem;
    background: var(--surface);
    border: 1px solid var(--surface-2);
    border-radius: 0.8rem;
  }
  .tile-l {
    color: var(--muted);
    font-size: 0.78rem;
  }
  .tile-v {
    font-size: 1.6rem;
    font-weight: 700;
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }

  /* --- Chart panels (activity + clock) ---------------------------------- */
  /* Flexbox (not grid) so align-items: stretch reliably gives the two cards the
     exact same height. */
  .panels {
    display: flex;
    align-items: stretch;
    gap: 1.25rem;
    margin-bottom: 1.5rem;
  }
  .panel {
    flex: 1 1 0;
    min-width: 0;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    padding: 1.1rem 1.25rem;
    background: var(--surface);
    border: 1px solid var(--surface-2);
    border-radius: 0.9rem;
    margin-bottom: 0;
  }
  @media (max-width: 720px) {
    .panels {
      flex-direction: column;
    }
  }
  /* Contain the card padding so the multi-column rows never overflow. */
  .recap,
  .tile,
  .col,
  .discover,
  .empty-range {
    box-sizing: border-box;
    min-width: 0;
  }
  /* Both charts flex-fill the card, so the two panels stay the exact same
     height and their bar baselines sit on the same line. */
  .panel .chart {
    flex: 1;
    display: flex;
    flex-direction: column;
  }
  .panel .plot,
  .panel .clock-bars {
    flex: 1;
    min-height: 180px;
  }

  /* Listening clock */
  .clock-bars {
    display: flex;
    align-items: flex-end;
    gap: 3px;
    padding-top: 0.5rem;
  }
  .clock-col {
    flex: 1;
    height: 100%;
    display: flex;
    align-items: flex-end;
  }
  .clock-fill {
    width: 100%;
    min-height: 2px;
    background: linear-gradient(
      to top,
      color-mix(in srgb, var(--accent) 55%, transparent),
      var(--accent)
    );
    border-radius: 2px 2px 0 0;
  }
  .clock-fill.peak {
    background: linear-gradient(to top, var(--accent), var(--accent-text));
  }
  .clock-axis {
    display: flex;
    justify-content: space-between;
    margin-top: 0.4rem;
    color: var(--dim);
    font-size: 0.72rem;
  }

  /* Card-ify the top-lists row. */
  .col {
    padding: 1.1rem 1.25rem;
    background: var(--surface);
    border: 1px solid var(--surface-2);
    border-radius: 0.9rem;
  }

  /* Listening activity bar chart */
  /* The activity chart is a flex panel now; a bottom margin here would eat into
     its stretched height and leave it shorter than the clock card. */
  .activity-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
    margin: 0 0 0.8rem;
  }
  .activity-head h3 {
    margin: 0;
    font-size: 0.95rem;
  }
  .activity-sum {
    color: var(--muted);
    font-size: 0.8rem;
    font-variant-numeric: tabular-nums;
  }
  /* Leave room on the left for the y-axis value labels. */
  .chart {
    padding-left: 2.4rem;
  }
  .plot {
    position: relative;
  }
  /* Gridlines: evenly spaced horizontal rules spanning the plot, each carrying
     its value on the left so magnitudes are readable at a glance. */
  .grid {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    pointer-events: none;
  }
  .grid-line {
    position: relative;
    border-top: 1px solid var(--surface-2);
  }
  /* The baseline (last line) reads a touch stronger than the interior grid. */
  .grid-line:last-child {
    border-top-color: var(--border-strong);
  }
  .grid-val {
    position: absolute;
    left: -2.4rem;
    top: -0.6em;
    width: 2rem;
    text-align: right;
    color: var(--dim);
    font-size: 0.66rem;
    font-variant-numeric: tabular-nums;
  }
  .bars {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: flex-end;
    gap: var(--bar-gap, 4px);
  }
  .bar-col {
    position: relative;
    flex: 1;
    min-width: 0;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: center;
    /* Reset button chrome — the column is just a focusable/tappable hit target
       for its bar, revealing the value on hover/focus/tap. */
    padding: 0;
    background: transparent;
    border: none;
    border-radius: 4px 4px 0 0;
    font: inherit;
    cursor: pointer;
    outline: none;
  }
  .bar-fill {
    width: 100%;
    max-width: 34px;
    /* Sequential single hue (theme accent); slightly recessed by default so the
       peak and any hovered/focused bar can read stronger without adding hues. */
    background: color-mix(in srgb, var(--accent) 78%, var(--surface));
    border-radius: 4px 4px 0 0;
    transition:
      height 0.25s ease,
      background 0.12s ease;
  }
  .bar-fill.peak {
    background: var(--accent);
  }
  .bar-fill.empty {
    background: var(--surface-2);
  }
  .bar-col:hover .bar-fill,
  .bar-col:focus-visible .bar-fill,
  .bar-col.selected .bar-fill {
    background: var(--accent);
  }
  .bar-col:focus-visible {
    outline: 2px solid var(--accent-text);
    outline-offset: 2px;
  }
  /* Value label: hidden by default, revealed on hover/focus and always shown on
     the peak bar — so a number is reachable by touch + keyboard, not hover-only,
     without printing a label on every bar. */
  .bar-value {
    position: absolute;
    bottom: 100%;
    margin-bottom: 3px;
    padding: 0.05rem 0.3rem;
    background: var(--surface);
    border: 1px solid var(--surface-2);
    border-radius: 0.3rem;
    color: var(--text);
    font-size: 0.66rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    opacity: 0;
    transition: opacity 0.12s ease;
    pointer-events: none;
  }
  .bar-col:hover .bar-value,
  .bar-col:focus-visible .bar-value,
  .bar-col.selected .bar-value,
  .bar-col:has(.peak) .bar-value {
    opacity: 1;
  }
  .xaxis {
    display: flex;
    gap: var(--bar-gap, 4px);
    margin-top: 0.4rem;
  }
  /* Each label keeps a bar-width slot (min-width:0 so it never widens the slot
     and misaligns the bars) but is allowed to overflow visibly into the empty
     neighbouring slots — labels are thinned to ~8, so there's ample room and no
     collisions. The first/last labels align to their edge so they don't spill
     off the chart. */
  .xlabel {
    flex: 1;
    min-width: 0;
    text-align: center;
    font-size: 0.66rem;
    color: var(--dim);
    white-space: nowrap;
    overflow: visible;
  }
  .xlabel.edge-l {
    text-align: left;
  }
  .xlabel.edge-r {
    text-align: right;
  }

  /* Discover: recommendations + fresh releases */
  .discover {
    margin-top: 0;
    margin-bottom: 1.25rem;
    padding: 1.1rem 1.25rem;
    background: var(--surface);
    border: 1px solid var(--surface-2);
    border-radius: 0.9rem;
  }
  .discover h3 {
    margin: 0 0 0.15rem;
    font-size: 0.95rem;
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
