// Per-song album-art version. Bump it when a song's art changes so every <img>
// whose URL includes it re-fetches immediately — no page refresh needed.
const versions = $state<Record<number, number>>({});

export function artVersion(id: number): number {
  return versions[id] ?? 0;
}

export function bumpArtVersion(id: number): void {
  versions[id] = (versions[id] ?? 0) + 1;
}
