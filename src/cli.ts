import { initSchema } from "./db/client.js";
import { syncProfiles } from "./sync/syncProfiles.js";
import { syncCampaigns } from "./sync/syncCampaigns.js";
import { syncReports } from "./sync/syncReports.js";
import { syncKeywords } from "./sync/syncKeywords.js";
import { syncTargetingReport } from "./sync/syncTargetingReport.js";
import { syncSearchTerms } from "./sync/syncSearchTerms.js";
import { recordSyncRun } from "./sync/syncRuns.js";

const command = process.argv[2];
const days = (fallback: number) => Number(process.argv[3]) || fallback;

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
      const d = days(7);
      await recordSyncRun("reports", `last ${d} days`, () => syncReports(d));
      break;
    }
    case "sync:keywords":
      await recordSyncRun("keywords", null, syncKeywords);
      break;
    case "sync:targeting": {
      const d = days(14);
      await recordSyncRun("targeting", `last ${d} days`, () => syncTargetingReport(d));
      break;
    }
    case "sync:search-terms": {
      const d = days(14);
      await recordSyncRun("search-terms", `last ${d} days`, () => syncSearchTerms(d));
      break;
    }
    case "sync:all": {
      // The daily job: settings first, then the last 14 days of every report
      // (Amazon keeps revising 14-day attributed sales for that long).
      const d = days(14);
      await recordSyncRun("campaigns", null, syncCampaigns);
      await recordSyncRun("keywords", null, syncKeywords);
      await recordSyncRun("reports", `last ${d} days`, () => syncReports(d));
      await recordSyncRun("targeting", `last ${d} days`, () => syncTargetingReport(d));
      await recordSyncRun("search-terms", `last ${d} days`, () => syncSearchTerms(d));
      break;
    }
    default:
      console.log(
        "Usage: tsx src/cli.ts <db:init | sync:profiles | sync:campaigns | sync:reports [days] |\n" +
          "  sync:keywords | sync:targeting [days] | sync:search-terms [days] | sync:all [days]>"
      );
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
