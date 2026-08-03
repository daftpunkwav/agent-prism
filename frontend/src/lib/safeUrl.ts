/** 仅允许 http(s) 外链，防止 javascript: 点击 XSS。 */
export function safeHttpUrl(raw: string): string | null {
  const text = (raw || "").trim();
  if (!text) return null;
  try {
    const u = new URL(text);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}
