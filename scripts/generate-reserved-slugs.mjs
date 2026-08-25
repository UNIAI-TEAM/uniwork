import { readFileSync, writeFileSync } from "node:fs";
const list = JSON.parse(readFileSync("server/internal/service/reserved_slugs.json", "utf8"));
const out = `// GENERATED from server/internal/service/reserved_slugs.json — pnpm generate:reserved-slugs
export const RESERVED_SLUGS = ${JSON.stringify(list.sort(), null, 2)} as const;
`;
writeFileSync("packages/core/paths/reserved-slugs.ts", out);
console.log("wrote packages/core/paths/reserved-slugs.ts");
