// What a screen over one list query shows (the workspace picker first). With no rows, three states look alike: not
// answered yet (loading, or paused: TanStack holds a fetch while onlineManager says offline), failed, and answered
// with nothing. Only the last is "you have none". TestFlight build 4 told a person "Bạn chưa ở workspace nào" for a
// query paused offline that never sent its request: `isLoading` is false while paused, and `!data` read as empty.

export type ListView = "loading" | "waiting" | "error" | "empty" | "list";

/** The slice of a TanStack query result this reads. */
interface ListQuerySlice {
  status: "pending" | "error" | "success";
  fetchStatus: "fetching" | "paused" | "idle";
  data: readonly unknown[] | undefined;
}

/** Rows win; then a failure; "empty" only once the server answered with none; "waiting" while paused with nothing. */
export function listView({ status, fetchStatus, data }: ListQuerySlice): ListView {
  if (data !== undefined && data.length > 0) return "list";
  if (status === "error") return "error";
  if (status === "success") return "empty";
  return fetchStatus === "paused" ? "waiting" : "loading";
}
