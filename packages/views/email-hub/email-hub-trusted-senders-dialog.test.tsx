import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useEmailHubTrustedSendersStore } from "@uniwork/core/email-hub/trusted-senders";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { EmailHubTrustedSendersDialog } from "./email-hub-trusted-senders-dialog";

initI18n();

beforeEach(() => useEmailHubTrustedSendersStore.setState({ senders: {} }));

describe("EmailHubTrustedSendersDialog", () => {
  it("lists this mailbox's trusted senders and removes one", () => {
    const store = useEmailHubTrustedSendersStore.getState();
    store.setTrusted("acc1", "news@shop.vn", true);
    store.setTrusted("acc1", "hr@corp.vn", true);
    store.setTrusted("acc2", "other@x.vn", true);
    render(wrap(<EmailHubTrustedSendersDialog accountId="acc1" open onOpenChange={() => {}} />));

    expect(screen.getByText("news@shop.vn")).toBeInTheDocument();
    expect(screen.queryByText("other@x.vn")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Bỏ news@shop.vn" }));
    expect(screen.queryByText("news@shop.vn")).not.toBeInTheDocument();
    expect(useEmailHubTrustedSendersStore.getState().senders.acc1).toEqual(["hr@corp.vn"]);
  });

  it("says how to add one when the list is empty", () => {
    render(wrap(<EmailHubTrustedSendersDialog accountId="acc1" open onOpenChange={() => {}} />));
    expect(screen.getByText(/Chưa có người gửi nào/)).toBeInTheDocument();
  });
});
