import type { ComponentProps, ReactNode } from "react";
import * as Haptics from "expo-haptics";
import { Pressable } from "react-native";
import type Ionicons from "@react-native-vector-icons/ionicons";
import { Glass } from "./glass";
import { useMobileTokens } from "../../lib/native";
import { NativeSymbol } from "../native-symbol";

type GlassButtonProps = {
  onPress: () => void;
  accessibilityLabel: string;
  ios: string;
  android: ComponentProps<typeof Ionicons>["name"];
  size?: number;
  iconSize?: number;
  active?: boolean;
  primary?: boolean;
  disabled?: boolean;
  children?: ReactNode;
};

/**
 * Circular liquid-glass bar button. One accent only: primary is the inverted
 * CTA. Press feedback is opacity-only per DESIGN.MD (no scale pops); the
 * haptics tick lands on the same frame as the visual.
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
  disabled = false,
  children,
}: GlassButtonProps) {
  const tokens = useMobileTokens();
  if (primary) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled }}
        disabled={disabled}
        hitSlop={6}
        onPress={() => {
          void Haptics.selectionAsync().catch(() => undefined);
          onPress();
        }}
        style={({ pressed }) => ({
          width: size,
          height: size,
          borderRadius: size / 2,
          borderCurve: "continuous",
          backgroundColor: tokens.primary,
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        })}
      >
        {children ?? (
          <NativeSymbol
            ios={ios}
            android={android}
            size={iconSize}
            color={tokens.primaryForeground}
          />
        )}
      </Pressable>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: active, disabled }}
      disabled={disabled}
      hitSlop={6}
      onPress={() => {
        void Haptics.selectionAsync().catch(() => undefined);
        onPress();
      }}
      style={({ pressed }) => ({
        width: size,
        height: size,
        opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
      })}
    >
      <Glass
        interactive
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {children ?? <NativeSymbol ios={ios} android={android} size={iconSize} />}
      </Glass>
    </Pressable>
  );
}
