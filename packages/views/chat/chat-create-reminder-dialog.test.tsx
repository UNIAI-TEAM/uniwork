import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { beforeAll, describe, expect, it, vi } from "vitest";

import { initI18n } from "@uniwork/core/i18n";

import { wrap } from "../test/api-mock";

import { ChatCreateReminderDialog } from "./chat-create-reminder-dialog";



const mutateAsync = vi.fn().mockResolvedValue({ id: "msg1" });



vi.mock("@uniwork/core/chat", () => ({

  useSendChatRoomMessage: () => ({

    mutateAsync,

    isPending: false,

  }),

}));



vi.mock("sonner", () => ({

  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },

}));



beforeAll(() => {

  initI18n();

});



describe("ChatCreateReminderDialog", () => {

  it("creates a reminder through the chat API", async () => {

    mutateAsync.mockClear();



    render(

      wrap(

        <ChatCreateReminderDialog

          open

          onOpenChange={vi.fn()}

          workspaceId="ws1"

          roomId="room1"

        />,

      ),

    );



    fireEvent.change(screen.getByLabelText("Nhập nội dung"), {

      target: { value: "Họp lúc 9h" },

    });

    fireEvent.click(screen.getByRole("button", { name: "Tạo nhắc hẹn" }));



    await waitFor(() => {

      expect(mutateAsync).toHaveBeenCalledWith(

        expect.objectContaining({

          roomId: "room1",

          reminder: expect.objectContaining({

            body: "Họp lúc 9h",

            repeat: "none",

          }),

        }),

      );

    });

  });



  it("shows custom datetime picker when Other is selected", () => {

    render(

      wrap(

        <ChatCreateReminderDialog

          open

          onOpenChange={vi.fn()}

          workspaceId="ws1"

          roomId="room1"

        />,

      ),

    );



    fireEvent.click(screen.getByRole("button", { name: "Khác" }));

    expect(screen.getByLabelText("Chọn ngày nhắc hẹn")).toBeInTheDocument();

  });

});

