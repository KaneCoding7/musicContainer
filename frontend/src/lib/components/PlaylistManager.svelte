<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import Icon from "$lib/components/Icon.svelte";
  import EqualizerBars from "$lib/components/EqualizerBars.svelte";
  import PlayActions from "$lib/components/PlayActions.svelte";
  import PlaylistMembers from "$lib/components/PlaylistMembers.svelte";
  import SongMenu from "$lib/components/SongMenu.svelte";
  import UserAutocomplete from "$lib/components/UserAutocomplete.svelte";
  import { swipeQueue } from "$lib/actions/swipeQueue";
  import { reorderHandle } from "$lib/actions/reorderHandle";
  import { playlistImageUrl, playlistZipUrl } from "$lib/services/playlistService";
  import { copySongToLibrary, thumbUrl } from "$lib/services/songService";
  import {
    disablePublicLink,
    enablePublicLink,
    fetchPlaylistShares,
    getPublicToken,
    publicLink,
    sharePlaylist,
    unsharePlaylist,
    type ShareUser,
  } from "$lib/services/shareService";
  import type { PlaylistViewModel } from "$lib/viewmodels/playlistViewModel.svelte";
  import type { SongViewModel } from "$lib/viewmodels/songViewModel.svelte";

  let {
    vm,
    songVm,
  }: { vm: PlaylistViewModel; songVm: SongViewModel } = $props();

  let newName = $state("");
  let addOpen = $state(false);
  let addQuery = $state("");

  // Search/filter the playlist grid by name.
  let query = $state("");
  const filteredPlaylists = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return q
      ? vm.playlists.filter((p) => p.name.toLowerCase().includes(q))
      : vm.playlists;
  });

  // Create-playlist modal (name + optional cover image).
  let showCreate = $state(false);
  let newImage = $state<File | null>(null);
  let newImagePreview = $state<string | null>(null);
  let creating = $state(false);
  function openCreate() {
    newName = "";
    newImage = null;
    newImagePreview = null;
    showCreate = true;
  }
  function onPickImage(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0] ?? null;
    newImage = f;
    newImagePreview = f ? URL.createObjectURL(f) : null;
  }

  // The open playlist is driven by the URL (?playlist=id) so it's a real
  // drill-in view: deep-linkable and the browser back button returns to the
  // grid, like the artist view.
  const openId = $derived.by(() => {
    const raw = page.url.searchParams.get("playlist");
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : null;
  });
  // Keep the view-model's selection in sync with the URL.
  $effect(() => {
    if (openId !== null && vm.selectedId !== openId) vm.select(openId);
  });
  function openPlaylist(id: number) {
    goto(`?view=playlists&playlist=${id}`, { noScroll: true });
  }
  function closePlaylist() {
    goto("?view=playlists", { noScroll: true });
  }

  // --- Sharing ---
  let shareOpen = $state(false);
  let shareCanEdit = $state(false);
  let shares = $state<ShareUser[]>([]);
  let memberRefresh = $state(0); // bump to re-fetch the members bar
  let shareError = $state<string | null>(null);
  // The playlist is collaborative once it's shared with anyone.
  const collaborative = $derived(shares.length > 0);
  let publicToken = $state<string | null>(null);
  let publicCopied = $state(false);

  // Load the share list + public-link state whenever a different playlist is
  // selected.
  $effect(() => {
    const id = vm.selectedId;
    shareOpen = false;
    shareError = null;
    reordering = false; // leave reorder mode when switching playlists
    shares = [];
    publicToken = null;
    publicCopied = false;
    if (id !== null) {
      fetchPlaylistShares(id)
        .then((s) => (shares = s))
        .catch(() => {});
      getPublicToken(id)
        .then((t) => (publicToken = t))
        .catch(() => {});
    }
  });

  async function togglePublic() {
    const id = vm.selectedId;
    if (id === null) return;
    shareError = null;
    try {
      if (publicToken) {
        await disablePublicLink(id);
        publicToken = null;
      } else {
        publicToken = await enablePublicLink(id);
      }
    } catch (e) {
      shareError = e instanceof Error ? e.message : "Failed to update link";
    }
  }

  async function copyPublic() {
    if (!publicToken) return;
    try {
      await navigator.clipboard.writeText(publicLink(publicToken));
      publicCopied = true;
      setTimeout(() => (publicCopied = false), 1500);
    } catch {
      shareError = "Couldn't copy to clipboard";
    }
  }

  async function doShare(email: string) {
    const id = vm.selectedId;
    email = email.trim();
    if (id === null || !email) return;
    shareError = null;
    try {
      await sharePlaylist(id, email, shareCanEdit);
      shares = await fetchPlaylistShares(id);
      memberRefresh++;
    } catch (e) {
      shareError = e instanceof Error ? e.message : "Failed to share";
    }
  }

  async function revoke(userId: string) {
    const id = vm.selectedId;
    if (id === null) return;
    try {
      await unsharePlaylist(id, userId);
      shares = shares.filter((s) => s.id !== userId);
      memberRefresh++;
    } catch (e) {
      shareError = e instanceof Error ? e.message : "Failed to revoke";
    }
  }

  async function submitCreate() {
    const name = newName.trim();
    if (!name || creating) return;
    creating = true;
    const ok = await vm.create(name, newImage);
    creating = false;
    if (ok) {
      showCreate = false;
      newName = "";
      newImage = null;
      newImagePreview = null;
      if (vm.selectedId !== null) openPlaylist(vm.selectedId); // drill into it
    }
  }

  // Songs in the library not already in the selected playlist.
  const addableSongs = $derived(
    songVm.songs.filter(
      (s) => !vm.selectedSongs.some((ps) => ps.id === s.id)
    )
  );

  // Search-to-add: filter the addable library by the query (capped for speed).
  const ADD_LIMIT = 50;
  const addResults = $derived.by(() => {
    const q = addQuery.trim().toLowerCase();
    const list = q
      ? addableSongs.filter(
          (s) =>
            s.originalFilename.toLowerCase().includes(q) ||
            (s.artist ?? "").toLowerCase().includes(q) ||
            (s.album ?? "").toLowerCase().includes(q)
        )
      : addableSongs;
    return list.slice(0, ADD_LIMIT);
  });

  function playFrom(index: number) {
    songVm.playQueue(vm.selectedSongs, index);
  }

  // --- Saved-from-a-share playlists ---
  // A saved copy references the original owner's song rows, so it carries the
  // same "shared" extras: who-added badges + per-song add-to-my-library.
  const isSavedCopy = $derived(vm.selected?.copiedFrom != null);
  let addedToLib = $state<Set<number>>(new Set());
  let addingLib = $state<number | null>(null);
  const ownsSong = (id: number) => songVm.songs.some((s) => s.id === id);

  async function addToLibrary(songId: number) {
    if (addingLib !== null || addedToLib.has(songId)) return;
    addingLib = songId;
    try {
      const copied = await copySongToLibrary(songId);
      songVm.songs = [copied, ...songVm.songs];
      addedToLib = new Set([...addedToLib, songId]);
    } catch (e) {
      vm.error = e instanceof Error ? e.message : "Failed to add to library";
    } finally {
      addingLib = null;
    }
  }

  // --- Edit-playlist modal (rename + change cover + jump to reorder) ---
  let showEdit = $state(false);
  let editName = $state("");
  let editImage = $state<File | null>(null);
  let editImagePreview = $state<string | null>(null);
  let savingEdit = $state(false);
  let coverBust = $state(0); // bump to refresh cached cover after a change

  function openEdit() {
    const cur = vm.selected;
    if (!cur) return;
    editName = cur.name;
    editImage = null;
    editImagePreview = null;
    showEdit = true;
  }
  function onPickEditImage(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0] ?? null;
    editImage = f;
    editImagePreview = f ? URL.createObjectURL(f) : null;
  }
  async function submitEdit() {
    const cur = vm.selected;
    if (!cur || savingEdit) return;
    const name = editName.trim();
    if (!name) return;
    savingEdit = true;
    if (name !== cur.name) await vm.rename(cur.id, name);
    if (editImage) {
      const ok = await vm.setImage(cur.id, editImage);
      if (ok) coverBust = Date.now();
    }
    savingEdit = false;
    showEdit = false;
    editImage = null;
    editImagePreview = null;
  }
  // Leave the modal and turn on in-list drag reordering.
  function startReorder() {
    showEdit = false;
    reordering = true;
  }

  function deleteSelected() {
    const current = vm.selected;
    if (!current) return;
    if (confirm(`Delete playlist "${current.name}"? This cannot be undone.`)) {
      vm.remove(current.id);
      closePlaylist(); // back to the grid
    }
  }

  // --- Drag-to-reorder ---
  // Off by default; the Edit button reveals the drag handles. Reordering is
  // pointer-based (works on touch) via the handle.
  let reordering = $state(false);

  function moveTrack(from: number, to: number) {
    if (from === to) return;
    const arr = [...vm.selectedSongs];
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
    vm.reorder(arr);
  }
