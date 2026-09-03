// The two card types share one skeleton, split into tap zones:
//
//   tap the name             -> open the editor
//   tap the chevron, or
//   anything right of it     -> open or close the description
//   long-press               -> pick the card up to drag
//   swipe left               -> drop it in the trash
//
// The swipe is written here rather than taken from a library: the trash has to
// sit *behind* the card rather than above it, the card has to keep moving past
// the point where the delete arms, and it has to give under the finger while it
// does. None of that is expressible through snap points.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Sortable from 'react-native-sortables';
import Animated, {
  Extrapolation,
  interpolate,
  interpolateColor,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import * as T from '../theme';

/** styles.body's paddingVertical, top and bottom. */
const BODY_PADDING = 14;

/** Larger than any card will ever be: a maxHeight that clips nothing. */
const NO_CLIP = 100000;

/** The fold chevron's icon size. Named because foldZone's basis is derived
 * from it - see the note there. */
const CHEVRON_SIZE = 18;

interface Props {
  name: string;
  description: string;
  bodyColor: string;
  /** Open means all of it. There is no half-open state to tap through. */
  open: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onDelete: () => void;
  /** Tasks are rounded, areas are square - see the note in theme.ts. */
  rounded?: boolean;
  /** While a sibling in this same list is being dragged, every card folds its
   * description away and clips its name to two lines - so the list stays
   * short enough that the user never loses track of where they are while it
   * autoscrolls, and can still tell every card apart at a glance. */
  forceCollapsed?: boolean;
  /** Whether the fixed jump rail is showing - if so, the row keeps a little
   * clear of it, so the two read as separated rather than touching. */
  railSpacing?: boolean;
}

function Card(props: Props) {
  const {
    name,
    description,
    bodyColor,
    open,
    onToggle,
    onOpen,
    onDelete,
    rounded = false,
    forceCollapsed = false,
    railSpacing = false,
  } = props;

  const { width } = useWindowDimensions();

  // How tall the description is with nothing clipping it, measured on an
  // invisible twin of the text. The number is what the open and close
  // animations run between - a body that unmounts to close can only be animated
  // open, and one with no height at all cannot be animated in either direction.
  const [textHeight, setTextHeight] = useState(0);

  const hasDescription = description.trim().length > 0;
  // With no chevron to show, the fold zone's reserved gap past the name has
  // nothing left to justify it.
  const trimRow = !hasDescription;
  const measured = textHeight > 0;
  const fullHeight = Math.ceil(textHeight) + BODY_PADDING;

  const target = !measured || !open || forceCollapsed ? 0 : fullHeight;

  // What two lines of the name font actually come to, measured on a two-line
  // string rather than worked out from the line height. Android adds its own
  // font padding on top of whatever line height is asked for, so the
  // calculated figure came out a few pixels short - enough to shave the
  // bottom off the second line of every two-line name in a list being
  // dragged, which is exactly what it looked like: a card quietly shrinking.
  //
  // The string is a fixed two liner, not the name: the height of two lines
  // does not depend on what is written on them, and measuring the real name
  // would only work when the real name happens to wrap to two lines already.
  const [twoLineHeight, setTwoLineHeight] = useState(0);

  const shift = useSharedValue(0);
  const limit = width * T.SWIPE_LIMIT_FRACTION;
  const radius = rounded ? T.CARD_RADIUS : 0;

  // The name row and the body are two separate rows, so sharing the one
  // value is what keeps their right edges lined up rather than each guessing
  // its own.
  //
  // This does not, and cannot, keep the chevron itself clear of a dot - the
  // icon sits a fixed distance past the name (foldZone's own paddingLeft),
  // and a long enough name can still push it right up against one no matter
  // how much room is reserved out here. What this does buy is the row
  // reading as its own thing next to the rail rather than running into it -
  // clearing the rail's own footprint is what does that, not the chevron.
  const edgeGap = railSpacing ? T.RAIL_WIDTH : T.EDGE_GAP;

  const swipe = useMemo(
    () =>
      Gesture.Pan()
        // Leftward only, and only once the finger has clearly committed. The
        // two thresholds are deliberately lopsided: a real swipe has to travel
        // twice as far sideways as it is allowed to drift vertically before it
        // is recognised, while anything with much vertical movement in it
        // fails almost immediately and is handed back to the scroll view.
        // Equal thresholds made it a coin flip on an ordinary upward flick
        // that happened to start on a card - most of the time it "won" the
        // swipe gesture and the list underneath never scrolled at all.
        .activeOffsetX(-20)
        .failOffsetY([-8, 8])
        .onUpdate((event) => {
          const travel = Math.min(0, event.translationX);
          const past = Math.max(0, -travel - limit);
          // Past the limit the card still follows the finger, but slowly, so
          // the stop is felt rather than hit.
          shift.value = past > 0 ? -(limit + past * T.SWIPE_RESISTANCE) : travel;
        })
        .onEnd((_event, success) => {
          // A cancelled swipe - the scroll or a drag took over - only returns
          // the card; it must never be read as an intent to delete.
          if (success && -shift.value >= limit) {
            shift.value = withTiming(-width, { duration: 170 }, (finished) => {
              if (finished) runOnJS(onDelete)();
            });
          } else {
            shift.value = withSpring(0, { damping: 22, stiffness: 240 });
          }
        }),
    [limit, width, onDelete],
  );

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shift.value }],
  }));

  // The backdrop deepens and the icon grows as the delete arms, so the card
  // says whether letting go now will do anything.
  const backdropStyle = useAnimatedStyle(() => ({
    // Hidden outright while the card sits still. Left permanently underneath it
    // was enough to tint anything drawn over it - which is why the description
    // went pink on its way open.
    opacity: -shift.value > 0.5 ? 1 : 0,
    backgroundColor: interpolateColor(-shift.value, [0, limit], ['#EF9A9A', '#E53935']),
  }));

  // The very first height is taken as-is; only the ones after it are animated.
  // Otherwise every card on the screen plays its open animation on load.
  const settled = useRef(false);
  useEffect(() => {
    if (measured) settled.current = true;
  }, [measured]);
  const animateHeight = measured && settled.current;

  // maxHeight, not height: the body keeps its own natural height and this only
  // ever holds it back. A fixed height has to be exactly right or it cuts the
  // text off - which is precisely what kept happening - while a limit that
  // turns out to be too generous does nothing at all.
  //
  // Collapsing for a drag is the one case that is not animated: the list has to
  // re-measure every cell before the drag is armed, and it cannot measure a
  // height that is still on its way somewhere. Opening back up afterwards is
  // animated as usual - by then there is no drag left to confuse.
  const bodyStyle = useAnimatedStyle(() => {
    // Before the first measurement, a closed card has nothing to show yet -
    // clamp it shut rather than let it sit unclamped for that one frame.
    // Sortables remounts a card fresh the instant it is picked up (it moves
    // the whole thing into a portal to drag it, which resets every bit of
    // local state, this measurement included), so a card that was closed
    // used to flash its full description open for a frame on every pickup.
    // An open card has nothing to hide either way, so it is left alone.
    if (!measured) return open && !forceCollapsed ? {} : { maxHeight: 0 };
    if (forceCollapsed) return { maxHeight: 0 };
    return {
      maxHeight: animateHeight ? withTiming(target, { duration: T.FOLD_MS }) : target,
    };
  });

  // Two settings and nothing in between: two lines while the list is being
  // dragged, and otherwise no limit at all.
  //
  // "No limit" is the important half. The name used to be clipped to its own
  // measured height even when nothing was collapsing it, and a measurement
  // that came out even slightly short took a whole line off the end of the
  // name - the last word of a three-line name simply vanished from the card
  // while the editor showed it in full. A limit that only ever exists to
  // collapse something cannot do that.
  const nameBoxStyle = useAnimatedStyle(() => ({
    maxHeight: forceCollapsed && twoLineHeight > 0 ? twoLineHeight : NO_CLIP,
  }));

  const iconStyle = useAnimatedStyle(() => {
    const progress = interpolate(-shift.value, [0, limit], [0, 1], Extrapolation.CLAMP);
    return { opacity: progress, transform: [{ scale: 0.6 + progress * 0.4 }] };
  });

  return (
    <View style={[styles.wrapper, { borderRadius: radius }]}>
      {/* Fills exactly the card's own box, underneath it. */}
      <Animated.View style={[styles.backdrop, backdropStyle]} pointerEvents="none">
        <Animated.View style={iconStyle}>
          <Ionicons name="trash" size={22} color="#FFFFFF" />
        </Animated.View>
      </Animated.View>

      <GestureDetector gesture={swipe}>
        <Animated.View style={cardStyle}>
          <View
            style={[
              styles.nameRow,
              // The area's own colour, not a shade of it - the same one its
              // task-list header uses for its band, so a card and the section
              // it belongs to read as the same colour.
              { backgroundColor: bodyColor },
              // Clear of the rail plus the same gap the chevron already
              // keeps from the name, so the chevron sits the same distance
              // from the rail as it does from the name it follows. Off the
              // rail, it is just the row's own breathing room from the edge.
              { paddingRight: edgeGap },
            ]}
          >
            {/* The one part of the card that picks it up. A long press
                anywhere used to do it, but that put the same touch under two
                gestures at once - this one, and the card's own swipe-to-delete
                Pan - and Android had to sit and arbitrate between them before
                either would move, which is the pause that came right before
                every lift. A dedicated handle means only this small area ever
                offers the drag gesture, so the swipe never has to contend with
                it and starting a drag never has to wait to be recognised. */}
            <Sortable.Handle style={styles.dragHandle}>
              <Ionicons name="reorder-three" size={20} color="rgba(0,0,0,0.45)" />
            </Sortable.Handle>

            {/* The name, and only the name, opens the editor - so it is the
                one part of the row given a fill of its own. */}
            <Pressable
              onPress={onOpen}
              style={[styles.nameZone, { backgroundColor: T.pressableColor(bodyColor) }]}
              hitSlop={4}
            >
              {/* Clipped to two lines' worth of height, not cut off by a fixed
                  numberOfLines, while a sibling is being dragged - otherwise a
                  name worth writing out is worth reading in full, and the row
                  is the only place it is ever shown whole. */}
              <Animated.View style={[styles.nameClip, nameBoxStyle]}>
                <Text style={styles.name}>{name}</Text>
              </Animated.View>

              {/* Invisible two-line ruler. Never shown, never wraps, never
                  depends on the name - see the note on twoLineHeight. */}
              <View style={styles.nameProbe} pointerEvents="none">
                <Text
                  style={styles.name}
                  onLayout={(event) => setTwoLineHeight(event.nativeEvent.layout.height)}
                >
                  {'X\nX'}
                </Text>
              </View>
            </Pressable>

            {/* The chevron follows the name, a little clear of it, and the
                whole empty rest of the row folds with it. Parked at the far
                right it was a 38px target with a dead row either side of it -
                every tap on the empty middle of the row did nothing at all. */}
            {!trimRow && (
              <Pressable onPress={onToggle} style={styles.foldZone}>
                {hasDescription && (
                  <Ionicons
                    name={open ? 'chevron-down' : 'chevron-forward'}
                    size={CHEVRON_SIZE}
                    color="rgba(0,0,0,0.55)"
                  />
                )}
              </Pressable>
            )}
          </View>

          {hasDescription && (
            <Animated.View style={[styles.bodyClip, bodyStyle]}>
              <Pressable
                onPress={onToggle}
                style={[
                  styles.body,
                  { backgroundColor: bodyColor },
                  // Same right edge the name row keeps - see edgeGap.
                  { paddingRight: edgeGap },
                ]}
              >
                {/* Never clamped. Open means the whole thing - the clipping is
                    the container's job and its only setting is "all of it". */}
                <Text style={styles.bodyText}>{description}</Text>
              </Pressable>
            </Animated.View>
          )}

          {/* Invisible twin, laid out at the same width with no clamp, so its
              height is the honest answer to "how tall is all of this?" - the
              visible copy can only report the lines it was allowed to draw. It
              lives outside the clipped body so it keeps being measured even
              while the description is closed.

              The wrapping View is not decoration: pointerEvents is a View prop,
              and a bare Text ignores it. Laid over the whole card, the twin was
              quietly eating every tap meant for the name or the chevron. */}
          {hasDescription && (
            // right matches the body's own paddingRight - edgeGap - so this
            // wraps at the same width the visible copy does. A probe that
            // measures a wider line than the body actually draws reports a
            // height short of what the real, narrower wrap needs.
            <View style={[styles.probeLayer, { right: edgeGap }]} pointerEvents="none">
              <Text
                style={styles.bodyText}
                onLayout={(event) => setTextHeight(event.nativeEvent.layout.height)}
              >
                {description}
              </Text>
            </View>
          )}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

/**
 * Cards are rebuilt whenever anything on the screen changes, and the handlers
 * are fresh closures every time. Comparing only the drawn values keeps one
 * card's toggle or drag from re-rendering every other on the screen - which
 * is a good part of why the list stuttered while a card was being carried.
 */
export default React.memo(
  Card,
  (before, after) =>
    before.name === after.name &&
    before.description === after.description &&
    before.bodyColor === after.bodyColor &&
    before.open === after.open &&
    before.rounded === after.rounded &&
    before.forceCollapsed === after.forceCollapsed &&
    before.railSpacing === after.railSpacing,
);

const styles = StyleSheet.create({
  // No bottom margin: the spacing between cards is the sortable section's
  // rowGap now. A margin here would be counted on top of it.
  wrapper: { overflow: 'hidden' },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingRight: 24,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingLeft: 4,
    gap: 4,
    position: 'relative',
  },
  // Padded past the icon's own bounds - a touch target the size of the icon
  // it's drawn from is smaller than a thumb.
  dragHandle: { padding: 6, margin: -6 },
  // As wide as the name and no wider - it is a fill around the words, not a
  // bar across the row. It still gives way when the name is longer than the
  // row, and the name wraps inside it rather than being cut off.
  nameZone: {
    flexBasis: 'auto',
    flexShrink: 1,
    flexGrow: 0,
    paddingVertical: 4,
    paddingHorizontal: 9,
    borderRadius: 8,
    //borderWidth: 1, borderColor: 'red',
  },
  name: {
    fontSize: 16,
    fontWeight: 'bold',
    fontStyle: 'italic',
    lineHeight: T.NAME_LINE_HEIGHT,
  },
  nameClip: { overflow: 'hidden' },
  // left/right/top: 0, not the nameZone's own padding - it is a direct child
  // of that already-padded Pressable, not a sibling positioned against some
  // other ancestor's box, so 0 already lines it up flush with nameClip.
  nameProbe: { position: 'absolute', left: 0, right: 0, top: 0, opacity: 0 },
  foldZone: {
    // Grows to take the rest of the row, but never shrinks: with plain flex: 1
    // its basis is zero, so a name long enough to fill the row squeezed the
    // chevron down to nothing and it vanished from the card.
    flexBasis: 'auto',
    flexGrow: 1,
    flexShrink: 0,

    //borderWidth: 1, borderColor: 'red',

    //flexBasis: T.EDGE_GAP + CHEVRON_SIZE,
    width: T.EDGE_GAP + CHEVRON_SIZE,
    // A constant gap from the name box, never a centred position: the chevron
    // keeps the same distance from the name whatever the name's length. The
    // basis is that gap plus the icon, so when the name has grown to fill the
    // row and this zone is down to its basis, what is left over on the right
    // is the row's own paddingRight - the same T.EDGE_GAP - and the icon ends
    // up exactly halfway between the name box and the edge of the card.

    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    position:'relative',
    paddingLeft: T.EDGE_GAP,
    //marginRight: -T.RAIL_WIDTH,
  },
  bodyClip: { overflow: 'hidden' },
  body: { paddingHorizontal: 10, paddingVertical: 7 },
  bodyText: { fontSize: 14, lineHeight: T.BODY_LINE_HEIGHT },
  probeLayer: { position: 'absolute', left: 10, right: 10, top: 0, opacity: 0 },
});
