// Handing a thought to the clipboard, as opposed to exporting it for a
// machine (the JSON/markdown backups in db.ts) or through the system's own
// share sheet (dropped - copy does the same job in fewer taps, straight into
// whatever the cursor is already sitting in). Plain text on purpose: it
// arrives intact in a messenger, where markdown syntax would arrive as
// literal asterisks.

import { Platform, ToastAndroid } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import type { Area, Task } from './db';

const RULE = '─────────────';

function indent(text: string): string {
  return text
    .trim()
    .split('\n')
    .map((line) => (line.trim() ? `   ${line.trim()}` : ''))
    .join('\n');
}

function stamp(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-');
  return `${day}.${month}.${year}`;
}

/** One task: its name, its description, and where it came from. */
export function taskText(task: Task, areaName?: string | null): string {
  const parts = [task.name.trim()];
  if (task.description.trim()) parts.push('', task.description.trim());
  parts.push(
    '',
    RULE,
    areaName ? `${areaName} · ${stamp(task.created_at)}` : stamp(task.created_at),
  );
  return parts.join('\n');
}

/** Every task in a list, one bullet each - the part an area and a loose
 * group of tasks share. */
function tasksBlock(tasks: Task[]): string {
  const parts: string[] = [];
  if (!tasks.length) {
    parts.push('(nothing here yet)');
  } else {
    for (const task of tasks) {
      parts.push(`• ${task.name.trim()}`);
      if (task.description.trim()) parts.push(indent(task.description));
      parts.push('');
    }
    parts.pop();
  }
  return parts.join('\n');
}

/** A whole area: its own description, then every task in it as a bullet. */
export function areaText(area: Area, tasks: Task[]): string {
  const parts = [area.name.trim().toUpperCase()];
  if (area.description.trim()) parts.push('', area.description.trim());
  parts.push('', tasksBlock(tasks));

  const count = tasks.length === 1 ? '1 thought' : `${tasks.length} thoughts`;
  parts.push('', RULE, count);
  return parts.join('\n');
}

/** A loose group of tasks with no area of their own - Rogue Tasks. */
export function tasksText(title: string, tasks: Task[]): string {
  const parts = [title.trim().toUpperCase(), '', tasksBlock(tasks)];

  const count = tasks.length === 1 ? '1 thought' : `${tasks.length} thoughts`;
  parts.push('', RULE, count);
  return parts.join('\n');
}

/**
 * Puts text straight on the clipboard, wherever the cursor happens to be -
 * a note already open, a field halfway through being filled in.
 *
 * A toast because a copy is otherwise invisible: nothing on the screen moves,
 * and a button that appears to do nothing is one nobody presses twice.
 */
export async function copyText(body: string): Promise<void> {
  await Clipboard.setStringAsync(body);
  if (Platform.OS === 'android') ToastAndroid.show('Copied', ToastAndroid.SHORT);
}

export const copyTask = (task: Task, areaName?: string | null) =>
  copyText(taskText(task, areaName));

export const copyArea = (area: Area, tasks: Task[]) => copyText(areaText(area, tasks));

export const copyTasks = (title: string, tasks: Task[]) =>
  copyText(tasksText(title, tasks));
