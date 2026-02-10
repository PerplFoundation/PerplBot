/**
 * Convert HTML report (from ansiToHtml) to plain text.
 * Strips <span> tags and decodes HTML entities.
 */

export function htmlToText(html: string): string {
  return html
    .replace(/<span[^>]*>/g, "")
    .replace(/<\/span>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
