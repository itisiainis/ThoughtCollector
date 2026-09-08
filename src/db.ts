// Everything that touches the database lives here. Same schema, same SQL and
// same rules as storage.py - only the language changed. Note there is no server
// anywhere in this file: expo-sqlite opens a file on the device directly.

import * as SQLite from 'expo-sqlite';
import { paletteAt } from './theme';

export const SORT_MANUAL = 'manual';
export const SORT_ALPHA = 'alpha';
export const SORT_NEWEST = 'newest';
export type SortMode = typeof SORT_MANUAL | typeof SORT_ALPHA | typeof SORT_NEWEST;
export const SORT_CYCLE: SortMode[] = [SORT_NEWEST, SORT_ALPHA, SORT_MANUAL];

export interface Area {
  id: number;
  name: string;
  description: string;
  color: string;
  sort_index: number;
  task_sort_mode: SortMode;
  created_at: string;
  deleted_at: string | null;
}

export interface Task {
  id: number;
  name: string;
  description: string;
  area_id: number | null;
  orphaned_from_area_id: number | null;
  sort_index: number;
  created_at: string;
  deleted_at: string | null;
}

const SCHEMA = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS areas (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    color           TEXT NOT NULL,
    sort_index      REAL NOT NULL DEFAULT 0,
    task_sort_mode  TEXT NOT NULL DEFAULT 'newest',
    created_at      TEXT NOT NULL,
    deleted_at      TEXT
);

CREATE TABLE IF NOT EXISTS tasks (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    name                    TEXT NOT NULL,
    description             TEXT NOT NULL DEFAULT '',
    area_id                 INTEGER REFERENCES areas(id),
    orphaned_from_area_id   INTEGER,
    sort_index              REAL NOT NULL DEFAULT 0,
    created_at              TEXT NOT NULL,
    deleted_at              TEXT
);

