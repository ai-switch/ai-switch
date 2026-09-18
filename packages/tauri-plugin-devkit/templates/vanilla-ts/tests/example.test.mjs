import assert from "node:assert/strict";
import { test } from "node:test";
import { add } from "../src/example.js";

test("the generated example logic is deterministic", () => {
  assert.equal(add(2, 3), 5);
});
