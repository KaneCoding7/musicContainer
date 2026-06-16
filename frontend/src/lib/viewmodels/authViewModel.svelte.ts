// ViewModel: authentication state and actions.
import {
  changePassword,
  fetchSession,
  signIn,
  signOut,
  signUp,
  updateName,
  type User,
} from "$lib/services/authService";

export class AuthViewModel {
  user = $state<User | null>(null);
  loading = $state(true); // initial session check
  busy = $state(false); // a sign-in/up request in flight
  error = $state<string | null>(null);

  get isAuthed(): boolean {
    return this.user !== null;
  }

  // Resolves the current session from a stored token (on app load).
  async init(): Promise<void> {
    this.loading = true;
    this.user = await fetchSession();
    this.loading = false;
  }

  async login(email: string, password: string): Promise<boolean> {
    this.busy = true;
    this.error = null;
    try {
      this.user = await signIn(email, password);
      return true;
    } catch (e) {
      this.error = e instanceof Error ? e.message : "Sign in failed";
      return false;
    } finally {
      this.busy = false;
    }
  }

  async register(
    email: string,
    password: string,
    name: string,
    invite?: string
  ): Promise<boolean> {
    this.busy = true;
    this.error = null;
    try {
      this.user = await signUp(email, password, name, invite);
      return true;
    } catch (e) {
      this.error = e instanceof Error ? e.message : "Sign up failed";
      return false;
    } finally {
      this.busy = false;
    }
  }

  async logout(): Promise<void> {
    await signOut();
    this.user = null;
  }

  // Updates the display name; returns an error message or null on success.
  async changeName(name: string): Promise<string | null> {
    const trimmed = name.trim();
    if (!trimmed) return "Name cannot be empty";
    try {
      await updateName(trimmed);
      if (this.user) this.user = { ...this.user, name: trimmed };
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "Failed to update name";
    }
  }

  // Changes the password; returns an error message or null on success.
  async changePassword(
    currentPassword: string,
    newPassword: string
  ): Promise<string | null> {
    try {
      await changePassword(currentPassword, newPassword);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "Failed to change password";
    }
  }
}
