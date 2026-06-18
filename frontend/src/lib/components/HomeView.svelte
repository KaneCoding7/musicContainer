<script lang="ts">
  import { goto } from "$app/navigation";
  import Icon from "$lib/components/Icon.svelte";
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
</script>

{#snippet section(title: string, icon: string, list: Song[])}
  {#if list.length > 0}
    <section>
      <div class="head">
        <h3><Icon name={icon} size={20} /> {title}</h3>
      </div>
      <div class="cards">
        {#each list as song, i (song.id)}
          <button class="card" onclick={() => vm.playQueue(list, i)}>
            <span class="cover">
              {#if song.hasArt}
                <img src={thumbUrl(song.id, 128)} alt="" />
              {:else}
                <Icon name="music_note" size={26} />
              {/if}
              <span class="play-overlay"><Icon name="play_arrow" fill size={26} /></span>
            </span>
            <span class="c-name">{song.originalFilename}</span>
            {#if song.artist}<span class="c-sub">{song.artist}</span>{/if}
          </button>
        {/each}
      </div>
    </section>
  {/if}
{/snippet}

{#if vm.songs.length === 0}
  <p class="muted">No songs yet. Upload some to get started.</p>
{:else}
  {@render section("Recently Added", "schedule", recentlyAdded)}
  {@render section("Most Played", "trending_up", mostPlayed)}

  {#if mostPlayedArtists.length > 0}
    <section>
      <div class="head">
        <h3><Icon name="artist" size={20} /> Most Played Artists</h3>
      </div>
      <div class="cards artists">
        {#each mostPlayedArtists as a (a.name)}
          <button class="card" onclick={() => openArtist(a.name)}>
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

  {@render section("Recently Played", "history", recentlyPlayed)}
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
  h3 {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    margin: 0;
    font-size: 1.15rem;
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
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.6rem;
    background: var(--surface);
    border: 1px solid var(--surface-2);
    border-radius: 0.6rem;
    cursor: pointer;
    text-align: left;
    color: inherit;
    font: inherit;
  }
  .card:hover {
    background: var(--hover);
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
  .card:hover .play-overlay {
    opacity: 1;
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
</style>
