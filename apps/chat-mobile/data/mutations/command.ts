// The mutation layer (audit T4, P2 Kiến trúc). Screens and components change
// server state only through the hooks in data/mutations/*; the lint rule in
// eslint.config.mjs keeps app/ and components/ from importing an endpoint or
// command module. Each hook is one useMutation over a command that knows what
// it does to the cache (data/chat-actions.ts, safety-actions.ts, chat-send.ts,
// pending-ops.ts). Its mutation key names the command, so a failure that is a
// bug reaches crash reporting once under that name (data/query-errors.ts) and
// an expected one (offline, a 4xx, a RefusedError) does not; the screen says
// what failed from mutateAsync's rejection.
//
// Every command runs at once, online or not (`networkMode: "always"`). The
// outbox commands decide that themselves: a send, a retry, a reaction or a
// vote made offline is written to its persisted queue now (chat-send.ts,
// pending-ops.ts) and delivered when the network is back; the rest fail now,
// for the screen to say so. TanStack's default ("online") would hold the
// mutation paused while NetInfo says offline: nothing queued, no bubble, and
// the message lost if the app is killed before the network returns.
import { useMutation, useQueryClient, type QueryClient, type UseMutationResult } from "@tanstack/react-query";

export function useCommand<TVariables, TResult>(
  name: string,
  run: (qc: QueryClient, variables: TVariables) => Promise<TResult>,
): UseMutationResult<TResult, Error, TVariables> {
  const qc = useQueryClient();
  return useMutation({ mutationKey: [name], networkMode: "always", mutationFn: (variables: TVariables) => run(qc, variables) });
}
