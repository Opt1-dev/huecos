// Keyword matching for "Action requise" (shared by check-mail and the tests).

export interface Keyword {
  keyword: string;
  /** Only mails whose sender address or name contains this. */
  sender: string | null;
}

export interface MailText {
  subject: string;
  body: string;
  senderName: string;
  senderAddress: string;
}

export interface MailMatch {
  keywords: string[];
  snippet: string;
}

const SNIPPET_MAX = 240;

/** Lower case, no accents, single spaces. */
export function foldText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Mail HTML (or text) → plain text: tags, scripts, styles and entities removed. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/[ \t\r\f\v]+/g, ' ')
    .trim();
}

/**
 * The keywords found in the subject or text (case and accents ignored), with
 * an excerpt around the first one found. null when nothing matches.
 */
export function matchMail(mail: MailText, keywords: readonly Keyword[]): MailMatch | null {
  const subject = mail.subject.replace(/\s+/g, ' ').trim();
  const body = mail.body.replace(/\s+/g, ' ').trim();
  const foldedSubject = foldText(subject);
  const foldedBody = foldText(body);
  const sender = foldText(`${mail.senderName} ${mail.senderAddress}`);

  const found: string[] = [];
  let first: { inSubject: boolean; at: number; length: number } | null = null;
  for (const k of keywords) {
    const word = foldText(k.keyword);
    if (!word) continue;
    if (k.sender && !sender.includes(foldText(k.sender))) continue;
    const inSubject = foldedSubject.indexOf(word);
    const inBody = foldedBody.indexOf(word);
    if (inSubject < 0 && inBody < 0) continue;
    if (!found.includes(k.keyword.trim())) found.push(k.keyword.trim());
    if (!first) first = inBody >= 0 ? { inSubject: false, at: inBody, length: word.length } : { inSubject: true, at: inSubject, length: word.length };
  }
  if (!first) return null;
  return { keywords: found, snippet: excerpt(first.inSubject ? subject : body, first.at, first.length) };
}

/**
 * About SNIPPET_MAX characters around a match. Folding keeps the length for
 * accented Latin text, so the index found in the folded text fits the original.
 */
function excerpt(text: string, at: number, length: number): string {
  const room = Math.max(0, Math.floor((SNIPPET_MAX - length) / 2));
  let start = Math.max(0, at - room);
  let end = Math.min(text.length, at + length + room);
  // Don't cut words in half.
  if (start > 0) {
    const space = text.indexOf(' ', start);
    if (space >= 0 && space < at) start = space + 1;
  }
  if (end < text.length) {
    const space = text.lastIndexOf(' ', end);
    if (space > at + length) end = space;
  }
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}
