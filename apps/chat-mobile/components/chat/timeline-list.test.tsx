// Which list a conversation draws (timeline-list.tsx): the inverted FlatList by
// default, FlashList where unichat_mobile_timeline_recycled is on, and the
// choice made once per conversation shown.
import { QueryClient } from "@tanstack/react-query";
import { act, screen } from "@testing-library/react-native";
import { Platform, Text } from "react-native";
import { REMOTE_CONFIG_FALLBACK, remoteConfigKey } from "@/data/remote-config";
import { installReportSink } from "@/data/report";
import type { TimelineRow } from "@/lib/timeline-display";
import { layoutTimeline } from "@/lib/timeline-layout";
import { render } from "@/test/render";
import { TimelineList } from "./timeline-list";

const rows = layoutTimeline([{ id: "m1", sender: "U2", body: "tin 1", ts: Date.UTC(2026, 9, 21, 2, 0) }]).rows;
const renderMessage = (row: Extract<TimelineRow, { type: "message" }>) => <Text>{row.message.body}</Text>;
const ui = <TimelineList rows={rows} renderMessage={renderMessage} loadingOlder={false} onAtLatestChange={jest.fn()} />;

const client = (recycled: boolean) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } });
  queryClient.setQueryData(remoteConfigKey, { ...REMOTE_CONFIG_FALLBACK, flags: { unichat_mobile_timeline_recycled: recycled } });
  return queryClient;
};

const tags = jest.fn();
beforeEach(() => installReportSink({ captureException: jest.fn(), addBreadcrumb: jest.fn(), setUser: jest.fn(), setTag: tags }));
afterEach(() => {
  installReportSink(null);
  tags.mockClear();
});

describe("TimelineList", () => {
  it("draws the inverted FlatList while the switch is off", async () => {
    await render(ui, { queryClient: client(false) });
    expect(screen.getByText("tin 1")).toBeOnTheScreen();
    expect(screen.getByTestId("message-list").props).toMatchObject({ inverted: true });
    expect(tags).toHaveBeenCalledWith("timeline_list", "inverted");
    // iOS: the list's own interactive dismissal, no gesture area.
    expect(screen.queryByTestId("timeline-keyboard-area")).toBeNull();
  });

  it("lets the finger drag the keyboard down from the list on Android", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    await render(ui, { queryClient: client(false) });
    expect(screen.getByTestId("timeline-keyboard-area").props).toMatchObject({ interpolator: "ios" });
    expect(screen.getByTestId("message-list")).toBeOnTheScreen();
    jest.restoreAllMocks();
  });

  it("draws the recycled list where the switch is on, and keeps it while the conversation is shown", async () => {
    const queryClient = client(true);
    await render(ui, { queryClient });
    expect(screen.getByText("tin 1")).toBeOnTheScreen();
    expect(screen.getByTestId("message-list").props).not.toHaveProperty("inverted", true);
    expect(tags).toHaveBeenCalledWith("timeline_list", "recycled");
    await act(async () => {
      queryClient.setQueryData(remoteConfigKey, { ...REMOTE_CONFIG_FALLBACK, flags: { unichat_mobile_timeline_recycled: false } });
    });
    expect(screen.getByTestId("message-list").props).not.toHaveProperty("inverted", true);
  });
});
