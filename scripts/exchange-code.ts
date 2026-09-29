import { exchangeCodeForTokens } from "../src/amazon-ads/auth.js";

const code = process.argv[2];
if (!code) {
  console.error("Usage: npm run auth:exchange -- <code>");
  console.error("(the `code` query param from the redirect URL after npm run auth:url)");
  process.exit(1);
}

const tokens = await exchangeCodeForTokens(code);
console.log("\nSuccess. Add this line to .env:\n");
console.log(`AMAZON_ADS_REFRESH_TOKEN=${tokens.refresh_token}\n`);
console.log("Then run `npm run sync:profiles` to find your AMAZON_ADS_PROFILE_ID.\n");
