// The trash. Nothing expires on its own - items sit here until restored or
// erased. Areas and tasks are kept apart because restoring them means different
// things: an area reclaims the tasks that fell out of it and were never
// re-tagged, while a task comes back on its own and lands in rogue if its area
// is gone.

import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as DB from '../db';
import { dataChanged, useDataChange } from '../events';
import * as T from '../theme';

export default function TrashScreen() {
  const [areas, setAreas] = useState<DB.Area[]>([]);
  const [tasks, setTasks] = useState<DB.Task[]>([]);

  const refresh = useCallback(async () => {
    setAreas(await DB.trashedAreas());
    setTasks(await DB.trashedTasks());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // The screen stays mounted behind the pager, so it has to be told when a card
  // is swiped away on the list rather than finding out at the next launch.
  useDataChange(refresh);

  const empty = !areas.length && !tasks.length;

  const after = () => dataChanged();

  const confirmErase = () =>
    Alert.alert('Erase everything in the trash?', 'This cannot be undone.', [
      { text: 'CANCEL', style: 'cancel' },
      {
        text: 'ERASE',
        style: 'destructive',
        onPress: async () => {
          await DB.eraseTrash();
          after();
        },
      },
    ]);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>Trash bin</Text>
        {/* Both actions only exist when there is something to act on. */}
        {!empty && (
          <View style={styles.headerActions}>
            <Pressable
              onPress={async () => {
                await DB.restoreAll();
                after();
              }}
              hitSlop={6}
            >
              <Text style={styles.restoreText}>Restore all</Text>
            </Pressable>
            <Pressable onPress={confirmErase} hitSlop={6}>
              <Text style={styles.eraseText}>Erase all</Text>
            </Pressable>
          </View>
        )}
      </View>
      <Text style={styles.hint}>swipe tasks and areas to the left to drop them here</Text>

      <ScrollView contentContainerStyle={{ paddingBottom: T.NAV_HEIGHT + 20 }}>
        {empty && <Text style={styles.emptyText}>Nothing in the trash</Text>}

        {areas.length > 0 && <Text style={styles.label}>Areas</Text>}
        {areas.map((area) => (
          <Row
            key={`a-${area.id}`}
            name={area.name}
            description={area.description}
            color={area.color}
            onRestore={async () => {
              await DB.restoreArea(area.id);
              after();
            }}
            onErase={async () => {
              await DB.eraseOne('areas', area.id);
              after();
            }}
          />
        ))}

        {tasks.length > 0 && <Text style={styles.label}>Tasks</Text>}
        {tasks.map((task) => (
          <Row
            key={`t-${task.id}`}
            name={task.name}
            description={task.description}
            color={T.TASK_CARD}
            onRestore={async () => {
              await DB.restoreTask(task.id);
              after();
            }}
            onErase={async () => {
              await DB.eraseOne('tasks', task.id);
              after();
            }}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function Row({
  name,
  description,
  color,
  onRestore,
  onErase,
}: {
  name: string;
  description: string;
  color: string;
  onRestore: () => void;
  onErase: () => void;
}) {
  const subtitle = description.trim().replace(/\n/g, ' ');
  return (
    <View style={[styles.row, { backgroundColor: color }]}>
      <View style={styles.rowTop}>
        <Text numberOfLines={1} style={styles.rowName}>
          {name}
        </Text>
        <Pressable onPress={onRestore} hitSlop={6} style={styles.rowAction}>
          <Text style={styles.restoreText}>restore</Text>
        </Pressable>
        <Pressable onPress={onErase} hitSlop={6} style={styles.rowAction}>
          <Text style={styles.eraseText}>erase</Text>
        </Pressable>
      </View>
      {subtitle.length > 0 && (
        <Text numberOfLines={1} style={styles.rowSub}>
          {subtitle}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.PAGE_BG, paddingHorizontal: T.PAGE_PADDING },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 4,
  },
  headerActions: { flexDirection: 'row', gap: 14 },
  title: { fontSize: 19, fontWeight: 'bold' },
  hint: { fontSize: 12, color: T.TEXT_MUTED, marginBottom: 8 },
  label: { fontSize: 15, fontWeight: 'bold', color: T.TEXT_MUTED, marginTop: 12 },
  emptyText: { textAlign: 'center', color: T.TEXT_MUTED, paddingVertical: 30 },
  row: { padding: 10, marginTop: T.CARD_GAP },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowName: { flex: 1, fontSize: 15, fontWeight: 'bold', fontStyle: 'italic' },
  rowAction: { paddingHorizontal: 2 },
  rowSub: { fontSize: 13, marginTop: 2 },
  restoreText: { color: '#1565C0', fontWeight: '600' },
  eraseText: { color: T.DANGER, fontWeight: '600' },
});
