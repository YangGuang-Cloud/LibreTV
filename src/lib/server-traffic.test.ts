import Database from 'better-sqlite3';
import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initializeTraffic, saveTraffic, type TrafficSample } from './server-traffic';
const databases: Database.Database[] = [];
const directories: string[] = [];
afterEach(() => { for (const db of databases.splice(0)) if (db.open) db.close(); for (const dir of directories.splice(0)) rmSync(dir, { recursive: true }); });
function open(filename = ':memory:') { const db = new Database(filename); initializeTraffic(db); databases.push(db); return db; }
const at = (value: string) => Date.parse(value + '+08:00');
const sample = (time: string, received = 1000, sent = 2000, overrides: Partial<TrafficSample> = {}): TrafficSample => ({ at: at(time), bootId: 'boot-one', interface: 'eth0', received, sent, ...overrides });
it('启用前计数不计入，重复及过期采样不重复累计，入站出站分别统计', () => {
  const db = open();
  expect(saveTraffic(db, sample('2026-10-22T12:00:00')).total).toEqual({ receivedBytes: 0, sentBytes: 0 });
  const next = sample('2026-10-22T12:00:15', 1500, 3500);
  const result = saveTraffic(db, next);
  expect(result).toMatchObject({ today: { receivedBytes: 500, sentBytes: 1500 }, month: { receivedBytes: 500, sentBytes: 1500 }, total: { receivedBytes: 500, sentBytes: 1500 } });
  expect(saveTraffic(db, next)).toEqual(result);
  expect(saveTraffic(db, sample('2026-10-22T12:00:05', 9000, 9000))).toEqual(result);
});
it('数据库关闭重开后接续同一次开机的网卡计数，包含应用停机期间的流量', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'luna-traffic-')); directories.push(dir);
  const filename = path.join(dir, 'metrics.sqlite'); let db = open(filename);
  saveTraffic(db, sample('2026-10-22T12:00:00')); db.close();
  db = open(filename);
  expect(saveTraffic(db, sample('2026-10-22T12:10:00', 2000, 5000)).total).toEqual({ receivedBytes: 1000, sentBytes: 3000 });
});
it('北京时间跨日跨月拆分，今日本月累计各自正确且整数总量无丢失', () => {
  const db = open();
  saveTraffic(db, sample('2026-10-31T23:59:50'));
  const result = saveTraffic(db, sample('2026-11-01T00:00:10', 1101, 2203));
  expect(result.total).toEqual({ receivedBytes: 101, sentBytes: 203 });
  expect(result.today).toEqual({ receivedBytes: 51, sentBytes: 102 });
  expect(result.month).toEqual(result.today);
  expect(db.prepare('SELECT * FROM server_traffic_day WHERE day=?').get('2026-10-31')).toEqual({ day: '2026-10-31', received: 50, sent: 101 });
});
it('系统重启、网卡切换和计数回退不产生虚假流量，已保存总量仍保留', () => {
  const db = open(); saveTraffic(db, sample('2026-10-22T12:00:00'));
  saveTraffic(db, sample('2026-10-22T12:00:15', 2000, 3000));
  const reboot = saveTraffic(db, sample('2026-10-22T12:00:30', 9000, 9000, { bootId: 'boot-two' }));
  expect(reboot).toMatchObject({ interruptions: 1, total: { receivedBytes: 1000, sentBytes: 1000 } });
  expect(saveTraffic(db, sample('2026-10-22T12:00:45', 10000, 10000, { bootId: 'boot-two', interface: 'ens3' })).interruptions).toBe(2);
  expect(saveTraffic(db, sample('2026-10-22T12:01:00', 1, 2, { bootId: 'boot-two', interface: 'ens3' })).interruptions).toBe(3);
  expect(saveTraffic(db, sample('2026-10-22T12:01:15', 101, 202, { bootId: 'boot-two', interface: 'ens3' })).total).toEqual({ receivedBytes: 1100, sentBytes: 1200 });
});
it('无效采样不污染持久化基线', () => {
  const db = open();
  expect(() => saveTraffic(db, sample('2026-10-22T12:00:00', -1))).toThrow();
  expect(db.prepare('SELECT COUNT(*) AS count FROM server_traffic_state').get()).toEqual({ count: 0 });
});
