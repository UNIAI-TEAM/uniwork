import assert from "node:assert/strict";
import test from "node:test";
import { attachmentIdsIn, collectAttachmentIds, rewriteAttachmentUrls } from "./files.mjs";

const ID = "01a139b4-050f-709d-91a1-e4018b8ee2fd";
const ABSOLUTE = `https://uniai.unicomhub.com/api/attachments/${ID}/download`;
const RELATIVE = `/api/attachments/${ID}/download`;

test("attachment ids come from UniAI download links only", () => {
  const text = `![image.png](${ABSOLUTE}) và ${RELATIVE} và /api/v1/attachments/att-uw/download`;
  assert.deepEqual(attachmentIdsIn(text), [ID]);
});

test("rewrite points a UniAI download link at the UniWork attachment", () => {
  const map = { [ID]: "att-uw" };
  assert.equal(
    rewriteAttachmentUrls(`Xem ![image.png](${ABSOLUTE})`, map),
    "Xem ![image.png](/api/v1/attachments/att-uw/download)",
  );
  assert.equal(
    rewriteAttachmentUrls(`Xem ${RELATIVE}`, map),
    "Xem /api/v1/attachments/att-uw/download",
  );
  assert.equal(rewriteAttachmentUrls(ABSOLUTE, {}), ABSOLUTE);
});

test("collect reads the description, comments, and issue attachments", () => {
  const other = "01a139b2-da35-7a74-9e83-3a1463486b95";
  const ids = collectAttachmentIds(
    {
      description: `![image.png](${ABSOLUTE})`,
      attachments: [{ id: other, filename: "note.pdf" }],
    },
    [{ content: `thêm ${RELATIVE}` }],
  );
  assert.deepEqual(ids, [ID, other]);
});
