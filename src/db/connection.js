import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { initSchema } from './schema.js';

let dbInstance = null;

export function setDb(db) {
  dbInstance = db;
  return dbInstance;
}

export function getDb(customPath = null) {
  if (dbInstance && !customPath) return dbInstance;

  const dbPath = customPath || config.databasePath;
  if (dbPath !== ':memory:') {
    mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 3000;');
  db.exec('PRAGMA synchronous = NORMAL;');

  initSchema(db);

  dbInstance = db;
  return db;
}
