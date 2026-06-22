<script lang="ts">
  import { goto } from "$app/navigation";
  import Icon from "$lib/components/Icon.svelte";
  import SongMenu from "$lib/components/SongMenu.svelte";
  import { thumbUrl } from "$lib/services/songService";
  import type { Song } from "$lib/types";
  import type { SongViewModel } from "$lib/viewmodels/songViewModel.svelte";

  let { vm }: { vm: SongViewModel } = $props();

  const LIMIT = 8;
  const recentlyAdded = $derived(vm.recentlyAdded.slice(0, LIMIT));
  const mostPlayed = $derived(vm.mostPlayed.slice(0, LIMIT));
  const recentlyPlayed = $derived(vm.recentlyPlayed.slice(0, LIMIT));

  // Top artists by total play count (tagged artists only).
  const mostPlayedArtists = $derived.by(() => {
    const map = new Map<string, Song[]>();
    for (const s of vm.songs) {
      const name = s.artist?.trim();
      if (!name) continue;
      const list = map.get(name) ?? [];
      list.push(s);
      map.set(name, list);
    }
    return [...map.entries()]
      .map(([name, songs]) => ({
        name,
        plays: songs.reduce((sum, s) => sum + s.playCount, 0),
        // Match the artist view: picture = first track in manual order with art.
        artId:
          [...songs]
            .sort((a, b) => (a.sortOrder ?? Infinity) - (b.sortOrder ?? Infinity))
            .find((s) => s.hasArt)?.id ?? null,
      }))
      .filter((a) => a.plays > 0)
      .sort((a, b) => b.plays - a.plays)
      .slice(0, LIMIT);
  });

  function openArtist(name: string) {
    goto(`?view=artists&artist=${encodeURIComponent(name)}`, { noScroll: true });
  }

  type SortBy = "added" | "name" | "plays" | "duration";

  // Clicking a section title jumps to the full view it summarizes.
  function goSection(targetView: string, sort?: SortBy) {
    if (sort) vm.sortBy = sort;
    goto(targetView === "home" ? "/" : `?view=${targetView}`, { noScroll: true });
  }
</script>

{#snippet section(
  title: string,
  icon: string,
  list: Song[],
  target: string,
  sort?: SortBy,
)}
  {#if list.length > 0}
    <section>
      <div class="head">
        <button class="head-title" onclick={() => goSection(target, sort)}>
          <Icon name={icon} size={20} /> {title}
          <Icon name="chevron_right" size={20} />
        </button>
      </div>
      <div class="cards">
        {#each list as song, i (song.id)}
          <!-- Right-click anywhere on the card opens the same menu as the list's
               ⋮ button; SongMenu wires it up via the data-song-menu-row marker. -->
          <div class="card" data-song-menu-row>
            <button class="card-btn" onclick={() => vm.playQueue(list, i)}>
              <span class="cover">
                {#if song.hasArt}
                  <img src={thumbUrl(song.id, 512)} alt="" />
                {:else}
                  <Icon name="music_note" size={26} />
                {/if}
                <span class="play-overlay"><Icon name="play_arrow" fill size={26} /></span>
              </span>
              <span class="c-name">{song.originalFilename}</span>
              {#if song.artist}<span class="c-sub">{song.artist}</span>{/if}
            </button>
            <SongMenu {vm} {song} />
          </div>
        {/each}
      </div>
    </section>
  {/if}
{/snippet}

{#if vm.songs.length === 0}
  <p class="muted">No songs yet. Upload some to get started.</p>
{:else}
  {@render section("Recently Added", "schedule", recentlyAdded, "songs", "added")}
  {@render section("Most Played", "trending_up", mostPlayed, "songs", "plays")}

  {#if mostPlayedArtists.length > 0}
    <section>
      <div class="head">
        <button class="head-title" onclick={() => goSection("artists")}>
          <Icon name="artist" size={20} /> Most Played Artists
          <Icon name="chevron_right" size={20} />
        </button>
      </div>
      <div class="cards artists">
        {#each mostPlayedArtists as a (a.name)}
          <button class="card card-btn" onclick={() => openArtist(a.name)}>
            <span class="cover round">
              {#if a.artId !== null}
                <img src={thumbUrl(a.artId, 512)} alt="" />
              {:else}
                <Icon name="person" size={26} />
              {/if}
            </span>
            <span class="c-name">{a.name}</span>
            <span class="c-sub">{a.plays} play{a.plays === 1 ? "" : "s"}</span>
          </button>
        {/each}
      </div>
    </section>
  {/if}

  {@render section("Recently Played", "history", recentlyPlayed, "recent")}
{/if}

<style>
  section {
    margin-bottom: 2rem;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    margin-bottom: 0.75rem;
  }
  .head-title {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    margin: 0;
    padding: 0.1rem 0.3rem 0.1rem 0;
    background: none;
    border: none;
    color: inherit;
    font: inherit;
    font-size: 1.15rem;
    font-weight: 700;
    cursor: pointer;
    border-radius: 0.4rem;
  }
  /* The trailing chevron is dim until you hover the title. */
  .head-title :global(.material-symbols-rounded:last-child) {
    color: var(--dim);
    transition: transform 0.12s;
  }
  @media (hover: hover) {
    .head-title:hover {
      color: var(--accent-text);
    }
  }
  @media (hover: hover) {
    .head-title:hover :global(.material-symbols-rounded:last-child) {
      color: var(--accent-text);
      transform: translateX(2px);
    }
  }
  .cards {
    display: grid;
    /* Cap the track size (auto-fit, max 200px) so a section with only a few
       items doesn't stretch into giant cards — packed left, like the artists
       section. */
    grid-template-columns: repeat(auto-fit, minmax(140px, 200px));
    gap: 1rem;
    justify-content: start;
  }
  .card {
    position: relative;
    background: var(--surface);
    border: 1px solid var(--surface-2);
    border-radius: 0.6rem;
  }
  .card-btn {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    width: 100%;
    box-sizing: border-box;
    padding: 0.6rem;
    background: none;
    border: none;
    border-radius: 0.6rem;
    cursor: pointer;
    text-align: left;
    color: inherit;
    font: inherit;
  }
  @media (hover: hover) {
    .card:hover {
      background: var(--hover);
    }
  }
  /* The card's right-click menu has no visible trigger here — the whole card is
     the target — so hide SongMenu's ⋮ button. The popup/backdrop live elsewhere
     in the component and still render when right-click opens the menu. */
  .card :global(.dots) {
    display: none;
  }
  /* The now-empty menu-wrap shouldn't add a stray gap below the card button. */
  .card :global(.menu-wrap) {
    position: absolute;
  }
  .cover {
    position: relative;
    aspect-ratio: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--surface-2);
    border-radius: 0.4rem;
    color: var(--dim);
    overflow: hidden;
  }
  .cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .cover.round {
    border-radius: 50%;
  }
  .play-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.4);
    color: #fff;
    opacity: 0;
    transition: opacity 0.12s ease;
  }
  @media (hover: hover) {
    .card:hover .play-overlay {
      opacity: 1;
    }
  }
  .c-name {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .c-sub {
    color: var(--muted);
    font-size: 0.8rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .muted {
    color: var(--muted);
  }

  @media (max-width: 768px) {
    /* Always fit at least 2 cards per row on phones: cap the minimum column at
       half the row (minus the gap) so a fixed 140px min can't force 1 column on
       narrow screens. Wider phones/tablets still pack 3+. */
    .cards {
      grid-template-columns: repeat(
        auto-fill,
        minmax(min(140px, calc(50% - 0.5rem)), 1fr)
      );
    }
  }
</style>
