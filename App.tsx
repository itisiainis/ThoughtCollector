// Holds the three screens and the bar that switches between them.
//
// Left to right: trash, list, settings. The screens are no longer rebuilt from
// scratch when something changes - they subscribe to src/events instead, which
// keeps scroll positions and folded descriptions where the user left them.
//
// Left to right: trash, list, settings. The sliding is done by PagerView -
// the platform's own pager. Gesture recognition, physics and the settle
// animation all happen natively, so unlike the Flet version the screen can
// follow your finger without a round trip into the app's own language on every
// frame.

import React, { useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import PagerView from 'react-native-pager-view';
import { useDrizzleStudio } from 'expo-drizzle-studio-plugin';
import ListScreen from './src/screens/ListScreen';
import TrashScreen from './src/screens/TrashScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import * as DB from './src/db';
import * as T from './src/theme';

const TRASH = 0;
const LIST = 1;
const SETTINGS = 2;

const TABS = [
  { key: TRASH, label: 'Trashbin', icon: 'trash-outline', active: 'trash' },
  { key: LIST, label: 'List', icon: 'list-outline', active: 'list' },
  { key: SETTINGS, label: 'Settings', icon: 'settings-outline', active: 'settings' },
] as const;

export default function App() {
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [index, setIndex] = useState(LIST);
  const [keyboardUp, setKeyboardUp] = useState(false);
  const pager = useRef<PagerView>(null);

  // Opens the live database in Drizzle Studio on the desktop - the thing that
  // was missing before, when inspecting meant pulling the file off the device.
  useDrizzleStudio(DB.rawDb());

  useEffect(() => {
    // A database that refuses to open used to leave a black screen and nothing
    // else - say so instead.
    DB.openDb().then(
      () => setReady(true),
      (error) => setFailure(String(error)),
    );
  }, []);

  useEffect(() => {
    // The bar is hidden rather than carried up to sit on top of the keys.
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardUp(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardUp(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  if (failure) {
    return (
      <View style={[styles.root, styles.failure]}>
        <Text style={styles.failureText}>The database would not open.</Text>
        <Text style={styles.failureDetail}>{failure}</Text>
      </View>
    );
  }

  if (!ready) return <View style={styles.root} />;

  const go = (next: number) => {
    setIndex(next);
    pager.current?.setPage(next);
  };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
          <StatusBar style="dark" />

          <PagerView
            ref={pager}
            style={{ flex: 1 }}
            initialPage={LIST}
            onPageSelected={(e) => setIndex(e.nativeEvent.position)}
          >
            <View key="trash" style={styles.page} collapsable={false}>
              <TrashScreen />
            </View>
            <View key="list" style={styles.page} collapsable={false}>
              <ListScreen />
            </View>
            <View key="settings" style={styles.page} collapsable={false}>
              <SettingsScreen />
            </View>
          </PagerView>

          {!keyboardUp && (
            <View style={styles.nav}>
              {TABS.map((tab) => {
                const chosen = tab.key === index;
                return (
                  <Pressable
                    key={tab.key}
                    onPress={() => go(tab.key)}
                    style={[styles.navItem, chosen && styles.navItemActive]}
                  >
                    <Ionicons
                      name={(chosen ? tab.active : tab.icon) as any}
                      size={23}
                      color={chosen ? '#1565C0' : T.TEXT_MUTED}
                    />
                    <Text
                      style={[
                        styles.navLabel,
                        { color: chosen ? '#1565C0' : T.TEXT_MUTED },
                      ]}
                    >
                      {tab.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </SafeAreaView>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.PAGE_BG },
  // PagerView needs its pages to fill the pager. Without this they collapse to
  // zero height and the whole thing silently stops responding.
  page: { flex: 1 },
  nav: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: T.RULE_COLOR,
    backgroundColor: T.PAGE_BG,
    paddingTop: 6,
    paddingBottom: 8,
  },
  // Fixed width: bold text is wider than regular, and letting the label change
  // weight made the whole pill resize and nudge its neighbours.
  navItem: {
    width: 96,
    alignItems: 'center',
    borderRadius: 16,
    paddingVertical: 5,
  },
  navItemActive: { backgroundColor: 'rgba(21,101,192,0.16)' },
  failure: { alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },
  failureText: { fontSize: 16, fontWeight: '600' },
  failureDetail: { fontSize: 13, color: T.TEXT_MUTED, textAlign: 'center' },
  navLabel: { fontSize: 12, marginTop: 1 },
});
