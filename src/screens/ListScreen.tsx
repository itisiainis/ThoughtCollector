// The main screen.
//
// Each section is its own Sortable.Grid inside one scroll view, so a drag
// physically cannot cross a section - the rule falls out of the structure
// instead of being enforced by hand.
//
// The reordering used to be react-native-draggable-flatlist (the old version
// is kept beside this file, renamed, for reference). It was abandoned for a
// reason that turned out to be structural rather than a bug we could chase:
// that library positions cells through React renders while animating them
// through Reanimated shared values, and on the New Architecture those two are
// pushed to the native side in separate batches. The gap between them is a
// frame drawn with one system's idea of where things are and the other's
// offsets still applied - the flash after every drop. Four attempts at fixing
// the timing only moved which frame was wrong. Sortables keeps every item
// absolutely positioned and updates positions only from the UI thread, so
// there is no second source of truth to disagree with.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useAnimatedRef } from 'react-native-reanimated';
import Sortable, { type SortableGridRenderItem } from 'react-native-sortables';
import Card from '../components/Card';
import QuickCapture from '../components/QuickCapture';
import { AreaEditor, TaskEditor } from '../components/Editor';
import * as DB from '../db';
import { dataChanged, useDataChange } from '../events';
import { shareArea } from '../share';
import * as T from '../theme';

const SORT_LABELS: Record<string, string> = {
  [DB.SORT_NEWEST]: 'Latest',
  [DB.SORT_ALPHA]: 'Alphabet',
  [DB.SORT_MANUAL]: 'Manual',
};

const SORT_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  [DB.SORT_NEWEST]: 'time-outline',
  [DB.SORT_ALPHA]: 'text-outline',
  [DB.SORT_MANUAL]: 'reorder-three-outline',
};

/**
 * Settings shared by all three sortable sections.
 *
 * customHandle: the drag gesture lives on Card's own "≡" icon (see
 * Sortable.Handle there), not on the whole card. The card also carries its
 * own swipe-to-delete Pan gesture, and without a dedicated handle both
 * gestures sat on the same touch - Android had to arbitrate between them
 * before either would move, which was the pause right before every lift.
 *
 * The activation delay is the long press on that handle that picks a card up.
 * The fail offset is how far the finger may stray during that press before
 * the drag is called off.
 *
 * Autoscroll is slow deliberately: at the library's default the list flies
 * past whatever you were reaching for.
 */
const SORTABLE = {
  columns: 1,
  rowGap: T.CARD_GAP,
  customHandle: true,
  dragActivationDelay: 220,
  dragActivationFailOffset: 6,
  overDrag: 'none',
  activeItemScale: 1.02,
  activeItemOpacity: 0.9,
  activeItemShadowOpacity: 0.15,
  // The library dims every card except the one being carried. The point here
  // is to keep the rest readable while you decide where the card is going.
  inactiveItemOpacity: 1,
  autoScrollActivationOffset: 90,
  autoScrollMaxVelocity: 350,
  // Cards below a folding one follow its height directly instead of running
  // an animation of their own towards it.
  //
  // On the default setting every card animates itself to each new position it
  // is given, over a duration that has nothing to do with the fold's. A fold
  // hands out a new position every frame, so each card spent its whole time
  // chasing a target that had already moved on - it arrived long after the
  // description had finished opening, which is what looked like the list
  // sliding in late. Following the measured layout has no duration to be
  // wrong: the neighbours move exactly as far and as fast as the card grows.
  //
  // Reordering still animates - this only takes the animation away while
  // nothing is being dragged.
  itemsLayoutTransitionMode: 'reorder',
} as const;

