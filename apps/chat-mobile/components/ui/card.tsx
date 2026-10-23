// Ported from usf apps/mobile/components/ui/card.tsx.
import * as React from "react";
import { Pressable, View, type PressableProps } from "react-native";
import { continuousCorners } from "@/lib/radius";
import { cn } from "@/lib/utils";

const CardPressable = React.forwardRef<View, PressableProps & { className?: string; children?: React.ReactNode }>(
  ({ className, children, style, ...props }, ref) => (
    <Pressable
      ref={ref as React.Ref<View>}
      className={cn("rounded-xl border border-border bg-card p-4 active:bg-secondary", className)}
      style={typeof style === "function" ? (state) => [continuousCorners, style(state)] : [continuousCorners, style]}
      {...props}
    >
      {children as React.ReactNode}
    </Pressable>
  ),
);
CardPressable.displayName = "CardPressable";

export { CardPressable };
