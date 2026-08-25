export function AuthCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas p-4">
      <div className="w-full max-w-sm rounded-lg border border-line bg-surface p-6">
        <h1 className="mb-4 text-lg font-semibold text-primary">{title}</h1>
        {children}
      </div>
    </div>
  );
}