CREATE TABLE IF NOT EXISTS app_state (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
);
`;

const CLOSED_CARDS = 'closed_cards';

/** Whether the fixed A/R/area jump rail is shown along the right edge. Off by
 * default - most people never touch it, and hiding it lets every row use the
 * full width of the screen. */
export const SHOW_RAIL = 'show_rail';

const DEFAULT_STATE: Record<string, string> = {
  area_sort_mode: SORT_NEWEST,
  rogue_sort_mode: SORT_NEWEST,
  color_cursor: '0',
  [CLOSED_CARDS]: '[]',
  [SHOW_RAIL]: '0',
};

const now = () => new Date().toISOString().slice(0, 19);

let db: SQLite.SQLiteDatabase | null = null;
let opening: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * Opening is done once and remembered as a promise, not as a flag. Every query
 * awaits that same promise, so nothing can run against a database that is not
 * open yet - whoever gets there first simply waits. The screen used to be able
 * to ask before the open had finished, and a fast refresh, which resets this
 * module while the mounted screens keep going, could do it every time.
 */
export function openDb(): Promise<SQLite.SQLiteDatabase> {
  if (!opening) {
    opening = (async () => {
      const opened = await SQLite.openDatabaseAsync('tasks.db');
      await opened.execAsync(SCHEMA);
      for (const [key, value] of Object.entries(DEFAULT_STATE)) {
        await opened.runAsync(
          'INSERT OR IGNORE INTO app_state (key, value) VALUES (?, ?)',
          [key, value],
        );
      }
      db = opened;
      return opened;
    })().catch((error) => {
      // A failed open must not be remembered, or every later query fails with
      // it and the app is stuck on a blank screen until it is killed.
      opening = null;
      throw error;
    });
  }
  return opening;
}

const handle = () => (db ? Promise.resolve(db) : openDb());

/** Exposed so the Drizzle Studio plugin can attach to the live connection. */
export const rawDb = () => db;

// ---------------------------------------------------------------- app state

export async function getState(key: string): Promise<string> {
  const row = await (
    await handle()
  ).getFirstAsync<{ value: string }>('SELECT value FROM app_state WHERE key = ?', [key]);
  return row?.value ?? '';
}

export async function setState(key: string, value: string): Promise<void> {
  await (
    await handle()
  ).runAsync(
    'INSERT INTO app_state (key, value) VALUES (?, ?) ' +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, String(value)],
  );
}

/**
 * Pull the next palette colour and advance the cursor. The cursor counts areas
 * ever created, not areas alive, so deleting one doesn't make the next area
 * repeat the colour you just freed up.
 */
async function takeNextColor(): Promise<string> {
  const cursor = parseInt((await getState('color_cursor')) || '0', 10);
  await setState('color_cursor', String(cursor + 1));
  return paletteAt(cursor);
}

// ---------------------------------------------------------------- reading

/** One step above the current highest card. New items land on top. */
async function topIndex(table: string, where = '', params: any[] = []): Promise<number> {
  let sql = `SELECT MIN(sort_index) AS m FROM ${table} WHERE deleted_at IS NULL`;
  if (where) sql += ` AND ${where}`;
  const row = await (await handle()).getFirstAsync<{ m: number | null }>(sql, params);
  return row?.m == null ? 0 : row.m - 1;
}

function sortItems<T extends { name: string; created_at: string; sort_index: number }>(
  items: T[],
  mode: string,
): T[] {
  const copy = [...items];
  if (mode === SORT_ALPHA)
    return copy.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  if (mode === SORT_NEWEST)
    return copy.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return copy.sort((a, b) => a.sort_index - b.sort_index); // SORT_MANUAL
}

export async function listAreas(): Promise<Area[]> {
  const rows = await (
    await handle()
  ).getAllAsync<Area>('SELECT * FROM areas WHERE deleted_at IS NULL');
  return sortItems(rows, await getState('area_sort_mode'));
}

export async function getArea(id: number): Promise<Area | null> {
  return (
    (await (
      await handle()
    ).getFirstAsync<Area>('SELECT * FROM areas WHERE id = ?', [id])) ?? null
  );
}

/** Tasks for one area, or rogue tasks when areaId is null. */
export async function listTasks(areaId: number | null): Promise<Task[]> {
  let rows: Task[];
  let mode: string;
  if (areaId == null) {
    rows = await (
      await handle()
    ).getAllAsync<Task>(
      'SELECT * FROM tasks WHERE deleted_at IS NULL AND area_id IS NULL',
    );
    mode = await getState('rogue_sort_mode');
  } else {
    rows = await (
      await handle()
    ).getAllAsync<Task>('SELECT * FROM tasks WHERE deleted_at IS NULL AND area_id = ?', [
      areaId,
    ]);
    mode = (await getArea(areaId))?.task_sort_mode ?? SORT_NEWEST;
  }
  return sortItems(rows, mode);
}

export const trashedAreas = async () =>
  (await handle()).getAllAsync<Area>(
    'SELECT * FROM areas WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC',
  );

export const trashedTasks = async () =>
  (await handle()).getAllAsync<Task>(
    'SELECT * FROM tasks WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC',
  );

/**
 * Which cards the user has folded away, by key ("task:12", "area:3").
 *
 * The closed ones are stored rather than the open ones: a card nobody has
 * touched is open, so a new thought is readable the moment it is written and an
 * empty list means "nothing has been folded away yet".
 */
export async function closedCards(): Promise<Record<string, true>> {
  try {
    const raw = await getState(CLOSED_CARDS);
    const keys: string[] = raw ? JSON.parse(raw) : [];
    return Object.fromEntries(keys.map((key) => [key, true as const]));
  } catch {
    // A corrupt list is not worth losing the screen over - start again.
    return {};
  }
}

export async function setCardClosed(key: string, closed: boolean): Promise<void> {
  const current = await closedCards();
  if (closed) current[key] = true;
  else delete current[key];
  await setState(CLOSED_CARDS, JSON.stringify(Object.keys(current)));
}

/** Everything stored, trash included - what the settings screen reports. */
export async function counts(): Promise<{ areas: number; tasks: number }> {
  const areas = await (
    await handle()
  ).getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM areas');
  const tasks = await (
    await handle()
  ).getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM tasks');
  return { areas: areas?.n ?? 0, tasks: tasks?.n ?? 0 };
}

// ---------------------------------------------------------------- areas

export async function createArea(
  name: string,
  description = '',
  color = '',
): Promise<number> {
  const result = await (
    await handle()
  ).runAsync(
    'INSERT INTO areas (name, description, color, sort_index, created_at) VALUES (?, ?, ?, ?, ?)',
    [name, description, color || (await takeNextColor()), await topIndex('areas'), now()],
  );
  return result.lastInsertRowId;
}

export async function updateArea(
  id: number,
  fields: Partial<
    Pick<Area, 'name' | 'description' | 'color' | 'task_sort_mode' | 'sort_index'>
  >,
): Promise<void> {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const assignments = keys.map((k) => `${k} = ?`).join(', ');
  await (
    await handle()
  ).runAsync(`UPDATE areas SET ${assignments} WHERE id = ?`, [
    ...Object.values(fields),
    id,
  ]);
}

/**
 * Area goes to the trash. Its live tasks are demoted to rogue but stay live.
 *
 * We stamp them with orphaned_from_area_id so that restoring the area can tell
 * "this task was pushed out by the delete" apart from "the user has since
 * re-tagged this task by hand".
 */
export async function trashArea(id: number): Promise<void> {
  await (
    await handle()
  ).runAsync(
    'UPDATE tasks SET area_id = NULL, orphaned_from_area_id = ? WHERE area_id = ? AND deleted_at IS NULL',
    [id, id],
  );
  await (
    await handle()
  ).runAsync('UPDATE areas SET deleted_at = ? WHERE id = ?', [now(), id]);
}

/** Bring an area back and reclaim only the tasks that were never re-tagged. */
export async function restoreArea(id: number): Promise<void> {
  await (
    await handle()
  ).runAsync('UPDATE areas SET deleted_at = NULL WHERE id = ?', [id]);
  await (
    await handle()
  ).runAsync(
    'UPDATE tasks SET area_id = ?, orphaned_from_area_id = NULL ' +
      'WHERE orphaned_from_area_id = ? AND area_id IS NULL AND deleted_at IS NULL',
    [id, id],
  );
}

// ---------------------------------------------------------------- tasks

export async function createTask(
  name: string,
  description = '',
  areaId: number | null = null,
): Promise<number> {
  const top =
    areaId == null
      ? await topIndex('tasks', 'area_id IS NULL')
      : await topIndex('tasks', 'area_id = ?', [areaId]);
  const result = await (
    await handle()
  ).runAsync(
    'INSERT INTO tasks (name, description, area_id, sort_index, created_at) VALUES (?, ?, ?, ?, ?)',
    [name, description, areaId, top, now()],
  );
  return result.lastInsertRowId;
}

export async function updateTask(
  id: number,
  fields: Partial<Pick<Task, 'name' | 'description' | 'sort_index'>>,
): Promise<void> {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const assignments = keys.map((k) => `${k} = ?`).join(', ');
  await (
    await handle()
  ).runAsync(`UPDATE tasks SET ${assignments} WHERE id = ?`, [
    ...Object.values(fields),
    id,
  ]);
}

/**
 * Manual re-tag. Clears the orphan stamp - the user has taken ownership, so a
 * later area restore must not yank this task back.
 */
export async function reassignTask(id: number, areaId: number | null): Promise<void> {
  const top =
    areaId == null
      ? await topIndex('tasks', 'area_id IS NULL')
      : await topIndex('tasks', 'area_id = ?', [areaId]);
  await (
    await handle()
  ).runAsync(
    'UPDATE tasks SET area_id = ?, orphaned_from_area_id = NULL, sort_index = ? WHERE id = ?',
    [areaId, top, id],
  );
}

export const trashTask = async (id: number) =>
  (await handle()).runAsync('UPDATE tasks SET deleted_at = ? WHERE id = ?', [now(), id]);

/**
 * Restore a task. If its area went to the trash meanwhile, the task lands in
 * rogue - same place its un-deleted siblings ended up.
 */
export async function restoreTask(id: number): Promise<void> {
  const row = await (
    await handle()
  ).getFirstAsync<{ area_id: number | null }>('SELECT area_id FROM tasks WHERE id = ?', [
    id,
  ]);
  if (!row) return;
  if (row.area_id != null) {
    const area = await getArea(row.area_id);
    if (!area || area.deleted_at) {
      await (
        await handle()
      ).runAsync(
        'UPDATE tasks SET area_id = NULL, orphaned_from_area_id = ? WHERE id = ?',
        [row.area_id, id],
      );
    }
  }
  await (
    await handle()
  ).runAsync('UPDATE tasks SET deleted_at = NULL WHERE id = ?', [id]);
}

// ---------------------------------------------------------------- trash

export async function eraseOne(table: 'areas' | 'tasks', id: number): Promise<void> {
  await (await handle()).runAsync(`DELETE FROM ${table} WHERE id = ?`, [id]);
  if (table === 'areas') {
    // Any task still pointing at this area has a dangling stamp now.
    await (
      await handle()
    ).runAsync(
      'UPDATE tasks SET orphaned_from_area_id = NULL WHERE orphaned_from_area_id = ?',
      [id],
    );
  }
}

/** Permanent. Also clears orphan stamps pointing at areas that no longer exist. */
export async function eraseTrash(): Promise<void> {
  await (
    await handle()
  ).execAsync(`
    DELETE FROM tasks WHERE deleted_at IS NOT NULL;
    DELETE FROM areas WHERE deleted_at IS NOT NULL;
    UPDATE tasks SET orphaned_from_area_id = NULL
      WHERE orphaned_from_area_id NOT IN (SELECT id FROM areas);
  `);
}

/**
 * Areas first: restoring an area reclaims its untouched orphans, and those
 * tasks must already be back before it looks for them.
 */
export async function restoreAll(): Promise<void> {
  for (const area of await trashedAreas()) await restoreArea(area.id);
  for (const task of await trashedTasks()) await restoreTask(task.id);
}

// ---------------------------------------------------------------- reordering

/**
 * Write a new manual arrangement. Called after a drag finishes.
 *
 * One transaction rather than one round trip per card: the list is already
 * showing the new order by the time this runs, and a half-written arrangement
 * would contradict it.
 */
export async function reorder(table: 'areas' | 'tasks', ids: number[]): Promise<void> {
  await (
    await handle()
  ).withTransactionAsync(async () => {
    for (let i = 0; i < ids.length; i++) {
      await (
        await handle()
      ).runAsync(`UPDATE ${table} SET sort_index = ? WHERE id = ?`, [i, ids[i]]);
    }
  });
}

// ---------------------------------------------------------------- backup

export const BACKUP_VERSION = 1;

export async function dumpBackup(): Promise<string> {
  // Trash included - a backup that silently drops the trash would be a nasty
  // surprise on restore.
  return JSON.stringify(
    {
      version: BACKUP_VERSION,
      exported_at: now(),
      areas: await (await handle()).getAllAsync('SELECT * FROM areas'),
      tasks: await (await handle()).getAllAsync('SELECT * FROM tasks'),
      app_state: await (await handle()).getAllAsync('SELECT * FROM app_state'),
    },
    null,
    2,
  );
}

/**
 * The same content as dumpBackup, written for a person instead of a machine.
 *
 * Plain markdown rather than styled text: bold and italics survive almost no
 * trip through a messenger, and this is meant to be pasted anywhere. Trashed
 * items are left out - a backup keeps them, a document about your thoughts
 * should not.
 */
export async function dumpMarkdown(): Promise<string> {
  const lines: string[] = ['# Thoughts', ''];

  const rogue = await listTasks(null);
  if (rogue.length) {
    lines.push('## Unsorted', '');
    for (const task of rogue) lines.push(...taskLines(task));
  }

  for (const area of await listAreas()) {
    lines.push(`## ${area.name}`, '');
    if (area.description.trim()) lines.push(area.description.trim(), '');
    const tasks = await listTasks(area.id);
    if (!tasks.length) lines.push('_(empty)_', '');
    for (const task of tasks) lines.push(...taskLines(task));
  }

  return lines.join('\n');
}

