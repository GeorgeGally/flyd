// What the message box takes, shared by the page script and the inbox that
// saves it. No imports: the page renders from this without loading the inbox.

export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
/** Design decks and brand books routinely run past 12MB; a dropped document up to this size is taken as it is. */
export const MAX_FILE_BYTES = 32 * 1024 * 1024;

/** The documents the view lets him attach, by extension. */
export const DOCUMENT_EXTENSIONS = [
  "pdf", "docx", "xlsx", "pptx", "odt", "ods", "odp", "doc", "xls", "ppt", "rtf",
  "txt", "md", "markdown", "csv", "tsv", "json", "yaml", "yml", "xml", "html", "htm", "log",
] as const;
export type DocumentExtension = typeof DOCUMENT_EXTENSIONS[number];
