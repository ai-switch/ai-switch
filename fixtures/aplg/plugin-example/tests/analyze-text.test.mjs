import assert from "node:assert/strict";
import test from "node:test";

const cases = [
  ["empty input", "", { characters: 0, nonWhitespace: 0, lines: 0 }],
  ["spaces are excluded only from the second count", "Hello world", { characters: 11, nonWhitespace: 10, lines: 1 }],
  ["emoji count as one Unicode code point", "你好🙂", { characters: 3, nonWhitespace: 3, lines: 1 }],
  ["CRLF, CR, and LF each delimit one line", "a\r\nb\rc\n", { characters: 7, nonWhitespace: 3, lines: 4 }],
  ["whitespace-only input still contains lines", " \t\n", { characters: 3, nonWhitespace: 0, lines: 2 }],
  ["combining marks remain separate code points", "e\u0301", { characters: 2, nonWhitespace: 2, lines: 1 }],
  ["Unicode non-breaking and ideographic spaces are excluded", "a\u00a0\u3000b", { characters: 4, nonWhitespace: 2, lines: 1 }],
];

for (const [name, input, expected] of cases) {
  test(name, async () => {
    let module;
    try {
      module = await import("../src/analyze-text.js");
    } catch (error) {
      if (error.code === "ERR_MODULE_NOT_FOUND") {
        assert.fail("The text statistics module has not been implemented yet.");
      }
      throw error;
    }
    assert.deepEqual(module.analyzeText(input), expected);
  });
}
