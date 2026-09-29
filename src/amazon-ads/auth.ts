import { env } from "../config/env.js";

/**
 * Login with Amazon (LWA) OAuth2 helpers.
 *
 * One-time setup flow (see scripts/get-auth-url.ts and scripts/exchange-code.ts):
 *   1. getAuthorizationUrl() -> open it in a browser, log in as the Amazon Ads
 *      user who has access to the Aravi ad account, approve access.
 *   2. Amazon redirects to AMAZON_ADS_REDIRECT_URI with ?code=... in the URL.
 *   3. exchangeCodeForTokens(code) -> returns a refresh_token. Save that in .env
 *      as AMAZON_ADS_REFRESH_TOKEN. It does not expire under normal use.
 *
 * Day-to-day, every API call needs a fresh *access* token (~1hr lifetime),
 * minted from the refresh token via getAccessToken() below.
 */

const SCOPE = "advertising::campaign_management";

export function getAuthorizationUrl(): string {
  const params = new URLSearchParams({
    client_id: env.clientId,
    scope: SCOPE,
    response_type: "code",
    redirect_uri: env.redirectUri,
  });
  // Note: the consent screen itself is always at www.amazon.com/ap/oa,
  // regardless of which regional Ads API host the account's data lives on.
  return `https://www.amazon.com/ap/oa?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
}

export async function exchangeCodeForTokens(authorizationCode: string): Promise<TokenResponse> {
  return postToken({
    grant_type: "authorization_code",
    code: authorizationCode,
    redirect_uri: env.redirectUri,
    client_id: env.clientId,
    client_secret: env.clientSecret,
  });
}

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

/** Returns a valid access token, refreshing it only when the cached one is close to expiry. */
export async function getAccessToken(): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedAccessToken.token;
  }
  if (!env.refreshToken) {
    throw new Error(
      "No AMAZON_ADS_REFRESH_TOKEN in .env yet. Run `npm run auth:url`, approve access, " +
        "then `npm run auth:exchange -- <code>` to get one."
    );
  }
  const result = await postToken({
    grant_type: "refresh_token",
    refresh_token: env.refreshToken,
    client_id: env.clientId,
    client_secret: env.clientSecret,
  });
  cachedAccessToken = {
    token: result.access_token,
    expiresAt: Date.now() + result.expires_in * 1000,
  };
  return cachedAccessToken.token;
}

async function postToken(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(env.authTokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) {
    throw new Error(`LWA token request failed (${res.status}): ${await res.text()}`);
  }
  return (await res.json()) as TokenResponse;
}
