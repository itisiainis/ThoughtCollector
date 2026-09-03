// Settings. Currently just backup, but the screen exists so later additions
// have somewhere to live.
//
// Export writes the whole database out as JSON. Import reads one back. This is
// what makes reinstalling safe - and it is also the migration path from the
// Flet version, since the format is unchanged.

import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import * as DB from '../db';
import { dataChanged, useDataChange } from '../events';
import * as T from '../theme';

export default function SettingsScreen() {
  const [counts, setCounts] = useState({ areas: 0, tasks: 0 });
  const [status, setStatus] = useState('');
  const [showRail, setShowRail] = useState(false);

  const refresh = useCallback(async () => {
    // Everything in the tables, not just the loose tasks - the old count left
    // out every task that lived inside an area.
    setCounts(await DB.counts());
    setShowRail((await DB.getState(DB.SHOW_RAIL)) === '1');
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useDataChange(refresh);

  const toggleRail = async (value: boolean) => {
    setShowRail(value);
    await DB.setState(DB.SHOW_RAIL, value ? '1' : '0');
    dataChanged();
  };

  // File/Paths rather than the old FileSystem helpers: those were moved out to
  // expo-file-system/legacy in SDK 54 and now throw when called.
  const write = async (filename: string, body: string, mime: string) => {
    const file = new File(Paths.cache, filename);
    file.create({ overwrite: true });
    file.write(body);
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file.uri, { mimeType: mime });
      return 'Exported.';
    }
    return `Saved to ${file.uri}`;
  };

  const exportBackup = async () => {
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      setStatus(
        await write(`tasks-backup-${stamp}.json`, await DB.dumpBackup(), 'application/json')
      );
    } catch (error) {
      setStatus(`Export failed: ${error}`);
    }
  };

  const exportMarkdown = async () => {
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      setStatus(await write(`thoughts-${stamp}.md`, await DB.dumpMarkdown(), 'text/markdown'));
    } catch (error) {
      setStatus(`Export failed: ${error}`);
    }
  };

  const importBackup = () =>
    Alert.alert(
      'Replace everything?',
      'Importing wipes the current areas and tasks and puts the backup in their place.',
      [
        { text: 'CANCEL', style: 'cancel' },
        {
          text: 'IMPORT',
          style: 'destructive',
          onPress: async () => {
            try {
              // copyToCacheDirectory: false keeps the picked file's own
              // content:// URI instead of copying it into this app's cache
              // first - a copied file:// path was being checked against the
              // app's own cache directory and failing that comparison for
              // reasons that had nothing to do with whether it was readable.
              //
              // Reading it back is File, not the legacy reader: the legacy
              // module only recognises SAF documents from the built-in
              // "internal storage" provider and rejects anything else outright
              // ("Unsupported scheme") - which is exactly what a file picked
              // from Downloads is. File resolves a content:// URI through
              // Android's own DocumentsContract instead of a provider
              // allowlist, so it doesn't care which app is serving the file.
              const picked = await DocumentPicker.getDocumentAsync({
                type: 'application/json',
                copyToCacheDirectory: false,
              });
              if (picked.canceled) return setStatus('Import cancelled.');
              const raw = await new File(picked.assets[0].uri).text();
              await DB.restoreBackup(raw);
              dataChanged();
              setStatus('Imported.');
            } catch (error) {
              setStatus(`That does not look like a backup (${error}).`);
            }
          },
        },
      ]
    );

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={{ paddingBottom: T.NAV_HEIGHT + 20 }}
    >
      <Text style={styles.title}>Settings</Text>

      <View style={{ height: T.SECTION_GAP }} />
      <View style={styles.rule} />
      <Text style={styles.section}>Display</Text>

      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={styles.rowLabel}>Jump rail</Text>
          <Text style={styles.muted}>
            A/R/area dots along the right edge for jumping straight to a section.
          </Text>
        </View>
        <Switch value={showRail} onValueChange={toggleRail} />
      </View>

      <View style={{ height: T.SECTION_GAP }} />
      <View style={styles.rule} />
      <Text style={styles.section}>Backup</Text>

      <Text style={styles.muted}>
        {counts.areas} areas, {counts.tasks} tasks stored (including trash)
      </Text>

      <Pressable onPress={exportBackup} style={[styles.button, styles.primary]}>
        <Text style={styles.primaryText}>Export backup (JSON)</Text>
      </Pressable>
      <Pressable onPress={importBackup} style={[styles.button, styles.outline]}>
        <Text style={styles.outlineText}>Import from file</Text>
      </Pressable>

      <View style={{ height: T.SECTION_GAP }} />
      <View style={styles.rule} />
      <Text style={styles.section}>Share</Text>
      <Text style={styles.muted}>
        Readable markdown of everything outside the trash - for sending to
        someone, not for restoring.
      </Text>
      <Pressable onPress={exportMarkdown} style={[styles.button, styles.outline]}>
        <Text style={styles.outlineText}>Export as text</Text>
      </Pressable>

      {status.length > 0 && <Text style={styles.muted}>{status}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.PAGE_BG, paddingHorizontal: T.PAGE_PADDING },
  title: { fontSize: 19, fontWeight: 'bold', paddingTop: 4 },
  rule: { height: 1, backgroundColor: T.RULE_COLOR },
  section: { fontSize: 15, fontWeight: 'bold', marginTop: 3 },
  muted: { fontSize: 13, color: T.TEXT_MUTED, marginTop: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    gap: 10,
  },
  rowText: { flex: 1 },
  rowLabel: { fontSize: 15, fontWeight: '600' },
  button: { borderRadius: 8, paddingVertical: 12, alignItems: 'center', marginTop: 10 },
  primary: { backgroundColor: '#3E5F8A' },
  primaryText: { color: '#FFFFFF', fontWeight: '600' },
  outline: { borderWidth: 1, borderColor: '#9E9E9E' },
  outlineText: { color: '#333333', fontWeight: '600' },
});
