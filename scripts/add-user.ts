// Usage: npm run user:add -- <username>
// Creates a dashboard login (or resets that user's password). Prompts for the password
// without echoing it; it's stored only as a scrypt hash in the local database.
import { createInterface } from "node:readline";

const username = (process.argv[2] ?? "").trim().toLowerCase();
if (!/^[a-z0-9._-]{2,32}$/.test(username)) {
  console.error("Usage: npm run user:add -- <username>   (2–32 chars: letters, digits, . _ -)");
  process.exit(1);
}

function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    out._writeToOutput = (s: string) => {
      if (s.includes(question)) out.output.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

const password = process.env.NEW_PASSWORD ?? (await askHidden("Password (min 10 chars): "));
if (password.length < 10) {
  console.error("Password must be at least 10 characters.");
  process.exit(1);
}
if (!process.env.NEW_PASSWORD && (await askHidden("Repeat password: ")) !== password) {
  console.error("Passwords didn't match.");
  process.exit(1);
}
const { upsertUser } = await import("../src/server/auth.js");
upsertUser(username, password);
console.log(`Login ready for "${username}".`);
