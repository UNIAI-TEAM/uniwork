import { z } from "zod";

/** One organization data export. Status stays a string so a newer server still renders. */
export const PrivacyExportSchema = z.object({
  id: z.string(),
  status: z.string(),
  row_count: z.number().default(0),
  kind: z.string().default("export"),
  download_url: z.string().optional(),
  error: z.string().optional(),
  created_at: z.string(),
  expires_at: z.string().optional(),
  erases_at: z.string().optional(),
});
export type PrivacyExport = z.infer<typeof PrivacyExportSchema>;
