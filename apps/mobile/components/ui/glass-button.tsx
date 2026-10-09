import type { ComponentProps, ReactNode } from "react";
import { Pressable, StyleSheet } from "react-native";
import type Ionicons from "@react-native-vector-icons/ionicons";
import { NativeSymbol } from "../native-symbol";
import { useMobileTokens } from "../../lib/native";

type GlassButtonProps = {
  onPress: () => void;
  accessibilityLabel: string;
  ios: string;
  android: ComponentProps<typeof Ionicons>["name"];
  size?: number;
  iconSize?: number;
  active?: boolean;
  primary?: boolean;
  children?: ReactNode;
};

/**
 * Circular 44pt bar button. Press feedback lands on press-in (background
 * highlight, never scale on rows; subtle opacity here), with a selection
 * tick on the same frame. One accent only: primary = inverted CTA.
 */
export function GlassButton({
  onPress,
  accessibilityLabel,
  ios,
  android,
  size = 44,
  iconSize = 18,
  active = false,
  primary = false,
  children,
}: GlassButtonProps) {
  const tokens = useMobileTokens();
  const backgroundColor = primary
    ? tokens.primary
    : active
      ? tokens.accent
      : `${tokens.card}E6`;
  const foreground = primary ? tokens.primaryForeground : tokens.foreground;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: active }}
      hitSlop={6}
      // Wire expo-haptics selection tick here when the dep lands
      // (native-controls law: haptics are punctuation, same frame as visual).
      onPress={onPress}
      style={({ pressed }) => [
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderCurve: "continuous",
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: primary ? "transparent" : tokens.border,
          backgroundColor,
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      {children ?? (
        <NativeSymbol ios={ios} android={android} size={iconSize} color={foreground} />
      )}
    </Pressable>
  );
}
