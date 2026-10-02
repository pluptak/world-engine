import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";
import { PIPELINE } from "../src/index.js";

test("the engine names the stages every command passes through", () => {
  strictEqual(PIPELINE[0], "command");
  strictEqual(PIPELINE[PIPELINE.length - 1], "events");
  deepStrictEqual(PIPELINE.length, 7);
});