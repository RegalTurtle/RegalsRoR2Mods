import { MongoClient, type Db } from "mongodb";

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB ?? "regals_ror2_mods";

let clientPromise: Promise<MongoClient> | undefined;

export function getWorkspaceId() {
  return process.env.MONGODB_WORKSPACE_ID ?? "default";
}

export async function getDb(): Promise<Db> {
  if (!uri) {
    throw new Error("MONGODB_URI is not configured");
  }

  clientPromise ??= new MongoClient(uri, { serverSelectionTimeoutMS: 2500 }).connect();
  const client = await clientPromise;
  return client.db(dbName);
}
