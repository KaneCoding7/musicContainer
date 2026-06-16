// ViewModel: authentication state and actions.
import {
  fetchSession,
  signIn,
  signOut,
  signUp,
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
    name: string
  ): Promise<boolean> {
    this.busy = true;
    this.error = null;
    try {
      this.user = await signUp(email, password, name);
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
}