</script>

<div class="playlists">
  {#if openId === null}
  <div class="pl-toolbar">
    <div class="search">
      <Icon name="search" size={20} />
      <input type="search" placeholder="Search playlists…" bind:value={query} />
    </div>
    <button class="create-btn" onclick={openCreate} title="Create playlist" aria-label="Create playlist">
      <Icon name="add" size={22} />
    </button>
  </div>

  {#if vm.error}
    <p class="error">{vm.error}</p>
  {/if}

  {#if vm.playlists.length === 0}
    <p class="muted">No playlists yet. Tap Create to make one.</p>
  {:else if filteredPlaylists.length === 0}
    <p class="muted">No playlists match “{query}”.</p>
  {:else}
    <div class="cards">
      {#each filteredPlaylists as playlist (playlist.id)}
        <button
          class="card"
          onclick={() => openPlaylist(playlist.id)}
        >
          <span class="cover">
            {#if playlist.hasImage}
              <img src={playlistImageUrl(playlist.id, 512, coverBust)} alt="" />
            {:else if playlist.coverSongId != null}
              <img src={thumbUrl(playlist.coverSongId, 512)} alt="" />
            {:else}
              <Icon name="queue_music" size={26} />
            {/if}
          </span>
          <span class="card-text">
            <span class="card-name">{playlist.name}</span>
            <span class="card-sub">
              {playlist.trackCount ?? 0}
              {(playlist.trackCount ?? 0) === 1 ? "track" : "tracks"}
            </span>
          </span>
        </button>
      {/each}
    </div>
  {/if}
  {/if}

  {#if openId !== null}
    <button class="back" onclick={closePlaylist}>
      <Icon name="arrow_back" size={20} /> All playlists
    </button>
    {#if vm.selected}
    <div class="detail">
      <div class="head">
        <span class="cover-lg">
          {#if vm.selected.hasImage}
            <img src={playlistImageUrl(vm.selected.id, 512, coverBust)} alt="" />
          {:else if vm.selected.coverSongId != null}
            <img src={thumbUrl(vm.selected.coverSongId, 512)} alt="" />
          {:else}
            <Icon name="queue_music" size={48} />
          {/if}
        </span>
        <div class="head-info">
          <h3>{vm.selected.name}</h3>
          <p class="muted">
            {vm.selectedSongs.length}
            {vm.selectedSongs.length === 1 ? "track" : "tracks"}
            {#if isSavedCopy && vm.selected.copiedFromOwner}
              · Saved from {vm.selected.copiedFromOwner}
            {/if}
          </p>
          <div class="detail-actions">
            {#if reordering}
              <button
                class="head-action on"
                title="Done reordering"
                aria-label="Done reordering"
                onclick={() => (reordering = false)}
                ><Icon name="check" size={20} /></button
              >
            {:else}
            <button
              class="head-action"
              title="Edit playlist"
              aria-label="Edit playlist"
              onclick={openEdit}><Icon name="edit" size={20} /></button
            >
            {#if vm.selectedSongs.length > 0}
              <a
                class="head-action"
                href={playlistZipUrl(vm.selectedId ?? 0)}
                title="Download as zip"
                aria-label="Download playlist as zip"><Icon name="download" size={20} /></a
              >
            {/if}
            <button
              class="head-action"
              class:on={shareOpen}
              title="Share playlist"
              aria-label="Share playlist"
              onclick={() => (shareOpen = !shareOpen)}
              ><Icon name="share" size={20} /></button
            >
            <button
              class="head-action danger"
              title="Delete playlist"
              aria-label="Delete playlist"
              onclick={deleteSelected}><Icon name="delete" size={20} /></button
            >
            {/if}
          </div>
        </div>
      </div>

      {#if vm.selectedSongs.length > 0}
        <div class="actions-bar">
          <PlayActions vm={songVm} songs={vm.selectedSongs} />
        </div>
      {/if}

      {#if vm.selectedId !== null}
        <PlaylistMembers playlistId={vm.selectedId} refresh={memberRefresh} />
      {/if}

      {#if shareOpen}
        <div class="share-panel">
          <p class="sp-section">Invite people</p>
          <UserAutocomplete
            placeholder="Search by name or email…"
            onSelect={(u) => doShare(u.email)}
          />
          <label class="sp-option">
            <input type="checkbox" bind:checked={shareCanEdit} />
            <span>
              <span class="opt-title">Can edit</span>
              <span class="opt-sub">Let them add &amp; remove tracks</span>
            </span>
          </label>
          {#if shareError}<p class="sp-error">{shareError}</p>{/if}

          <p class="sp-section">People with access</p>
          {#if shares.length > 0}
            <ul class="people">
              {#each shares as u (u.id)}
                <li>
                  <span class="avatar">{u.name.slice(0, 1).toUpperCase()}</span>
                  <span class="who">
                    <span class="who-name">
                      {u.name}
                      <span class="role" class:view={!u.canEdit}>
                        {u.canEdit ? "Editor" : "Viewer"}
                      </span>
                    </span>
                    <span class="who-email">{u.email}</span>
                  </span>
                  <button
                    class="revoke"
                    title="Remove access"
                    aria-label="Remove access"
                    onclick={() => revoke(u.id)}><Icon name="close" size={18} /></button
                  >
                </li>
              {/each}
            </ul>
          {:else}
            <p class="sp-empty">Not shared with anyone yet.</p>
          {/if}

          <p class="sp-section">Public link</p>
          <div class="public-row">
            <span class="public-desc">
              <Icon name="public" size={18} />
              <span>Anyone with the link can listen — no account needed.</span>
            </span>
            <button class="link-toggle" class:on={publicToken} onclick={togglePublic}>
              {publicToken ? "Turn off" : "Create link"}
            </button>
          </div>
          {#if publicToken}
            <div class="public-url">
              <span class="url">{publicLink(publicToken)}</span>
              <button class="copy" onclick={copyPublic}>
                <Icon name={publicCopied ? "check" : "content_copy"} size={16} />
                {publicCopied ? "Copied" : "Copy"}
              </button>
            </div>
          {/if}
        </div>
      {/if}

      {#if vm.selectedSongs.length === 0}
        <p class="muted">No songs in this playlist yet.</p>
      {:else}
        <ol>
          {#each vm.selectedSongs as song, i (song.id)}
            {@const isCurrent = song.id === songVm.currentSong?.id}
            <li
              class:current={isCurrent}
              class:playing={isCurrent && songVm.isPlaying}
              data-reorder-index={i}
              use:swipeQueue={{
                onQueue: () => songVm.playNext(song),
                disabled: reordering,
              }}
            >
              {#if reordering}
                <span
                  class="handle"
                  title="Drag to reorder"
                  use:reorderHandle={{ index: i, onMove: moveTrack }}
                >
                  <Icon name="drag_indicator" size={20} />
                </span>
              {/if}
              <button class="play-btn" onclick={() => playFrom(i)}>
                <span class="thumb">
                  {#if song.hasArt}
                    <img src={thumbUrl(song.id, 128)} alt="" />
                  {:else}
                    <Icon name="music_note" size={18} />
                  {/if}
                  <span class="thumb-play">
                    <Icon
                      name={isCurrent && songVm.isPlaying ? "pause" : "play_arrow"}
                      fill
                      size={20}
                    />
                  </span>
                  {#if isCurrent && songVm.isPlaying}
                    <span class="thumb-wave"><EqualizerBars size={18} /></span>
                  {/if}
                </span>
                <span class="name">{song.originalFilename}</span>
              </button>
              {#if (collaborative || isSavedCopy) && song.addedBy}
                <span class="added-by" title={`Added by ${song.addedBy}`}>
                  <Icon name="person" size={13} />{song.addedBy}
                </span>
              {/if}
              {#if isSavedCopy && !ownsSong(song.id)}
                <button
                  class="to-lib"
                  class:done={addedToLib.has(song.id)}
                  class:loading={addingLib === song.id}
                  title={addedToLib.has(song.id) ? "In your library" : "Add to my library"}
                  aria-label="Add to my library"
                  disabled={addingLib !== null || addedToLib.has(song.id)}
                  onclick={() => addToLibrary(song.id)}
                >
                  <Icon
                    name={addedToLib.has(song.id)
                      ? "check_circle"
                      : addingLib === song.id
                        ? "progress_activity"
                        : "library_music"}
                    size={18}
                  />
                </button>
              {/if}
              <span
                class="plays"
                title={`${song.playCount} play${song.playCount === 1 ? "" : "s"}`}
              >
                <Icon name="play_arrow" size={13} />{song.playCount}
              </span>
              <SongMenu
                vm={songVm}
                {song}
                onRemoveFromPlaylist={() => vm.removeSong(song.id)}
                onChanged={() => {
                  if (vm.selectedId !== null) vm.select(vm.selectedId);
                }}
              />
              <button
                class="remove"
                title="Remove from playlist"
                aria-label="Remove from playlist"
                onclick={() => vm.removeSong(song.id)}
                ><Icon name="close" size={20} /></button
              >
            </li>
          {/each}
        </ol>
      {/if}

      <div class="add-block">
        <button class="add-toggle" onclick={() => (addOpen = !addOpen)}>
          <Icon name={addOpen ? "expand_more" : "playlist_add"} size={18} />
          {addOpen ? "Done" : "Add songs"}
        </button>

        {#if addOpen}
          {#if addableSongs.length === 0}
            <p class="muted small">All your songs are already in this playlist.</p>
          {:else}
            <input
              class="add-search"
              type="text"
              placeholder="Search your library to add…"
              bind:value={addQuery}
            />
            {#if addResults.length === 0}
              <p class="muted small">No songs match “{addQuery}”.</p>
            {:else}
              <ul class="add-results">
                {#each addResults as song (song.id)}
                  <li>
                    <span class="ar-meta">
                      <span class="ar-name">{song.originalFilename}</span>
                      {#if song.artist}<span class="ar-artist">{song.artist}</span>{/if}
                    </span>
                    <button
                      class="ar-add"
                      title="Add to playlist"
                      aria-label="Add to playlist"
                      onclick={() => vm.addSong(song.id)}
                    >
                      <Icon name="playlist_add" size={18} />
                    </button>
                  </li>
                {/each}
              </ul>
              {#if addResults.length === ADD_LIMIT}
                <p class="muted small">Showing the first {ADD_LIMIT} — keep typing to narrow it down.</p>
              {/if}
            {/if}
          {/if}
        {/if}
      </div>
    </div>
    {/if}
  {/if}
</div>

{#if showCreate}
  <div
    class="modal-backdrop"
    role="button"
    tabindex="-1"
    onclick={(e) => e.target === e.currentTarget && (showCreate = false)}
    onkeydown={(e) => e.key === "Escape" && (showCreate = false)}
  >
    <div
      class="dialog"
      role="dialog"
      tabindex="-1"
      aria-modal="true"
      aria-label="Create playlist"
    >
      <h3>New playlist</h3>

      <div class="art-row">
        <span class="art-thumb">
          {#if newImagePreview}
            <img src={newImagePreview} alt="" />
          {:else}
            <Icon name="add_photo_alternate" size={26} />
          {/if}
        </span>
        <div class="art-actions">
          <input class="art-file" type="file" accept="image/*" onchange={onPickImage} />
          <span class="art-hint">Cover image — optional</span>
        </div>
      </div>

      <label>
        Name
        <input
          type="text"
          placeholder="Playlist name"
          bind:value={newName}
          onkeydown={(e) => e.key === "Enter" && submitCreate()}
        />
      </label>

      <div class="actions">
        <button class="secondary" onclick={() => (showCreate = false)}>Cancel</button>
        <button onclick={submitCreate} disabled={!newName.trim() || creating}>
          {creating ? "Creating…" : "Create"}
        </button>
      </div>
    </div>
  </div>
{/if}

{#if showEdit && vm.selected}
  <div
    class="modal-backdrop"
    role="button"
    tabindex="-1"
    onclick={(e) => e.target === e.currentTarget && (showEdit = false)}
    onkeydown={(e) => e.key === "Escape" && (showEdit = false)}
  >
    <div
      class="dialog"
      role="dialog"
      tabindex="-1"
      aria-modal="true"
      aria-label="Edit playlist"
    >
      <h3>Edit playlist</h3>

      <div class="art-row">
        <span class="art-thumb">
          {#if editImagePreview}
            <img src={editImagePreview} alt="" />
          {:else if vm.selected.hasImage}
            <img src={playlistImageUrl(vm.selected.id, 512, coverBust)} alt="" />
          {:else if vm.selected.coverSongId != null}
            <img src={thumbUrl(vm.selected.coverSongId, 512)} alt="" />
          {:else}
            <Icon name="add_photo_alternate" size={26} />
          {/if}
        </span>
        <div class="art-actions">
          <input class="art-file" type="file" accept="image/*" onchange={onPickEditImage} />
          <span class="art-hint">Change cover image</span>
        </div>
      </div>

      <label>
        Name
        <input
          type="text"
          placeholder="Playlist name"
          bind:value={editName}
          onkeydown={(e) => e.key === "Enter" && submitEdit()}
        />
      </label>

      {#if vm.selectedSongs.length > 1}
        <button class="reorder-link" onclick={startReorder}>
          <Icon name="swap_vert" size={18} />
          Reorder tracks
        </button>
      {/if}

      <div class="actions">
        <button class="secondary" onclick={() => (showEdit = false)}>Cancel</button>
        <button onclick={submitEdit} disabled={!editName.trim() || savingEdit}>
          {savingEdit ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .pl-toolbar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }
  .search {
    flex: 1;
    min-width: 0;
    max-width: 22rem;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 1.1rem;
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: 2rem;
    color: var(--dim);
  }
  .search input {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: none;
    outline: none;
    color: var(--text);
    font: inherit;
  }
  .search input::placeholder {
    color: var(--dim);
  }
  .create-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 2.5rem;
    height: 2.5rem;
    padding: 0;
    border-radius: 50%;
  }
  /* Create-playlist modal — mirrors EditSongDialog */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 60;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    box-sizing: border-box;
  }
  .dialog {
    width: min(420px, 100%);
    max-height: 90vh;
    overflow-y: auto;
    box-sizing: border-box;
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: 0.75rem;
    padding: 1.25rem;
  }
  .dialog h3 {
    margin: 0 0 1rem;
  }
  .art-row {
    display: flex;
    gap: 1rem;
    align-items: center;
    margin-bottom: 1rem;
  }
  .art-thumb {
    width: 72px;
    height: 72px;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--surface-2);
    border-radius: 0.5rem;
    color: var(--dim);
    overflow: hidden;
  }
  .art-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .art-actions {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    align-items: flex-start;
  }
  /* Plain, fully-visible native file input (same as EditSongDialog — most
     reliable on iOS Safari, and the visible button can't fall through). */
  .art-file {
    max-width: 100%;
    font-size: 0.8rem;
    color: var(--muted);
  }
  .art-file::file-selector-button,
  .art-file::-webkit-file-upload-button {
    margin-right: 0.5rem;
    padding: 0.45rem 0.85rem;
    background: var(--accent);
    border: none;
    border-radius: 0.4rem;
    color: #fff;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .art-hint {
    font-size: 0.72rem;
    color: var(--dim);
  }
  .dialog label {
    display: block;
    margin-bottom: 0.75rem;
    color: var(--muted);
    font-size: 0.85rem;
  }
  .dialog label input[type="text"] {
    display: block;
    width: 100%;
    box-sizing: border-box;
    margin-top: 0.25rem;
    padding: 0.5rem 0.7rem;
    background: var(--bg);
    border: 1px solid var(--border-strong);
    border-radius: 0.5rem;
    color: var(--text);
    font: inherit;
  }
  .reorder-link {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    justify-content: center;
    margin-bottom: 0.25rem;
    padding: 0.5rem 0.7rem;
    background: var(--surface-2);
    color: var(--text);
    font-weight: 600;
  }
  @media (hover: hover) {
    .reorder-link:hover {
      background: var(--border-strong);
    }
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 1rem;
  }
  .dialog button {
    padding: 0.5rem 1rem;
  }
  .dialog .secondary {
    background: var(--border-strong);
  }
  @media (max-width: 768px) {
    .search {
      max-width: none;
    }
  }
  input[type="text"] {
    flex: 1;
    padding: 0.5rem 0.7rem;
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: 0.5rem;
    color: var(--text);
  }
  button {
    padding: 0.5rem 0.9rem;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 0.5rem;
    cursor: pointer;
    font-weight: 600;
  }
  @media (hover: hover) {
    button:hover:not(:disabled) {
      background: var(--accent-hover);
    }
  }
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .back {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    background: transparent;
    border: none;
    color: var(--muted);
    cursor: pointer;
    padding: 0.25rem 0;
    margin-bottom: 1rem;
    font: inherit;
  }
  @media (hover: hover) {
    .back:hover {
      color: var(--text);
    }
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 1rem;
    margin-bottom: 1.5rem;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.75rem;
    background: var(--surface);
    border: 1px solid var(--surface-2);
    border-radius: 0.6rem;
    cursor: pointer;
    text-align: left;
  }
  @media (hover: hover) {
    .cards .card:hover {
      background: var(--hover);
    }
  }
  .cover {
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
  .card-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .card-name {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .card-sub {
    color: var(--muted);
    font-size: 0.8rem;
  }
  .actions-bar {
    margin-bottom: 1rem;
  }
  .head {
    display: flex;
    gap: 1.25rem;
    align-items: center;
    margin-bottom: 1.25rem;
  }
  .cover-lg {
    flex-shrink: 0;
    width: 120px;
    height: 120px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--surface-2);
    border-radius: 0.6rem;
    color: var(--dim);
    overflow: hidden;
  }
  .cover-lg img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .head-info {
    min-width: 0;
  }
  .head-info h3 {
    margin: 0 0 0.25rem;
    font-size: 1.5rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .head-info .muted {
    margin: 0 0 0.6rem;
    padding: 0;
  }
  .detail-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem;
  }
  .head-action {
    display: inline-flex;
    align-items: center;
    border: none;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    padding: 0.35rem 0.5rem;
    border-radius: 0.4rem;
  }
  @media (hover: hover) {
    .head-action:hover {
      background: var(--surface-2);
    }
  }
  @media (hover: hover) {
    .head-action.danger:hover {
      background: var(--danger-bg);
      color: var(--danger-text);
    }
  }
  .head-action.on {
    background: var(--active-bg);
    color: var(--accent-text);
  }
  .share-panel {
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: 0.75rem;
    padding: 1rem 1.1rem 1.1rem;
    margin-bottom: 1.25rem;
  }
  .sp-section {
    margin: 1.1rem 0 0.5rem;
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--dim);
  }
  .sp-section:first-child {
    margin-top: 0;
  }
  .sp-option {
    display: flex;
    align-items: flex-start;
    gap: 0.55rem;
    margin-top: 0.7rem;
    cursor: pointer;
  }
  .sp-option input {
    margin-top: 0.15rem;
  }
  .opt-title {
    display: block;
    color: var(--text);
    font-size: 0.88rem;
  }
  .opt-sub {
    display: block;
    color: var(--dim);
    font-size: 0.78rem;
  }
  .sp-error {
    color: var(--danger-text);
    font-size: 0.85rem;
    margin: 0.5rem 0 0;
  }
  .sp-empty {
    color: var(--muted);
    font-size: 0.85rem;
    margin: 0;
  }
  .people {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .people li {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.4rem 0;
  }
  .avatar {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 34px;
    height: 34px;
    border-radius: 50%;
    background: var(--accent);
    color: #fff;
    font-size: 0.9rem;
    font-weight: 600;
  }
  .who {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .who-name {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--text);
    font-size: 0.9rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .who-email {
    color: var(--dim);
    font-size: 0.78rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .role {
    flex-shrink: 0;
    padding: 0.05rem 0.4rem;
    background: var(--active-bg);
    color: var(--accent-text);
    border-radius: 0.3rem;
    font-size: 0.62rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .role.view {
    background: var(--surface-2);
    color: var(--dim);
  }
  .revoke {
    display: inline-flex;
    flex-shrink: 0;
    border: none;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    padding: 0.3rem;
    border-radius: 0.3rem;
  }
  @media (hover: hover) {
    .revoke:hover {
      background: var(--danger-bg);
      color: var(--danger-text);
    }
  }
  .public-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }
  .public-desc {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    min-width: 0;
    color: var(--muted);
    font-size: 0.82rem;
  }
  .public-desc :global(.material-symbols-rounded) {
    flex-shrink: 0;
    color: var(--accent-text);
  }
  .link-toggle {
    flex-shrink: 0;
    padding: 0.4rem 0.85rem;
    background: var(--surface-2);
    border: 1px solid var(--border-strong);
    border-radius: 2rem;
    color: var(--text);
    font: inherit;
    font-weight: 600;
    font-size: 0.8rem;
    cursor: pointer;
  }
  @media (hover: hover) {
    .link-toggle:hover {
      background: var(--hover);
    }
  }
  .link-toggle.on {
    background: var(--active-bg);
    border-color: var(--accent);
    color: var(--accent-text);
  }
  .public-url {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.6rem;
    padding: 0.45rem 0.6rem;
    background: var(--bg);
    border: 1px solid var(--border-strong);
    border-radius: 0.5rem;
  }
  .public-url .url {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: ui-monospace, monospace;
    font-size: 0.8rem;
    color: var(--accent-text);
  }
  .public-url .copy {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    flex-shrink: 0;
    padding: 0.3rem 0.6rem;
    background: var(--surface-2);
    border: 1px solid var(--border-strong);
    border-radius: 0.4rem;
    color: var(--text);
    font: inherit;
    font-size: 0.8rem;
    cursor: pointer;
  }
  @media (hover: hover) {
    .public-url .copy:hover {
      background: var(--hover);
    }
  }
  h3 {
    margin: 0 0 0.5rem;
    font-size: 1.1rem;
  }
  ol {
    list-style: none;
    counter-reset: track;
    padding: 0;
    margin: 0 0 1rem;
  }
  li {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    border-bottom: 1px solid var(--surface-2);
  }
  li.current {
    background: var(--active-bg);
  }
  .play-btn {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    background: transparent;
    color: inherit;
    font-weight: 500;
    padding: 0.6rem 0.5rem;
  }
  @media (hover: hover) {
    .play-btn:hover {
      background: var(--hover);
    }
  }
  .handle {
    display: inline-flex;
    align-items: center;
    color: var(--dim);
    cursor: grab;
    padding-left: 0.25rem;
  }
  .handle:active {
    cursor: grabbing;
  }
  .thumb {
    position: relative;
    width: 40px;
    height: 40px;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--surface-2);
    border-radius: 0.35rem;
    color: var(--dim);
    overflow: hidden;
  }
  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .thumb-play {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    background: rgba(0, 0, 0, 0.45);
    opacity: 0;
    transition: opacity 0.12s;
  }
  li.current:not(.playing) .thumb-play {
    opacity: 1;
  }

  @media (hover: hover) {
    .play-btn:hover .thumb-play {
      opacity: 1;
    }
  }
  .thumb-wave {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    background: rgba(0, 0, 0, 0.45);
    transition: opacity 0.12s;
  }
  @media (hover: hover) {
    .play-btn:hover .thumb-wave {
      opacity: 0;
    }
  }
  .name {
    flex: 1;
    min-width: 0;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .added-by {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    flex-shrink: 0;
    max-width: 9rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.76rem;
    font-weight: 400;
    color: var(--dim);
  }
  .plays {
    display: inline-flex;
    align-items: center;
    gap: 0.15rem;
    flex-shrink: 0;
    color: var(--muted);
    font-size: 0.78rem;
    font-variant-numeric: tabular-nums;
  }
  .to-lib {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    border: none;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    padding: 0.4rem 0.6rem;
    border-radius: 0.35rem;
  }
  @media (hover: hover) {
    .to-lib:hover:not(:disabled) {
      background: var(--surface-2);
      color: var(--accent-text);
    }
  }
  .to-lib.done {
    color: var(--accent-text);
    cursor: default;
  }
  .to-lib.loading :global(.material-symbols-rounded) {
    animation: spin 1.2s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .remove {
    display: inline-flex;
    align-items: center;
    border: none;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    padding: 0.4rem 0.6rem;
  }
  @media (hover: hover) {
    .remove:hover {
      background: var(--danger-bg);
      color: var(--danger-text);
    }
  }
  .add-block {
    margin-top: 1rem;
  }
  .add-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.45rem 0.9rem;
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--border-strong);
    border-radius: 2rem;
    font: inherit;
    font-weight: 600;
    font-size: 0.85rem;
    cursor: pointer;
  }
  @media (hover: hover) {
    .add-toggle:hover {
      background: var(--hover);
    }
  }
  .add-search {
    width: 100%;
    box-sizing: border-box;
    margin-top: 0.6rem;
    padding: 0.5rem 1.1rem;
    background: var(--bg);
    border: 1px solid var(--border-strong);
    border-radius: 2rem;
    color: var(--text);
    font: inherit;
  }
  .add-search:focus {
    outline: none;
    border-color: var(--accent);
  }
  .add-results {
    list-style: none;
    margin: 0.4rem 0 0;
    padding: 0;
    max-height: 320px;
    overflow-y: auto;
  }
  .add-results li {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.25rem;
    border-bottom: 1px solid var(--surface-2);
  }
  .ar-meta {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .ar-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ar-artist {
    font-size: 0.78rem;
    color: var(--dim);
  }
  .ar-add {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    padding: 0.35rem;
    background: transparent;
    border: none;
    color: var(--accent-text);
    border-radius: 0.35rem;
    cursor: pointer;
  }
  @media (hover: hover) {
    .ar-add:hover {
      background: var(--active-bg);
      color: var(--accent);
    }
  }
  .muted {
    color: var(--muted);
    padding: 0.5rem 0;
  }
  .muted.small {
    font-size: 0.85rem;
  }
  .error {
    background: var(--danger-bg);
    color: var(--danger-text);
    padding: 0.5rem 0.75rem;
    border-radius: 0.5rem;
  }
</style>