export default function ListScreen() {
  const [areas, setAreas] = useState<DB.Area[]>([]);
  const [rogue, setRogue] = useState<DB.Task[]>([]);
  const [byArea, setByArea] = useState<Record<number, DB.Task[]>>({});
  const [areaSort, setAreaSort] = useState<string>(DB.SORT_NEWEST);
  const [rogueSort, setRogueSort] = useState<string>(DB.SORT_NEWEST);
  const [showRail, setShowRail] = useState(false);

  // The task list currently being reordered ('rogue' or `area:<id>`), or null.
  // While it is set, every card in that same list folds its description and
  // clips its name - see the note on Card's forceCollapsed prop.
  const [collapseSection, setCollapseSection] = useState<string | null>(null);

  // Which descriptions are folded away. It lives out here because cards are
  // rebuilt on every refresh, and in the database because it should still be
  // true tomorrow: a card nobody has closed is open, and one closed last night
  // is still closed this morning.
  const [closed, setClosed] = useState<Record<string, true>>({});

  const [editingArea, setEditingArea] = useState<{ open: boolean; area: DB.Area | null }>(
    { open: false, area: null },
  );
  const [editingTask, setEditingTask] = useState<{
    open: boolean;
    task: DB.Task | null;
    areaId: number | null;
  }>({ open: false, task: null, areaId: null });

  // An animated ref, not a plain one: the sortable sections read the scroll
  // position from the UI thread to drive their own autoscrolling.
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const offsets = useRef<Record<string, number>>({});

  const refresh = useCallback(async () => {
    const nextAreas = await DB.listAreas();
    const nextRogue = await DB.listTasks(null);
    const map: Record<number, DB.Task[]> = {};
    for (const area of nextAreas) map[area.id] = await DB.listTasks(area.id);
    setAreas(nextAreas);
    setRogue(nextRogue);
    setByArea(map);
    setAreaSort(await DB.getState('area_sort_mode'));
    setRogueSort(await DB.getState('rogue_sort_mode'));
    setClosed(await DB.closedCards());
    setShowRail((await DB.getState(DB.SHOW_RAIL)) === '1');
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Also reload when another screen writes - a restore from the trash lands
  // here without the screen having to be rebuilt from scratch.
  useDataChange(refresh);

  const toggleCard = (key: string) => {
    const nowClosed = !closed[key];
    setClosed((prev) => {
      const next = { ...prev };
      if (nowClosed) next[key] = true;
      else delete next[key];
      return next;
    });
    DB.setCardClosed(key, nowClosed);
  };

  const jump = (key: string) => {
    const y = offsets.current[key];
    if (y != null) scrollRef.current?.scrollTo({ y: Math.max(0, y - 8), animated: true });
  };

  // ------------------------------------------------------------- sorting

  const cycleSort = async (
    current: string,
    apply: (next: DB.SortMode) => Promise<void>,
  ) => {
    const at = DB.SORT_CYCLE.indexOf(current as DB.SortMode);
    await apply(DB.SORT_CYCLE[(at + 1) % DB.SORT_CYCLE.length]);
    refresh();
  };

  // ------------------------------------------------------------- rendering

  const renderArea: SortableGridRenderItem<DB.Area> = ({ item }) => (
    <Card
      name={item.name}
      description={item.description}
      bodyColor={item.color}
      open={!closed[`area:${item.id}`]}
      onToggle={() => toggleCard(`area:${item.id}`)}
      onOpen={() => setEditingArea({ open: true, area: item })}
      onDelete={async () => {
        await DB.trashArea(item.id);
        dataChanged();
      }}
      railSpacing={showRail}
    />
  );

  const renderTask: SortableGridRenderItem<DB.Task> = ({ item }) => {
    const sectionKey = item.area_id == null ? 'rogue' : `area:${item.area_id}`;
    return (
      <Card
        name={item.name}
        description={item.description}
        bodyColor={T.TASK_CARD}
        open={!closed[`task:${item.id}`]}
        onToggle={() => toggleCard(`task:${item.id}`)}
        onOpen={() => setEditingTask({ open: true, task: item, areaId: item.area_id })}
        onDelete={async () => {
          await DB.trashTask(item.id);
          dataChanged();
        }}
        rounded
        forceCollapsed={collapseSection === sectionKey}
        railSpacing={showRail}
      />
    );
  };

  return (
    // The portal is what keeps a lifted card from being clipped by the
    // ScrollView it's dragged inside. Sortables normally draws the active card
    // right where the list puts it, inside the scroll content - so growing it
    // past a neighbour's edge or the section header above it ran straight into
    // whatever was clipping that content (the ScrollView's own viewport, at
    // minimum). While a card is lifted the library teleports its rendering
    // into an absolutely-positioned layer this provider renders as a sibling
    // of the ScrollView instead - outside anything that could clip it - and
    // the layer only intercepts touches exactly where that one card is
    // (pointerEvents: 'box-none' on empty space), so nothing else in the list
    // is blocked while it's up.
    <Sortable.PortalProvider enabled>
      <View style={styles.root}>
        <Animated.ScrollView
          ref={scrollRef}
          contentContainerStyle={{ paddingBottom: T.NAV_HEIGHT + 20 }}
          // Without this the first tap anywhere just dismisses the keyboard and
          // never reaches the button underneath.
          keyboardShouldPersistTaps="handled"
        >
          <QuickCapture areas={areas} onSaved={dataChanged} />

          {/* Everything below the capture block. A touch that starts in here puts
            the keyboard away, which is also what folds the capture drawer shut;
            capturing and returning false means the touch still reaches whatever
            it landed on. The block itself is outside, or tapping into its own
            description field would close it. */}
          <View
            onStartShouldSetResponderCapture={() => {
              Keyboard.dismiss();
              return false;
            }}
          >
            <SectionRule gap={T.RULE_GAP_FIXED} />

            <SectionHeader
              label="Areas"
              sort={areaSort}
              onSort={() =>
                cycleSort(areaSort, (next) => DB.setState('area_sort_mode', next))
              }
              onAdd={() => setEditingArea({ open: true, area: null })}
              onLayoutY={(y) => (offsets.current['areas'] = y)}
              railSpacing={showRail}
            />
            {areas.length ? (
              <Sortable.Grid
                {...SORTABLE}
                data={areas}
                keyExtractor={(a) => `area-${a.id}`}
                renderItem={renderArea}
                scrollableRef={scrollRef}
                onDragEnd={async ({ data }) => {
                  // Show the new arrangement at once and only then write it.
                  // Waiting for the database meant the list snapped back to the
                  // old order for a second before the reload caught up.
                  setAreas(data);
                  setAreaSort(DB.SORT_MANUAL);
                  // Dragging is itself the switch into manual mode.
                  await DB.setState('area_sort_mode', DB.SORT_MANUAL);
                  await DB.reorder(
                    'areas',
                    data.map((a) => a.id),
                  );
                }}
              />
            ) : (
              <Empty
                message="You haven't yet created any areas"
                onAdd={() => setEditingArea({ open: true, area: null })}
              />
            )}
            <SectionRule gap={T.RULE_GAP_FIXED} />

            <SectionHeader
              label="Rogue Tasks"
              sort={rogueSort}
              onSort={() =>
                cycleSort(rogueSort, (next) => DB.setState('rogue_sort_mode', next))
              }
              onAdd={() => setEditingTask({ open: true, task: null, areaId: null })}
              onLayoutY={(y) => (offsets.current['rogue'] = y)}
              railSpacing={showRail}
            />
            {rogue.length ? (
              <Sortable.Grid
                {...SORTABLE}
                data={rogue}
                keyExtractor={(t) => `rogue-${t.id}`}
                renderItem={renderTask}
                scrollableRef={scrollRef}
                onDragStart={() => setCollapseSection('rogue')}
                onDragEnd={async ({ data }) => {
                  setCollapseSection(null);
                  setRogue(data);
                  setRogueSort(DB.SORT_MANUAL);
                  await DB.setState('rogue_sort_mode', DB.SORT_MANUAL);
                  await DB.reorder(
                    'tasks',
                    data.map((t) => t.id),
                  );
                }}
              />
            ) : (
              <Empty
                message="No rogue tasks yet"
                onAdd={() => setEditingTask({ open: true, task: null, areaId: null })}
              />
            )}
            <SectionRule gap={T.RULE_GAP_FIXED} />

            {areas.map((area, position) => (
              // The offset is measured on the wrapper, not on the header inside it:
              // a child's layout.y is relative to its parent, so the header's own
              // was always ~0 and the rail's dot jumped to the top of the list.
              <View
                key={area.id}
                onLayout={(e) =>
                  (offsets.current[`area:${area.id}`] = e.nativeEvent.layout.y)
                }
              >
                <SectionHeader
                  label={area.name}
                  suffix=" tasks"
                  accent={area.color}
                  sort={area.task_sort_mode}
                  onSort={() =>
                    cycleSort(area.task_sort_mode, (next) =>
                      DB.updateArea(area.id, { task_sort_mode: next }),
                    )
                  }
                  onAdd={() =>
                    setEditingTask({ open: true, task: null, areaId: area.id })
                  }
                  onShare={() => shareArea(area, byArea[area.id] ?? [])}
                  railSpacing={showRail}
                />
                {(byArea[area.id] ?? []).length ? (
                  <Sortable.Grid
                    {...SORTABLE}
                    data={byArea[area.id]}
                    keyExtractor={(t) => `t-${t.id}`}
                    renderItem={renderTask}
                    scrollableRef={scrollRef}
                    onDragStart={() => setCollapseSection(`area:${area.id}`)}
                    onDragEnd={async ({ data }) => {
                      setCollapseSection(null);
                      setByArea((prev) => ({ ...prev, [area.id]: data }));
                      setAreas((prev) =>
                        prev.map((a) =>
                          a.id === area.id ? { ...a, task_sort_mode: DB.SORT_MANUAL } : a,
                        ),
                      );
                      await DB.updateArea(area.id, { task_sort_mode: DB.SORT_MANUAL });
                      await DB.reorder(
                        'tasks',
                        data.map((t) => t.id),
                      );
                    }}
                  />
                ) : (
                  <Empty
                    message="No tasks here yet"
                    onAdd={() =>
                      setEditingTask({ open: true, task: null, areaId: area.id })
                    }
                  />
                )}
                {/* No line under the last one - there is nothing left to separate. */}
                {position < areas.length - 1 && <SectionRule gap={T.RULE_GAP_AREA} />}
              </View>
            ))}
          </View>
        </Animated.ScrollView>

        {/* Fixed rail: one dot per destination, stays put while the list scrolls.
          Off by default - see the Display toggle in Settings. */}
        {showRail && (
          <View style={styles.rail} pointerEvents="box-none">
            <Dot label="A" color={T.NEUTRAL_GREY} onPress={() => jump('areas')} />
            <Dot label="R" color={T.NEUTRAL_GREY} onPress={() => jump('rogue')} />
            {areas.slice(0, T.MAX_AREAS).map((a) => (
              <Dot
                key={a.id}
                label={(a.name.trim()[0] ?? '?').toUpperCase()}
                color={a.color}
                onPress={() => jump(`area:${a.id}`)}
              />
            ))}
          </View>
        )}

        <AreaEditor
          visible={editingArea.open}
          area={editingArea.area}
          onClose={() => setEditingArea({ open: false, area: null })}
          onChanged={dataChanged}
        />
        <TaskEditor
          visible={editingTask.open}
          task={editingTask.task}
          areaId={editingTask.areaId}
          areas={areas}
          onClose={() => setEditingTask({ open: false, task: null, areaId: null })}
          onChanged={dataChanged}
        />
      </View>
    </Sortable.PortalProvider>
  );
}

// ---------------------------------------------------------------- pieces

/**
 * Name and + sit together on a solid band in the section's own colour, muted
 * and darkened so the pair reads as one control: the + belongs to that name,
 * not to the row. The sort button keeps its place on the right, held clear of
 * the floating rail.
 */
function SectionHeader({
  label,
  suffix = '',
  accent,
  sort,
  onSort,
  onAdd,
  onShare,
  onLayoutY,
  railSpacing = false,
}: {
  label: string;
  suffix?: string;
  accent?: string;
  sort: string;
  onSort: () => void;
  onAdd: () => void;
  onShare?: () => void;
  onLayoutY?: (y: number) => void;
  railSpacing?: boolean;
}) {
  // The band keeps the area's own colour; the darker, greyer version of it goes
  // to the + alone. This is the same shade Card gives its own name pill in the
  // areas list, so the + and that pill read as one colour even though this
  // band does not.
  const band = accent ?? T.NEUTRAL_GREY;
  const ink = T.readableOn(band);
  const plus = T.pressableColor(band);
  const plusInk = T.readableOn(plus);

  return (
    <View onLayout={(e) => onLayoutY?.(e.nativeEvent.layout.y)}>
      <View
        style={[
          styles.header,
          // Only the rail's own physical footprint is reserved here - fixed,
          // because letting it shrink means the sort button actually sits
          // under a dot. The 9px of breathing room past that (matching the
          // gap the share and sort buttons keep between each other) is a
          // sibling further down, not part of this padding, because it is
          // allowed to give way to a name that needs the room, which a
          // padding never would.
          { paddingRight: railSpacing ? T.RAIL_WIDTH - 10 : T.EDGE_GAP },
        ]}
      >
        {/* The fill is as wide as the name and no wider. A long name wraps
            inside it rather than stretching it across the row. */}
        <View style={[styles.band, { backgroundColor: band }]}>
          {/* The name carries the weight; the "tasks" after it is plain, so
              the two do not read as one long title. */}
          <Text style={[styles.headerText, { color: ink }]}>
            <Text style={[styles.headerName, accent ? styles.headerAccent : null]}>
              {label}
            </Text>
            {suffix}
          </Text>
        </View>

        {/* Beside the name but not on it: its own circle in the same darker
            colour, next to the section it adds to rather than off at the far
            side of the row with the controls that act on the whole list. */}
        <Pressable
          onPress={onAdd}
          hitSlop={8}
          style={[styles.bandAdd, { backgroundColor: plus }]}
        >
          <Ionicons name="add" size={20} color={plusInk} />
        </Pressable>

        <View style={styles.gap} />

        <View style={styles.headerActions}>
          {onShare && (
            <Pressable onPress={onShare} hitSlop={8} style={styles.iconButton}>
              <Ionicons name="share-social-outline" size={17} color="#000000DE" />
            </Pressable>
          )}
          <Pressable onPress={onSort} style={styles.sortButton} hitSlop={6}>
            <Ionicons name={SORT_ICONS[sort]} size={16} color="#000000DE" />
            <Text style={styles.sortLabel}>{SORT_LABELS[sort]}</Text>
          </Pressable>
        </View>

        {/* The soft half of the rail gap - see the note on this row's own
            paddingRight. Shrinks toward nothing before the name gives up any
            more of its own line, rather than sitting there unclaimed. */}
        {railSpacing && <View style={styles.railBuffer} />}
      </View>
    </View>
  );
}

/**
 * Closes off the section above it. See RULE_GAP_FIXED in theme.ts.
 *
 * The top gap is always one card-gap, the same distance the cards keep from
 * each other - a sortable section's own rowGap only falls between rows, never
 * after the last one, so the space above every rule has to be added here
 * instead of coming from the section's last card.
 */
function SectionRule({ gap }: { gap: number }) {
  return (
    <>
      <View style={{ height: T.CARD_GAP }} />
      <View style={styles.rule} />
      <View style={{ height: gap }} />
    </>
  );
}

function Empty({ message, onAdd }: { message: string; onAdd: () => void }) {
  return (
    <Pressable onPress={onAdd} style={styles.empty}>
      <Text style={{ color: T.TEXT_MUTED }}>{message}</Text>
      <Ionicons name="add" size={20} color={T.ACCENT} />
    </Pressable>
  );
}

function Dot({
  label,
  color,
  onPress,
}: {
  label: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.dot, { backgroundColor: color }]}>
      <Text style={styles.dotText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.PAGE_BG, paddingHorizontal: T.PAGE_PADDING },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 4,
    // paddingRight is applied inline: only when the rail is showing, or it
    // sits on top of the sort button.
  },
  // Square, deliberately: the rounded shape now belongs to the task cards.
  band: {
    flexShrink: 1,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  bandAdd: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
    flexShrink: 0,
  },
  // Holds the sort and share buttons out at the right edge without dragging
  // the + along with them. No minimum: a name that needs the room may as
  // well have all of it, down to nothing between the + and the buttons.
  gap: { flex: 1 },
  // The soft half of the rail gap - see the note where this is used.
  railBuffer: { width: 9, flexShrink: 1 },
  headerText: { fontSize: 19, flexShrink: 1 },
  headerName: { fontWeight: 'bold' },
  headerAccent: { fontStyle: 'italic' },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 8,
    // Never squeezed by a long name - the name wraps instead.
    flexShrink: 0,
  },
  iconButton: { paddingHorizontal: 5 },
  sortButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 4,
  },
  sortLabel: { fontSize: 12 },
  rule: { height: 1, backgroundColor: T.RULE_COLOR },
  empty: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
    padding: 8,
  },
  rail: {
    position: 'absolute',
    right: 4,
    top: 0,
    bottom: T.NAV_HEIGHT,
    justifyContent: 'center',
    gap: 8,
  },
  dot: {
    width: T.RAIL_DOT_SIZE,
    height: T.RAIL_DOT_SIZE,
    borderRadius: T.RAIL_DOT_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotText: { color: '#FFFFFF', fontSize: 13, fontWeight: 'bold' },
});
