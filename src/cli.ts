import { initSchema } from "./db/client.js";
import { syncProfiles } from "./sync/syncProfiles.js";
import { syncCampaigns } from "./sync/syncCampaigns.js";
import { syncReports } from "./sync/syncReports.js";
import { syncKeywords } from "./sync/syncKeywords.js";
import { syncTargetingReport } from "./sync/syncTargetingReport.js";
import { syncSearchTerms } from "./sync/syncSearchTerms.js";
import { syncProducts } from "./sync/syncProducts.js";
import { syncSponsoredBrands } from "./sync/syncSponsoredBrands.js";
import { syncSponsoredDisplay } from "./sync/syncSponsoredDisplay.js";
import { recordSyncRun, type SyncJob } from "./sync/syncRuns.js";

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
    case "sync:products": {
      const d = days(14);
      await recordSyncRun("products", `last ${d} days`, () => syncProducts(d));
      break;
    }
    case "sync:sb": {
      const d = days(14);
      await recordSyncRun("sb", `last ${d} days`, () => syncSponsoredBrands(d));
      break;
    }
    case "sync:sd": {
      const d = days(14);
      await recordSyncRun("sd", `last ${d} days`, () => syncSponsoredDisplay(d));
      break;
    }
    case "sync:all": {
      // The daily job: settings first, then the last 14 days of every report
      // (Amazon keeps revising 14-day attributed sales for that long).
      // Each job is logged on its own and a failure doesn't stop the rest — e.g. an
      // account without Brand Registry gets a 401 on SB but SP should still sync.
      const d = days(14);
      const range = `last ${d} days`;
      const jobs: [SyncJob, string | null, () => Promise<number>][] = [
        ["campaigns", null, syncCampaigns],
        ["keywords", null, syncKeywords],
        ["reports", range, () => syncReports(d)],
        ["targeting", range, () => syncTargetingReport(d)],
        ["search-terms", range, () => syncSearchTerms(d)],
        ["products", range, () => syncProducts(d)],
        ["sb", range, () => syncSponsoredBrands(d)],
        ["sd", range, () => syncSponsoredDisplay(d)],
      ];
      const failed: string[] = [];
      for (const [job, detail, run] of jobs) {
        try {
          await recordSyncRun(job, detail, run);
        } catch (err) {
          failed.push(job);
          console.error(`✗ ${job} failed: ${err instanceof Error ? err.message : err}`);
        }
      }
      if (failed.length) throw new Error(`sync:all finished with failures: ${failed.join(", ")} (see Sync status)`);
      break;
    }
    default:
      console.log(
        "Usage: tsx src/cli.ts <db:init | sync:profiles | sync:campaigns | sync:reports [days] |\n" +
          "  sync:keywords | sync:targeting [days] | sync:search-terms [days] | sync:products [days] | sync:sb [days] | sync:sd [days] | sync:all [days]>"
      );
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
