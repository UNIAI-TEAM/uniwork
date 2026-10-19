// `DocumentWorkspace` and `DocumentDetailView` mount the page editor through
// React.lazy, so the first render in a file pulls the whole TipTap chunk
// inside the findBy budget. On a loaded runner that import ran past the 15 s
// findEditor timeout — "Unable to find role=textbox" with only the Suspense
// skeleton mounted (see commit 216831797, same fix on a sibling branch).
// Importing this file statically loads the chunk while the test file itself
// evaluates, outside any test or findBy budget; the lazy() call inside a
// render then resolves from this file's module cache, so findBy only waits
// on rendering. A beforeAll that awaits the same import works too (216831797); a static import here covers every
// page-editor test file with one line.
import "../documents/document-editor";
