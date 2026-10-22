/**
 * Utility functions for extracting and parsing @[Doc Title](doc:DOC_ID) syntax
 */

export interface MentionedDoc {
  title: string;
  docId: string;
}

const DOC_MENTION_REGEX = /@?\[([^\]]+)\]\(doc:([^)]+)\)/g;

/**
 * Extracts all unique docIds mentioned in a description string.
 */
export function extractMentionedDocIds(description: string = ''): string[] {
  if (!description) return [];
  const ids = new Set<string>();
  const matches = description.matchAll(DOC_MENTION_REGEX);
  for (const match of matches) {
    if (match[2]) {
      ids.add(match[2].trim());
    }
  }
  return Array.from(ids);
}

/**
 * Extracts list of { title, docId } mentioned in a description.
 */
export function extractMentionedDocs(description: string = ''): MentionedDoc[] {
  if (!description) return [];
  const list: MentionedDoc[] = [];
  const seen = new Set<string>();
  const matches = description.matchAll(DOC_MENTION_REGEX);
  for (const match of matches) {
    const title = match[1]?.trim();
    const docId = match[2]?.trim();
    if (docId && !seen.has(docId)) {
      seen.add(docId);
      list.push({ title, docId });
    }
  }
  return list;
}
