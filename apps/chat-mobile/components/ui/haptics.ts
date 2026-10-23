// The app's touch feedback, for this platform (data/haptics.ts).
import { Platform } from "react-native";
import { createHaptics } from "@/data/haptics";

export const haptics = createHaptics(Platform.OS);
