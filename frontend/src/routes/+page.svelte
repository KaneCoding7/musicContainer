<script lang="ts">
  import { onMount } from "svelte";
  import { fade, slide } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import AlbumsView from "$lib/components/AlbumsView.svelte";
  import ArtistsView from "$lib/components/ArtistsView.svelte";
  import AuthScreen from "$lib/components/AuthScreen.svelte";
  import FriendsView from "$lib/components/FriendsView.svelte";
  import HomeView from "$lib/components/HomeView.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import InviteView from "$lib/components/InviteView.svelte";
  import LikedView from "$lib/components/LikedView.svelte";
  import Player from "$lib/components/Player.svelte";
  import PlaylistManager from "$lib/components/PlaylistManager.svelte";
  import QueueView from "$lib/components/QueueView.svelte";
  import RecentlyPlayedView from "$lib/components/RecentlyPlayedView.svelte";
  import SettingsView from "$lib/components/SettingsView.svelte";
  import SharedView from "$lib/components/SharedView.svelte";
  import SongList from "$lib/components/SongList.svelte";
  import UploadView from "$lib/components/UploadView.svelte";
  import type { SongMetadata } from "$lib/services/songService";
  import DeviceBar from "$lib/components/DeviceBar.svelte";
  import { AuthViewModel } from "$lib/viewmodels/authViewModel.svelte";
  import { FriendsViewModel } from "$lib/viewmodels/friendsViewModel.svelte";
  import { PlaylistViewModel } from "$lib/viewmodels/playlistViewModel.svelte";
  import { SongViewModel } from "$lib/viewmodels/songViewModel.svelte";
  import { SyncController } from "$lib/viewmodels/syncController.svelte";

  const authVm = new AuthViewModel();
  const vm = new SongViewModel();
  const playlistVm = new PlaylistViewModel();
  const friendsVm = new FriendsViewModel();
  const sync = new SyncController(vm);

  // Load the signed-in user's library.
  function loadLibrary() {
    vm.load();
    vm.loadStaged(); // resurface any uploads still awaiting review
    playlistVm.load();
    friendsVm.load(); // friends + pending requests (drives the nav badge)
  }

  async function handleLogout() {
    await authVm.logout();
    location.reload();
  }

  type View =
    | "home"
    | "songs"
    | "upload"
    | "liked"
    | "playlists"
    | "shared"
    | "albums"
    | "artists"
    | "recent"
    | "invite"
    | "friends"
    | "settings";
  // The active view is driven by the URL (?view=…) so the browser back/forward
  // buttons navigate between sections.
  function toView(v: string | null): View {
    switch (v) {
      case "songs":
      case "upload":
      case "liked":
      case "playlists":
      case "shared":
      case "albums":
      case "artists":
      case "recent":
      case "invite":
      case "friends":
      case "settings":
        return v;
      default:
        return "home";
    }
  }
  const view = $derived(toView(page.url.searchParams.get("view")));
  // True on the artist *detail* page (an artist is open). Used to drop the
  // redundant "Artists" heading on mobile, where the top bar already shows it.
  const artistOpen = $derived(
    view === "artists" && !!page.url.searchParams.get("artist"),
  );

  // The content area is its own scroll container and navigation uses noScroll,
  // so opening an artist would otherwise inherit the grid's scroll position and
  // land you part-way down the track list. Reset it to the top when a detail
  // opens.
  let contentEl = $state<HTMLElement | null>(null);
  $effect(() => {
    if (artistOpen) contentEl?.scrollTo(0, 0);
  });

  let queueOpen = $state(false);
  let sidebarOpen = $state(false); // mobile nav drawer
  let theme = $state<"dark" | "light">("dark");

  // Navigate by pushing a URL so back/forward works; close the mobile drawer.
  function goTo(v: View) {
    sidebarOpen = false;
    goto(v === "home" ? "/" : `?view=${v}`, { keepFocus: true, noScroll: true });
  }

  function toggleTheme() {
    theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
  }

  function toggleNormalize() {
    vm.normalize = !vm.normalize;
    localStorage.setItem("normalize", String(vm.normalize));
  }

  function toggleClips() {
    vm.showClips = !vm.showClips;
    localStorage.setItem("showClips", String(vm.showClips));
  }

  const nav: { id: View; label: string; icon: string }[] = [
    { id: "home", label: "Home", icon: "home" },
    { id: "songs", label: "All Songs", icon: "library_music" },
    { id: "liked", label: "Liked", icon: "favorite" },
    { id: "playlists", label: "Playlists", icon: "queue_music" },
    { id: "shared", label: "Shared with me", icon: "folder_shared" },
    { id: "albums", label: "Albums", icon: "album" },
    { id: "artists", label: "Artists", icon: "artist" },
    { id: "recent", label: "Recently Played", icon: "history" },
    { id: "friends", label: "Friends", icon: "group" },
    { id: "invite", label: "Invite", icon: "person_add" },
    { id: "upload", label: "Upload", icon: "upload" },
    { id: "settings", label: "Settings", icon: "settings" },
  ];

  // Becomes true once we've attempted to restore the saved player state, so the
  // persistence effect below doesn't overwrite the snapshot before we read it.
  let restoreReady = $state(false);
  // Becomes true once the cross-device (server) snapshot has been reconciled, so
  // we don't push a local state up and clobber a newer one from another device.
  let remoteReady = $state(false);

  onMount(async () => {
    const saved = localStorage.getItem("theme");
    theme = saved === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
    vm.normalize = localStorage.getItem("normalize") !== "false"; // default on
    vm.showClips = localStorage.getItem("showClips") !== "false"; // default on
    await authVm.init();
    if (authVm.isAuthed) {
      loadLibrary();
      vm.restore(); // instant same-device resume
      sync.connect(); // cross-device live sync
    }
    restoreReady = true;
    // Cross-device resume: apply the server snapshot when it's newer than local.
    if (authVm.isAuthed) await vm.restoreRemote();
    remoteReady = true;
  });

  // Active device: broadcast playback state whenever the discrete state changes.
  $effect(() => {
    // Track the discrete playback fields (position is pushed on a timer below).
    void [vm.currentIndex, vm.isPlaying, vm.queue, vm.shuffle, vm.repeat, vm.duration];
    if (restoreReady && sync.isActive) sync.sendState();
  });

  // Push position periodically while active, and on remotes advance the
  // displayed position between the active device's updates.
  $effect(() => {
    const id = setInterval(() => {
      if (sync.isActive) {
        if (vm.isPlaying) {
          sync.sendState();
          if (remoteReady) vm.persistRemote(); // throttled ~5s: save position
        }
      } else if (vm.isPlaying) {
        vm.position = Math.min(vm.position + 1, vm.duration || vm.position + 1);
      }
    }, 1000);
    return () => clearInterval(id);
  });

  // Persist a now-playing snapshot whenever the discrete player state changes
  // (track/queue/play-pause/shuffle/repeat). Position is saved on the timer
  // above and on page hide below.
  $effect(() => {
    if (!restoreReady) return;
    vm.persist();
    if (remoteReady) vm.persistRemote();
  });

  // Capture the exact playback position when the page is refreshed, closed, or
  // backgrounded (covers mobile PWA tab switches).
  $effect(() => {
    const persistNow = () => {
      vm.persist();
      if (remoteReady) vm.persistRemote({ force: true, keepalive: true });
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") persistNow();
    };
    window.addEventListener("pagehide", persistNow);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", persistNow);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  });

  // Closes the queue panel when clicking anywhere outside it. Clicks on the
  // player bar are ignored so the queue toggle (and other transport controls)
  // keep working — the toggle closes the queue via its own handler.
  function closeOnOutside(node: HTMLElement) {
    const handler = (e: Event) => {
      const t = e.target as HTMLElement;
      if (node.contains(t) || t.closest(".player")) return;
      queueOpen = false;
    };
    document.addEventListener("pointerdown", handler, true);
    return {
      destroy() {
        document.removeEventListener("pointerdown", handler, true);
      },
    };
  }

  // Delete a song, then refresh the open playlist (its membership may change).
  async function handleDelete(id: number) {
    await vm.remove(id);
    if (playlistVm.selectedId !== null) {
      await playlistVm.select(playlistVm.selectedId);
    }
  }

  // Edit a song's metadata, then refresh the open playlist so it updates there.
  async function handleUpdate(id: number, fields: SongMetadata) {
    await vm.updateMeta(id, fields);
    if (playlistVm.selectedId !== null) {
      await playlistVm.select(playlistVm.selectedId);
    }
  }

  // Edit metadata across many selected songs; refresh the open playlist too.
  async function handleBulkUpdate(ids: number[], fields: SongMetadata) {
    const n = await vm.updateMetaBulk(ids, fields);
    if (playlistVm.selectedId !== null) {
      await playlistVm.select(playlistVm.selectedId);
    }
    return n;
  }

  // Global keyboard shortcuts (ignored while typing in a field).
  function handleKeydown(e: KeyboardEvent) {
    if (!authVm.isAuthed) return;
    const target = e.target as HTMLElement;
    const typing =
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT" ||
      target.isContentEditable;

    if (e.key === "/" && !typing) {
      e.preventDefault();
      goTo("songs");
      requestAnimationFrame(() => document.getElementById("song-search")?.focus());
      return;
    }
    if (typing) return;

    switch (e.key) {
      case " ":
        e.preventDefault();
        vm.togglePlay();
        break;
      case "ArrowRight":
        vm.next();
        break;
      case "ArrowLeft":
        vm.prev();
        break;
      case "ArrowUp":
        e.preventDefault();
        vm.adjustVolume(0.05);
        break;
      case "ArrowDown":
        e.preventDefault();
        vm.adjustVolume(-0.05);
        break;
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if authVm.loading}
  <div class="boot">Loading…</div>
{:else if !authVm.isAuthed}
  <AuthScreen vm={authVm} onAuthed={loadLibrary} />
{:else}
  <div class="layout">
    <header class="topbar">
      <button
        class="hamburger"
        onclick={() => (sidebarOpen = true)}
        aria-label="Open menu"
      >
        <Icon name="menu" size={24} />
      </button>
      <span class="topbar-title">{nav.find((n) => n.id === view)?.label ?? ""}</span>
    </header>

    <div class="body">
      {#if sidebarOpen}
        <button
          class="scrim"
          aria-label="Close menu"
          onclick={() => (sidebarOpen = false)}
          transition:fade={{ duration: 200 }}
        ></button>
      {/if}
      <aside class="sidebar" class:open={sidebarOpen}>
      <div class="brand">
        <Icon name="library_music" fill size={26} /> Music Server
        <button
          class="drawer-close"
          onclick={() => (sidebarOpen = false)}
          aria-label="Close menu"
        >
          <Icon name="close" size={22} />
        </button>
      </div>

      <nav>
        {#each nav as item (item.id)}
          <button
            class="nav-item"
            class:active={view === item.id}
            onclick={() => goTo(item.id)}
          >
            <Icon name={item.icon} size={22} />
            {item.label}
            {#if item.id === "friends" && friendsVm.pendingCount > 0}
              <span class="nav-badge">{friendsVm.pendingCount}</span>
            {/if}
          </button>
        {/each}
      </nav>

      <div class="sidebar-foot">
        <details class="shortcuts">
          <summary>
            <Icon name="keyboard" size={18} />
            <span class="sc-label">Shortcuts</span>
            <span class="chev"><Icon name="expand_more" size={18} /></span>
          </summary>
          <dl>
            <div><dt><kbd>Space</kbd></dt><dd>Play / pause</dd></div>
            <div><dt><kbd>←</kbd> <kbd>→</kbd></dt><dd>Previous / next</dd></div>
            <div><dt><kbd>↑</kbd> <kbd>↓</kbd></dt><dd>Volume</dd></div>
            <div><dt><kbd>/</kbd></dt><dd>Search</dd></div>
          </dl>
        </details>
      </div>
    </aside>

    <main class="content" bind:this={contentEl}>
      {#if vm.error}
        <p class="error">{vm.error}</p>
      {/if}

      {#if view === "home"}
        <h2>Home</h2>
        <HomeView {vm} />
      {:else if view === "songs"}
        <h2>All Songs</h2>
        <SongList
          {vm}
          onDelete={handleDelete}
          onUpdate={handleUpdate}
          playlists={playlistVm.playlists}
          onBulkAdd={(id, songIds) => playlistVm.addSongs(id, songIds)}
          onBulkEdit={handleBulkUpdate}
        />
      {:else if view === "upload"}
        <h2>Upload</h2>
        <UploadView {vm} />
      {:else if view === "liked"}
        <h2>Liked</h2>
        <LikedView {vm} />
      {:else if view === "playlists"}
        <h2>Playlists</h2>
        <PlaylistManager vm={playlistVm} songVm={vm} />
      {:else if view === "shared"}
        <h2>Shared with me</h2>
        <SharedView songVm={vm} onCopied={() => playlistVm.load()} />
      {:else if view === "albums"}
        <h2>Albums</h2>
        <AlbumsView {vm} />
      {:else if view === "artists"}
        <h2 class:detail-hidden={artistOpen}>Artists</h2>
        <ArtistsView {vm} />
      {:else if view === "recent"}
        <h2>Recently Played</h2>
        <RecentlyPlayedView {vm} />
      {:else if view === "friends"}
        <h2>Friends</h2>
        <FriendsView vm={friendsVm} />
      {:else if view === "invite"}
        <h2>Invite a friend</h2>
        <InviteView />
      {:else}
        <h2>Settings</h2>
        <SettingsView
          vm={authVm}
          songVm={vm}
          {theme}
          onToggleTheme={toggleTheme}
          onToggleNormalize={toggleNormalize}
          onToggleClips={toggleClips}
          onSignOut={handleLogout}
        />
      {/if}
    </main>
  </div>

  {#if queueOpen}
    <section
      class="queue-panel"
      use:closeOnOutside
      transition:slide={{ duration: 260, easing: cubicOut }}
    >
      <div class="queue-head">
        <h3>Queue</h3>
        <button
          class="collapse"
          onclick={() => (queueOpen = false)}
          aria-label="Collapse queue"
        >
          <Icon name="keyboard_arrow_down" size={22} />
        </button>
      </div>
      {#if vm.queue.length === 0}
        <p class="muted">Nothing queued yet.</p>
      {:else}
        <QueueView {vm} />
      {/if}
    </section>
  {/if}

  {#if sync.isRemote}
    <DeviceBar {sync} />
  {/if}

  <Player {vm} {queueOpen} active={sync.isActive} onToggleQueue={() => (queueOpen = !queueOpen)} />
  </div>
{/if}

<style>
  .layout {
    display: flex;
    flex-direction: column;
    height: 100vh; /* fallback for browsers without dvh */
    height: 100dvh; /* dynamic viewport: excludes Safari's bottom toolbar */
  }
  .body {
    display: flex;
    flex: 1;
    min-height: 0;
  }
  .sidebar {
    width: 230px;
    flex-shrink: 0;
    background: var(--sidebar);
    border-right: 1px solid var(--surface-2);
    padding: 1.25rem 1rem 0.45rem;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 1.15rem;
    font-weight: 700;
    color: var(--accent-text);
  }
  nav {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .nav-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.6rem 0.75rem;
    background: transparent;
    border: none;
    border-radius: 0.5rem;
    color: var(--text);
    font: inherit;
    font-weight: 500;
    text-align: left;
    cursor: pointer;
  }
  @media (hover: hover) {
    .nav-item:hover {
      background: var(--hover);
      color: var(--text);
    }
  }
  .nav-item.active {
    background: var(--active-bg);
    color: var(--text);
  }
  .nav-badge {
    margin-left: auto;
    flex-shrink: 0;
    min-width: 1.25rem;
    padding: 0 0.35rem;
    height: 1.25rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--accent);
    color: #fff;
    border-radius: 1rem;
    font-size: 0.72rem;
    font-weight: 700;
  }
  .boot {
    height: 100vh;
    height: 100dvh;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--muted);
  }
  .sidebar-foot {
    margin-top: auto;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .shortcuts {
    font-size: 0.78rem;
    color: var(--muted);
  }
  .shortcuts summary {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.4rem 0.5rem;
    border-radius: 0.4rem;
    cursor: pointer;
    list-style: none;
    color: var(--muted);
    user-select: none;
  }
  .shortcuts summary::-webkit-details-marker {
    display: none;
  }
  @media (hover: hover) {
    .shortcuts summary:hover {
      background: var(--hover);
      color: var(--text);
    }
  }
  .sc-label {
    flex: 1;
  }
  .chev {
    display: inline-flex;
    transition: transform 0.15s ease;
  }
  .shortcuts[open] .chev {
    transform: rotate(180deg);
  }
  .shortcuts dl {
    margin: 0.25rem 0 0;
    padding: 0 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .shortcuts dl div {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .shortcuts dt {
    display: flex;
    gap: 0.2rem;
  }
  .shortcuts dd {
    margin: 0;
    color: var(--dim);
  }
  .shortcuts kbd {
    background: var(--surface-2);
    border: 1px solid var(--border-strong);
    border-radius: 0.25rem;
    padding: 0.02rem 0.32rem;
    font-family: inherit;
    font-size: 0.7rem;
    color: var(--text);
  }
  .content {
    flex: 1;
    overflow-y: auto;
    padding: 1.5rem 2rem 2rem;
  }
  .content h2 {
    margin: 0 0 1rem;
    font-size: 1.4rem;
  }
  .error {
    background: var(--danger-bg);
    color: var(--danger-text);
    padding: 0.75rem 1rem;
    border-radius: 0.5rem;
    margin: 0 0 1rem;
  }
  .queue-panel {
    border-top: 1px solid var(--surface-2);
    background: var(--panel);
    max-height: 38vh;
    overflow-y: auto;
    /* No top padding: it would let scrolled list items bleed into the strip
       above the sticky header. The header supplies the top spacing instead. */
    padding: 0 1rem 1rem;
  }
  .queue-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--panel);
    padding: 0.6rem 0 0.5rem;
  }
  .queue-head h3 {
    margin: 0;
    font-size: 0.95rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
  }
  .collapse {
    display: inline-flex;
    background: transparent;
    border: none;
    color: var(--muted);
    cursor: pointer;
  }
  @media (hover: hover) {
    .collapse:hover {
      color: #fff;
    }
  }
  .muted {
    color: var(--muted);
    padding: 0.5rem 0;
  }

  /* Mobile top bar + drawer affordances — hidden on desktop. */
  .topbar {
    display: none;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
    padding: 0.5rem 0.75rem;
    background: var(--sidebar);
    border-bottom: 1px solid var(--surface-2);
  }
  .hamburger,
  .drawer-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    color: var(--text);
    cursor: pointer;
    padding: 0.4rem;
    border-radius: 0.5rem;
  }
  @media (hover: hover) {
    .hamburger:hover,
    .drawer-close:hover {
      background: var(--hover);
    }
  }
  .topbar-title {
    font-weight: 600;
    font-size: 1.05rem;
  }
  .drawer-close {
    display: none;
    margin-left: auto;
  }
  .scrim {
    display: none;
    position: fixed;
    inset: 0;
    z-index: 40;
    background: rgba(0, 0, 0, 0.5);
    border: none;
    padding: 0;
  }

  @media (max-width: 768px) {
    .topbar {
      display: flex;
    }
    /* The topbar already shows the section name, so drop the redundant in-view
       title on mobile. */
    .content > h2 {
      display: none;
    }
    /* Never scroll the page sideways on mobile. */
    .content {
      overflow-x: hidden;
    }
    .scrim {
      display: block;
    }
    .drawer-close {
      display: inline-flex;
    }
    .sidebar {
      position: fixed;
      top: 0;
      bottom: 0;
      left: 0;
      z-index: 50;
      width: min(80vw, 280px);
      transform: translateX(-100%);
      transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
      will-change: transform;
      box-shadow: 0 0 32px rgba(0, 0, 0, 0.4);
    }
    .sidebar.open {
      transform: translateX(0);
    }
    .content {
      padding: 1rem 1rem 1.5rem;
    }
    .content h2 {
      font-size: 1.2rem;
    }
    /* On the artist detail page the top bar already says "Artists", so the
       section heading is a redundant second copy — drop it on mobile. */
    .content h2.detail-hidden {
      display: none;
    }
    .queue-panel {
      max-height: 45vh;
    }
  }
</style>