function taskLines(task: Task): string[] {
  const out = [`### ${task.name}`];
  if (task.description.trim()) out.push('', task.description.trim());
  out.push('', `_${task.created_at.slice(0, 10)}_`, '');
  return out;
}

export type RestoreMode = 'merge' | 'replace';

/**
 * All or nothing - a half-applied import would be worse than a failed one.
 *
 * 'replace' wipes the database and loads the file's own rows verbatim, ids
 * included. 'merge' keeps everything already here: an incoming area folds
 * into an existing one of the same name rather than duplicating it, and
 * every row otherwise lands as a new one with an id the database hands out
 * itself - the file's own ids only mean anything inside the file they came
 * from, and reusing them here would either collide with what already
 * exists or silently steal the identity of an unrelated row that happens
 * to already sit at that id.
 */
export async function restoreBackup(
  raw: string,
  mode: RestoreMode = 'replace',
): Promise<void> {
  const payload = JSON.parse(raw);
  if (payload.version !== BACKUP_VERSION) {
    throw new Error(`unsupported backup version ${payload.version}`);
  }
  const db = await handle();
  await db.withTransactionAsync(async () => {
    if (mode === 'replace') {
      await db.execAsync('DELETE FROM tasks; DELETE FROM areas; DELETE FROM app_state;');
      for (const table of ['areas', 'tasks', 'app_state'] as const) {
        for (const row of payload[table] ?? []) {
          // Column list comes from the file, so a backup written by an older
          // build still loads as long as its columns still exist.
          const cols = Object.keys(row);
          const placeholders = cols.map(() => '?').join(', ');
          await db.runAsync(
            `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`,
            Object.values(row) as any[],
          );
        }
      }
      return;
    }

    // Matched by name against what is already here, not against anything
    // else in the same file - two areas in the file with the same name
    // still both fold into the one local area, the same as if they had
    // been merged in one at a time.
    const existingAreas = await db.getAllAsync<{ id: number; name: string }>(
      'SELECT id, name FROM areas WHERE deleted_at IS NULL',
    );
    const localIdByName = new Map(existingAreas.map((a) => [a.name.trim(), a.id]));

    // Old (file) area id -> local area id, whether that local id already
    // existed or was just created for this import.
    const areaIdMap = new Map<number, number>();
    for (const row of payload.areas ?? []) {
      const matched = localIdByName.get(String(row.name ?? '').trim());
      if (matched != null) {
        areaIdMap.set(row.id, matched);
        continue;
      }
      const { id, ...fields } = row;
      const cols = Object.keys(fields);
      const placeholders = cols.map(() => '?').join(', ');
      const result = await db.runAsync(
        `INSERT INTO areas (${cols.join(', ')}) VALUES (${placeholders})`,
        Object.values(fields) as any[],
      );
      areaIdMap.set(id, result.lastInsertRowId);
    }

    for (const row of payload.tasks ?? []) {
      const { id, area_id, orphaned_from_area_id, ...fields } = row;
      const cols = Object.keys(fields);
      const values = Object.values(fields) as any[];
      cols.push('area_id', 'orphaned_from_area_id');
      values.push(
        area_id == null ? null : (areaIdMap.get(area_id) ?? null),
        orphaned_from_area_id == null
          ? null
          : (areaIdMap.get(orphaned_from_area_id) ?? null),
      );
      const placeholders = cols.map(() => '?').join(', ');
      await db.runAsync(
        `INSERT INTO tasks (${cols.join(', ')}) VALUES (${placeholders})`,
        values,
      );
    }

    // app_state is left alone on merge: sort-mode preferences and folded-card
    // keys are keyed by ids that no longer mean the same thing after this.
  });
}
