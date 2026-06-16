import Database from "better-sqlite3";
import { migrate } from "../src/db/init.js";

// Fresh in-memory database with the full schema applied.
export function testDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

let counter = 0;

// Inserts a Better-Auth-style user row directly and returns its id.
export function addUser(db: Database.Database, name = "User"): string {
  const id = `user_${++counter}`;
  db.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
     VALUES (?, ?, ?, 0, datetime('now'), datetime('now'))`
  ).run(id, name, `${id}@test.com`);
  return id;
}

// Email for a user id created via addUser.
export function emailFor(id: string): string {
  return `${id}@test.com`;
}
