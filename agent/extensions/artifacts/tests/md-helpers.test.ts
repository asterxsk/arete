import test from "node:test";
import assert from "node:assert/strict";
import { clampScroll } from "../md-helpers.ts";

test("clampScroll moves by delta within bounds", () => {
  assert.equal(clampScroll(5, 1, 100, 20), 6);
});

test("clampScroll does not go below zero", () => {
  assert.equal(clampScroll(2, -10, 100, 20), 0);
});

test("clampScroll does not scroll past the bottom", () => {
  assert.equal(clampScroll(75, 10, 100, 20), 80);
});

test("clampScroll returns 0 when content fits entirely within the visible height", () => {
  assert.equal(clampScroll(0, 5, 10, 20), 0);
});
