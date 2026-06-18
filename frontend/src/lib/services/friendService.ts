// Service layer: friends (mutual request -> accept).
import { apiBase } from "$lib/services/apiBase";
import { authHeaders } from "$lib/services/authService";

// An accepted friend.
export interface Friend {
  id: string;
  name: string;
  email: string;
  since: string;
}

// A pending request (the other user, incoming or outgoing).
export interface FriendRequest {
  id: string;
  name: string;
  email: string;
  requestedAt: string;
}

export interface FriendData {
  friends: Friend[];
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return body?.error?.message || body?.message || `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

// Loads my friends plus incoming and outgoing pending requests in one call.
export async function fetchFriendData(): Promise<FriendData> {
  const res = await fetch(`${apiBase()}/api/friends`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()) as FriendData;
}

// Sends a friend request to an email. Returns the resulting status — "accepted"
// when the recipient had already requested you.
export async function sendFriendRequest(
  email: string
): Promise<{ status: "pending" | "accepted" }> {
  const res = await fetch(`${apiBase()}/api/friends`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()) as { status: "pending" | "accepted" };
}

// Accepts an incoming request from the given user.
export async function acceptFriend(userId: string): Promise<Friend> {
  const res = await fetch(
    `${apiBase()}/api/friends/${encodeURIComponent(userId)}/accept`,
    { method: "POST", headers: authHeaders() }
  );
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()).friend as Friend;
}

// Removes a friend, or cancels/declines a pending request with that user.
export async function removeFriend(userId: string): Promise<void> {
  const res = await fetch(
    `${apiBase()}/api/friends/${encodeURIComponent(userId)}`,
    { method: "DELETE", headers: authHeaders() }
  );
  if (!res.ok) throw new Error(await errorMessage(res));
}
