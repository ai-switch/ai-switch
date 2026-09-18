/**
 * Count Unicode code points, non-whitespace code points, and logical lines.
 * Combining marks are separate code points; this is not a grapheme counter.
 *
 * @param {string} text
 * @returns {{ characters: number, nonWhitespace: number, lines: number }}
 */
export function analyzeText(text) {
  const characters = Array.from(text);
  return {
    characters: characters.length,
    nonWhitespace: characters.filter((character) => !/\s/u.test(character)).length,
    lines: text.length === 0 ? 0 : text.split(/\r\n|\r|\n/u).length,
  };
}
