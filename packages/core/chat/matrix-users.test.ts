import { describe, expect, it } from "vitest";
import {
  displayNameForMatrixSender,
  matrixUserIdForMember,
  parseStoredMatrixSession,
} from "./matrix-users";

describe("matrix-users", () => {
  const session = {
    user_id: "@01abc:localhost",
    access_token: "tok",
    base_url: "http://127.0.0.1:8008",
    home_server: "localhost",
  };

  it("builds matrix user id from uniwork member id", () => {
    expect(matrixUserIdForMember("01XYZ", session)).toBe("@01xyz:localhost");
  });

  it("maps matrix sender to display name", () => {
    expect(
      displayNameForMatrixSender("@01abc:localhost", [
        { user_id: "01ABC", display_name: "An" },
      ]),
    ).toBe("An");
  });

  it("parses stored matrix session", () => {
    const raw = JSON.stringify(session);
    expect(parseStoredMatrixSession(raw)?.access_token).toBe("tok");
    expect(parseStoredMatrixSession("bad")).toBeNull();
  });
});
