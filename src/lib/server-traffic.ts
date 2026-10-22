import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { TrafficTotals } from './admin-overview-model';

export interface TrafficSample { at: number; bootId: string; interface: string; received: number; sent: number; }
export function initializeTraffic(database: Database.Database) {
  database.exec(`CREATE TABLE IF NOT EXISTS server_traffic_state (
    id INTEGER PRIMARY KEY CHECK(id=1), startedAt INTEGER NOT NULL, sampledAt INTEGER NOT NULL,
    bootId TEXT NOT NULL, interface TEXT NOT NULL, received INTEGER NOT NULL, sent INTEGER NOT NULL,
    interruptions INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS server_traffic_day (day TEXT PRIMARY KEY, received INTEGER NOT NULL, sent INTEGER NOT NULL);`);
}
const dayOf = (at: number) => new Date(at + 8 * 3600_000).toISOString().slice(0, 10);
// An interval crossing midnight is apportioned by elapsed time; byte deltas stay exact overall.
export function saveTraffic(database: Database.Database, sample: TrafficSample): TrafficTotals {
  if (!Number.isSafeInteger(sample.at) || sample.at <= 0 || !sample.bootId || !sample.interface ||
    ![sample.received, sample.sent].every((value) => Number.isSafeInteger(value) && value >= 0)) throw new Error('Invalid traffic sample');
  return database.transaction(() => {
    const previous = database.prepare('SELECT * FROM server_traffic_state WHERE id=1').get() as (Omit<TrafficSample, 'at'> & { startedAt: number; sampledAt: number; interruptions: number }) | undefined;
    if (!previous) {
      database.prepare('INSERT INTO server_traffic_state(id,startedAt,sampledAt,bootId,interface,received,sent) VALUES(1,?,?,?,?,?,?)')
        .run(sample.at, sample.at, sample.bootId, sample.interface, sample.received, sample.sent);
    } else if (sample.at > previous.sampledAt) {
      const continuous = sample.bootId === previous.bootId && sample.interface === previous.interface && sample.received >= previous.received && sample.sent >= previous.sent;
      if (continuous) {
        const received = sample.received - previous.received, sent = sample.sent - previous.sent;
        let cursor = previous.sampledAt, usedReceived = 0, usedSent = 0;
        const add = database.prepare('INSERT INTO server_traffic_day(day,received,sent) VALUES(?,?,?) ON CONFLICT(day) DO UPDATE SET received=received+excluded.received,sent=sent+excluded.sent');
        while (cursor < sample.at) {
          const day = dayOf(cursor);
          const end = Math.min(sample.at, Date.parse(day + 'T00:00:00+08:00') + 86400_000);
          const cumulativeReceived = Math.floor(received * ((end - previous.sampledAt) / (sample.at - previous.sampledAt)));
          const cumulativeSent = Math.floor(sent * ((end - previous.sampledAt) / (sample.at - previous.sampledAt)));
          add.run(day, cumulativeReceived - usedReceived, cumulativeSent - usedSent);
          usedReceived = cumulativeReceived; usedSent = cumulativeSent; cursor = end;
        }
      }
      database.prepare('UPDATE server_traffic_state SET sampledAt=?,bootId=?,interface=?,received=?,sent=?,interruptions=interruptions+? WHERE id=1')
        .run(sample.at, sample.bootId, sample.interface, sample.received, sample.sent, continuous ? 0 : 1);
    }
    const state = database.prepare('SELECT startedAt,sampledAt,interruptions FROM server_traffic_state WHERE id=1').get() as { startedAt: number; sampledAt: number; interruptions: number };
    const day = dayOf(state.sampledAt);
    const sum = (where = '', parameter?: string) => {
      const query = database.prepare(`SELECT COALESCE(SUM(received),0) AS receivedBytes,COALESCE(SUM(sent),0) AS sentBytes FROM server_traffic_day ${where}`);
      return (parameter === undefined ? query.get() : query.get(parameter)) as { receivedBytes: number; sentBytes: number };
    };
    return { startedAt: state.startedAt, sampledAt: state.sampledAt, interruptions: state.interruptions,
      today: sum('WHERE day=?', day), month: sum('WHERE substr(day,1,7)=?', day.slice(0, 7)), total: sum() };
  })();
}
const trafficGlobal = globalThis as typeof globalThis & { lunaTrafficDatabase?: { filename: string; database: Database.Database } };
export function recordServerTraffic(sample: TrafficSample) {
  const directory = path.resolve(process.env.SERVER_DATA_DIR || path.join(process.cwd(), '.data'));
  const filename = path.join(directory, 'server-metrics.sqlite');
  if (trafficGlobal.lunaTrafficDatabase?.filename !== filename) {
    trafficGlobal.lunaTrafficDatabase?.database.close();
    trafficGlobal.lunaTrafficDatabase = undefined;
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const database = new Database(filename);
    try {
      fs.chmodSync(filename, 0o600);
      database.pragma('journal_mode = WAL'); database.pragma('busy_timeout = 5000');
      initializeTraffic(database);
      trafficGlobal.lunaTrafficDatabase = { filename, database };
    } catch (error) { database.close(); throw error; }
  }
  return saveTraffic(trafficGlobal.lunaTrafficDatabase.database, sample);
}
