// ViewModel: owns the friends list and pending requests.
import * as api from "$lib/services/friendService";
import type { Friend, FriendRequest } from "$lib/services/friendService";

export class FriendsViewModel {
  friends = $state<Friend[]>([]);
  incoming = $state<FriendRequest[]>([]);
  outgoing = $state<FriendRequest[]>([]);
  loading = $state(false);
  error = $state<string | null>(null);

  // Incoming requests awaiting my response — drives the nav badge.
  get pendingCount(): number {
    return this.incoming.length;
  }

  // Loads friends + incoming/outgoing requests.
  async load(): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      const data = await api.fetchFriendData();
      this.friends = data.friends;
      this.incoming = data.incoming;
      this.outgoing = data.outgoing;
    } catch (e) {
      this.error = e instanceof Error ? e.message : "Failed to load friends";
    } finally {
      this.loading = false;
    }
  }

  // Sends a request by email. Reloads so the new state (pending, or an
  // immediate friendship when they'd already requested you) is reflected
  // everywhere. Returns true on success.
  async add(email: string): Promise<boolean> {
    this.error = null;
    try {
      await api.sendFriendRequest(email);
      await this.load();
      return true;
    } catch (e) {
      this.error = e instanceof Error ? e.message : "Failed to send request";
      return false;
    }
  }

  // Accepts an incoming request: move the requester into the friends list.
  async accept(userId: string): Promise<void> {
    this.error = null;
    try {
      const friend = await api.acceptFriend(userId);
      this.incoming = this.incoming.filter((r) => r.id !== userId);
      this.friends = [...this.friends, friend].sort((a, b) =>
        a.name.localeCompare(b.name)
      );
    } catch (e) {
      this.error = e instanceof Error ? e.message : "Failed to accept request";
    }
  }

  // Removes a friend, or cancels/declines a pending request with that user.
  async remove(userId: string): Promise<void> {
    this.error = null;
    try {
      await api.removeFriend(userId);
      this.friends = this.friends.filter((f) => f.id !== userId);
      this.incoming = this.incoming.filter((r) => r.id !== userId);
      this.outgoing = this.outgoing.filter((r) => r.id !== userId);
    } catch (e) {
      this.error = e instanceof Error ? e.message : "Failed to remove";
    }
  }
}
