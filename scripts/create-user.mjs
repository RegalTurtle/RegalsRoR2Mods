import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { MongoClient } from "mongodb";
import { hashPassword } from "../lib/passwords.ts";

const username = process.argv[2]?.toLowerCase();
if (!username || !/^[a-z0-9_-]{1,64}$/.test(username)) throw new Error("Usage: npm run user:create -- <username> (letters, numbers, underscores, hyphens)");
if (!process.stdin.isTTY) throw new Error("Run this command in an interactive terminal; passwords are entered privately.");
let muted = false;
const output = new Writable({ write(chunk, encoding, callback) { if (!muted) process.stdout.write(chunk, encoding); callback(); } });
const prompt = createInterface({ input: process.stdin, output, terminal: true });
async function passwordQuestion(label) {
  process.stdout.write(label);
  muted = true;
  const value = await prompt.question("");
  muted = false; process.stdout.write("\n");
  return value;
}
let password;
try {
  password = await passwordQuestion("Password (12+ characters): ");
  const confirmation = await passwordQuestion("Confirm password: ");
  if (password.length < 12 || password.length > 1024) throw new Error("Password must contain 12–1024 characters");
  if (password !== confirmation) throw new Error("Passwords do not match");
} finally { prompt.close(); }
const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
try {
  await client.connect();
  const db = client.db(process.env.MONGODB_DB ?? "regals_ror2_mods");
  const workspaceId = process.env.MONGODB_WORKSPACE_ID ?? "default";
  const users = db.collection("users");
  await users.createIndex({ workspaceId: 1, username: 1 }, { unique: true });
  if (await users.findOne({ workspaceId, username })) throw new Error("This username already exists; no changes made");
  await users.insertOne({ workspaceId, username, passwordHash: await hashPassword(password),
    role: process.argv.includes("--admin") ? "admin" : "member", allPacks: false, allGroups: false, packIds: [], groupIds: [],
    createdAt: new Date(), disabled: false });
  console.log(`Created account: ${username}`);
} finally { await client.close(); }
