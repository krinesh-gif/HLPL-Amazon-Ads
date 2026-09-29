// Usage: npm run db:seed-demo [-- --force]
// Writes fake data to DB_PATH. Prefer `npm run demo`, which uses a separate demo DB file.
const { seedDemo } = await import("../src/demo/seedDemo.js");
seedDemo({ force: process.argv.includes("--force") });
