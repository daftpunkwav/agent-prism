/**
 * @file language
 * @description UI-locale helpers for server-generated prose.
 *
 * Responsibilities:
 * - Whitelist Chinese locale tags in one place (client-controlled input must
 *   never reach a prompt verbatim — an arbitrary string would be an injection
 *   surface)
 * - Provide the agent reply-language directive for prompt assembly
 */

/**
 * True when the locale tag denotes Chinese (zh-CN / zh). The arena UI ships
 * exactly two locales ("en" / "zh-CN"); anything unknown reads as non-Chinese.
 */
export function isChineseLocale(language: string | undefined): boolean {
  return language === "zh-CN" || language === "zh";
}

/**
 * System-prompt directive pinning the agent's reply language. Empty for
 * non-Chinese locales: models mirror the user's language naturally, and an
 * explicit English rule would fight that. Chinese needs the pin because an
 * all-English system prompt pulls even Chinese questions toward English replies.
 */
export function agentReplyDirective(language: string | undefined): string {
  if (!isChineseLocale(language)) return "";
  return "\n\nRespond in Simplified Chinese (简体中文); keep code, identifiers, file paths, and commands as-is.";
}
