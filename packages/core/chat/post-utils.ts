export const POST_TITLE_MAX_LENGTH = 200;
export const POST_BODY_MAX_LENGTH = 8000;

export function canSubmitPost(title: string, body: string): boolean {
  const trimmedTitle = title.trim();
  const trimmedBody = body.trim();
  return (
    trimmedTitle.length > 0 &&
    trimmedTitle.length <= POST_TITLE_MAX_LENGTH &&
    trimmedBody.length > 0 &&
    trimmedBody.length <= POST_BODY_MAX_LENGTH
  );
}
