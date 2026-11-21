export const GOOGLE_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
].join(' ');

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
  scope?: string;
}

interface TokenClient {
  requestAccessToken: (overrideConfig?: { prompt?: string }) => void;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: TokenResponse) => void;
            error_callback?: (err: { type: string; message?: string }) => void;
          }) => TokenClient;
          revoke: (token: string, done?: () => void) => void;
        };
      };
    };
  }
}

// Access token kept strictly in memory (never localStorage/sessionStorage).
let cachedAccessToken: string | null = null;
let tokenExpiresAt = 0;

export const DEFAULT_GOOGLE_CLIENT_ID =
  '934704963727-oimeeoieqdrd3f1s7hca579l5si50jsk.apps.googleusercontent.com';

export function sanitizeClientId(raw: string | undefined | null): string {
  if (!raw) return '';
  return raw.trim().replace(/^["']+|["']+$/g, '').trim();
}

export function getEffectiveClientId(): {
  clientId: string;
  source: 'env' | 'default';
} {
  const envClientId = sanitizeClientId(
    import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
  );

  if (envClientId) {
    return { clientId: envClientId, source: 'env' };
  }
  return { clientId: DEFAULT_GOOGLE_CLIENT_ID, source: 'default' };
}

export function getInMemoryAccessToken(): string | null {
  if (!cachedAccessToken) return null;
  if (Date.now() >= tokenExpiresAt - 30_000) {
    return null;
  }
  return cachedAccessToken;
}

export function clearInMemoryAccessToken(): void {
  const token = cachedAccessToken;
  cachedAccessToken = null;
  tokenExpiresAt = 0;
  if (token && window.google?.accounts?.oauth2?.revoke) {
    try {
      window.google.accounts.oauth2.revoke(token);
    } catch {
      // Ignore revoke errors
    }
  }
}

export function isGisLoaded(): boolean {
  return Boolean(window.google?.accounts?.oauth2?.initTokenClient);
}

export async function waitForGisLoaded(timeoutMs = 6000): Promise<boolean> {
  if (isGisLoaded()) return true;
  const start = Date.now();
  return new Promise((resolve) => {
    const interval = window.setInterval(() => {
      if (isGisLoaded()) {
        window.clearInterval(interval);
        resolve(true);
      } else if (Date.now() - start >= timeoutMs) {
        window.clearInterval(interval);
        resolve(false);
      }
    }, 120);
  });
}

function formatGisError(err: { type?: string; message?: string }): string {
  if (err.type === 'popup_failed_to_open') {
    return 'Google Sign-In popup was blocked by your browser. Please allow popups for this site (or open the app in a full browser tab) and click Connect again.';
  }
  if (err.type === 'popup_closed') {
    return 'Google Sign-In popup was closed before completing authorization.';
  }
  return err.message || `OAuth popup error (${err.type || 'unknown'})`;
}

function invokeGisTokenPopup(
  effectiveClientId: string,
  prompt: '' | 'consent' | 'select_account',
  timeoutMs?: number
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const timer =
      timeoutMs && timeoutMs > 0
        ? window.setTimeout(() => {
            if (!settled) {
              settled = true;
              reject(new Error('Google OAuth authorization timed out.'));
            }
          }, timeoutMs)
        : null;

    const finishResolve = (token: string) => {
      if (settled) return;
      settled = true;
      if (timer !== null) window.clearTimeout(timer);
      resolve(token);
    };

    const finishReject = (err: Error) => {
      if (settled) return;
      settled = true;
      if (timer !== null) window.clearTimeout(timer);
      reject(err);
    };

    try {
      const tokenClient = window.google!.accounts!.oauth2!.initTokenClient({
        client_id: effectiveClientId,
        scope: GOOGLE_OAUTH_SCOPES,
        callback: (response: TokenResponse) => {
          if (response.error) {
            finishReject(new Error(response.error_description || response.error));
            return;
          }
          if (!response.access_token) {
            finishReject(new Error('Google did not return an OAuth access token.'));
            return;
          }
          const expiresInSec = response.expires_in ?? 3599;
          cachedAccessToken = response.access_token;
          tokenExpiresAt = Date.now() + expiresInSec * 1000;
          finishResolve(response.access_token);
        },
        error_callback: (err) => {
          finishReject(new Error(formatGisError(err)));
        },
      });

      tokenClient.requestAccessToken({ prompt });
    } catch (err) {
      finishReject(
        err instanceof Error
          ? err
          : new Error('Failed to start Google OAuth sign-in popup.')
      );
    }
  });
}

/**
 * Requests a Google OAuth access token via GIS Token Client.
 * IMPORTANT: Executes `tokenClient.requestAccessToken` synchronously when GIS is
 * already loaded so browser popup blockers preserve the user's click activation.
 */
export function requestGoogleAccessToken(options?: {
  clientId?: string;
  prompt?: '' | 'consent' | 'select_account';
  timeoutMs?: number;
}): Promise<string> {
  const effective =
    sanitizeClientId(options?.clientId) || getEffectiveClientId().clientId;
  if (!effective) {
    return Promise.reject(
      new Error(
        'Google OAuth Client ID is required. Paste your Web OAuth Client ID in Settings or set VITE_GOOGLE_CLIENT_ID.'
      )
    );
  }
  if (!effective.endsWith('.apps.googleusercontent.com')) {
    return Promise.reject(
      new Error(
        `Invalid OAuth Client ID format ("${effective}"). It must be a Web Client ID ending with .apps.googleusercontent.com.`
      )
    );
  }

  const prompt = options?.prompt ?? 'consent';

  // Fast synchronous path: keeps popup strictly inside the user's click call stack.
  if (isGisLoaded()) {
    return invokeGisTokenPopup(effective, prompt, options?.timeoutMs);
  }

  // Fallback if GIS script is still loading on initial page boot.
  return waitForGisLoaded().then((loaded) => {
    if (!loaded || !window.google?.accounts?.oauth2) {
      throw new Error(
        'Google Identity Services script failed to load. Check network access to accounts.google.com.'
      );
    }
    return invokeGisTokenPopup(effective, prompt, options?.timeoutMs);
  });
}

/**
 * GIS Token Client always opens a popup window (even with prompt=''), so background
 * silent refresh cannot invoke requestAccessToken without triggering browser popup
 * blockers. Return only a valid in-memory token here.
 */
export async function trySilentRefreshAccessToken(): Promise<string | null> {
  return getInMemoryAccessToken();
}
