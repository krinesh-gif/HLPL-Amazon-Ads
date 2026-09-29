import { initSchema } from "./db/client.js";
import { syncProfiles } from "./sync/syncProfiles.js";
import { syncCampaigns } from "./sync/syncCampaigns.js";
import { syncReports } from "./sync/syncReports.js";
import { recordSyncRun } from "./sync/syncRuns.js";

const command = process.argv[2];

async function main() {
  switch (command) {
    case "db:init":
      initSchema();
      console.log("Database schema ready.");
      break;
    case "sync:profiles":
      await recordSyncRun("profiles", null, syncProfiles);
      break;
    case "sync:campaigns":
      await recordSyncRun("campaigns", null, syncCampaigns);
      break;
    case "sync:reports": {
      const daysBack = Number(process.argv[3]) || 7;
      await recordSyncRun("reports", `last ${daysBack} days`, () => syncReports(daysBack));
      break;
    }
    default:
      console.log(
        "Usage: tsx src/cli.ts <db:init | sync:profiles | sync:campaigns | sync:reports [daysBack]>"
      );
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
