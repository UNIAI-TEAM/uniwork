package audit

// ReasonFolderTrashed marks a document.moved row written because the root it sat under - a folder, or since UNI-2074
// any page or file - was trashed by someone who could not manage it (ADR 0037 point 5); metadata.from_kind names the
// root's kind, and a row without it is from a folder.
const ReasonFolderTrashed = "folder_trashed"
