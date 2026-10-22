function downloadLink() {
  return /(?:https?:\/\/uniai\.unicomhub\.com)?\/api\/attachments\/([0-9A-Za-z-]+)\/download/g;
}

export function attachmentIdsIn(text) {
  const ids = [];
  for (const match of String(text ?? "").matchAll(downloadLink())) {
    if (!ids.includes(match[1])) ids.push(match[1]);
  }
  return ids;
}

export function rewriteAttachmentUrls(text, map) {
  return String(text ?? "").replace(downloadLink(), (full, id) => (
    map[id] ? `/api/v1/attachments/${map[id]}/download` : full
  ));
}

export function collectAttachmentIds(issue, comments) {
  const ids = attachmentIdsIn(issue?.description);
  for (const comment of comments ?? []) {
    for (const id of attachmentIdsIn(comment?.content)) {
      if (!ids.includes(id)) ids.push(id);
    }
  }
  for (const attachment of issue?.attachments ?? []) {
    const candidates = [
      attachment?.id,
      ...attachmentIdsIn(attachment?.download_url),
      ...attachmentIdsIn(attachment?.markdown_url),
      ...attachmentIdsIn(attachment?.url),
    ];
    for (const id of candidates) {
      if (id && !ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}
