import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { StyleSheet, View } from "react-native";
import { RADII } from "../../lib/design";
import { useMobileTokens } from "../../lib/native";

type GlassProps = {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  tint?: string;
  radius?: number;
};

/**
 * Translucent material surface (liquid-glass fallback without new native deps).
 *
 * Mirrors fable glass.tsx / astra ui.tsx Glass(): on iOS 26 with
 * expo-glass-effect this becomes a native GlassView; here it is a
 * translucent card fill + hairline border so the same call sites upgrade
 * cleanly later. Never give it opacity 0 — that silently disables glass.
 */
export function Glass({ children, style, tint, radius = RADII.lg }: GlassProps) {
  const tokens = useMobileTokens();
  const flat = StyleSheet.flatten(style) ?? {};
  const resolvedRadius =
    typeof flat.borderRadius === "number" ? flat.borderRadius : radius;
  return (
    <View
      style={[
        {
          backgroundColor: tint ?? `${tokens.card}E6`,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: tokens.border,
          borderRadius: resolvedRadius,
          borderCurve: "continuous",
          overflow: "hidden",
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
