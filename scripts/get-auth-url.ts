import { getAuthorizationUrl } from "../src/amazon-ads/auth.js";

console.log("\nOpen this URL in a browser, logged in as the Amazon account that manages Aravi's ads,");
console.log("and approve access. Amazon will then redirect you to your AMAZON_ADS_REDIRECT_URI");
console.log("with a `code` query parameter — copy that code for the next step.\n");
console.log(getAuthorizationUrl());
console.log("");
