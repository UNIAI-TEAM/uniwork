import { writeFileSync } from "node:fs";
import { lucideDeprecatedAliases } from "./lucide-aliases.mjs";

// Regenerate after bumping lucide-react: pnpm generate:lucide-aliases.
// scripts/lucide-aliases.test.mjs fails while the committed list is stale.
const out = "packages/eslint-config/lucide-aliases.json";
const aliases = lucideDeprecatedAliases();
writeFileSync(out, `${JSON.stringify(aliases, null, 2)}\n`);
console.log(`wrote ${out} (${Object.keys(aliases).length} aliases)`);
