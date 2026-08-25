"use client";
import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { createQueryClient, initI18n } from "@uniwork/core";
import { Toaster } from "@uniwork/ui/components/ui/sonner";

initI18n();

export function Providers({ children }: { children: React.ReactNode }) {
  const [qc] = useState(createQueryClient);
  return (
    <QueryClientProvider client={qc}>
      {children}
      <Toaster />
    </QueryClientProvider>
  );
}
