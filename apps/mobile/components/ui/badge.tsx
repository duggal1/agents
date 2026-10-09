import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { BadgeVariant } from "../../lib/design";
import { badgeColors, RADII, TYPE } from "../../lib/design";

type BadgeProps = {
  children: ReactNode;
  variant?: BadgeVariant;
};

/**
 * Status badge. 12% tint bg + -300 text, never solid, never bordered.
 * One or two words, sentence case. Default is neutral.
 */
export function Badge({ children, variant = "neutral" }: BadgeProps) {
  const colors = badgeColors(variant);
  return (
    <View
      style={[
        styles.base,
        { backgroundColor: colors.backgroundColor },
      ]}
    >
      <Text style={[styles.label, { color: colors.color }]} numberOfLines={1}>
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: RADII.sm,
    borderCurve: "continuous",
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: "flex-start",
  },
  label: {
    ...TYPE.caption,
  },
});
