import { goto } from "$app/navigation";

// Open an artist's profile view. The open artist is driven by the URL
// (?view=artists&artist=…) so it's deep-linkable and the browser back button
// returns to wherever you came from — see ArtistsView/HomeView, which navigate
// the same way. Centralised here so every clickable artist name stays in sync.
export function openArtist(name: string) {
  return goto(`?view=artists&artist=${encodeURIComponent(name)}`, {
    noScroll: true,
  });
}
