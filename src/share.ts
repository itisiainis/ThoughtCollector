// Sharing a thought with a person, as opposed to exporting it for a machine.
//
// The backup in db.ts is JSON and the markdown dump is a whole document; this
// is the third case - one task or one area, handed to whatever the phone offers
// to send it with. Plain text on purpose: it arrives intact in a messenger,
// where markdown syntax would arrive as literal asterisks.

import { Share } from 'react-native';
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
  parts.push('', RULE, areaName ? `${areaName} · ${stamp(task.created_at)}` : stamp(task.created_at));
  return parts.join('\n');
}

/** A whole area: its own description, then every task in it as a bullet. */
export function areaText(area: Area, tasks: Task[]): string {
  const parts = [area.name.trim().toUpperCase()];
  if (area.description.trim()) parts.push('', area.description.trim());
  parts.push('');

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

  const count = tasks.length === 1 ? '1 thought' : `${tasks.length} thoughts`;
  parts.push('', RULE, count);
  return parts.join('\n');
}

/** Hands the text to the system sheet. Cancelling is not an error. */
export async function shareText(title: string, body: string): Promise<void> {
  try {
    await Share.share({ title, message: body });
  } catch {
    // Nothing useful to say - the sheet either opened or the user backed out.
  }
}

export const shareTask = (task: Task, areaName?: string | null) =>
  shareText(task.name.trim(), taskText(task, areaName));

export const shareArea = (area: Area, tasks: Task[]) =>
  shareText(area.name.trim(), areaText(area, tasks));
