import fs from "fs";
import path from "path";
import { config } from "./config";

interface Store {
  sessions: Record<string, any>;
  bookings: any[];
  leads: Record<string, any>;
  transfers: any[];
  smsLog: any[];
}

const storePath = path.join(config.dataDir, "store.json");

function emptyStore(): Store {
  return { sessions: {}, bookings: [], leads: {}, transfers: [], smsLog: [] };
}

function ensureDataDir() {
  if (!fs.existsSync(config.dataDir)) {
    fs.mkdirSync(config.dataDir, { recursive: true });
  }
}

export function readStore(): Store {
  ensureDataDir();
  if (!fs.existsSync(storePath)) {
    return emptyStore();
  }
  try {
    return JSON.parse(fs.readFileSync(storePath, "utf-8"));
  } catch {
    return emptyStore();
  }
}

export function writeStore(store: Store): void {
  ensureDataDir();
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2));
}

export function withStore<T>(fn: (store: Store) => T): T {
  const store = readStore();
  const result = fn(store);
  writeStore(store);
  return result;
}
