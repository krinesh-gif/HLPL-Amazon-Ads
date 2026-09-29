// `npm run demo`: seed a separate demo DB with fake data and open the dashboard on it.
// Never touches your real data/aravi-ads.sqlite.
process.env.DB_PATH = "./data/demo.sqlite";
const { seedDemo } = await import("../src/demo/seedDemo.js");
seedDemo();
const { startDev } = await import("./dev.js");
startDev();
