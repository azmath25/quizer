import test from "node:test";
import assert from "node:assert/strict";
import {parseDateTime, minutesBetweenDates} from "../../js/core/date-time.js";

test("result timestamps accept ISO and Firestore wire formats", () => {
  const iso = "2026-11-05T12:00:00.000Z";
  const millis = Date.parse(iso);
  const seconds = millis / 1000;
  for (const value of [iso, millis, {seconds, nanoseconds:0},
    {_seconds:seconds, _nanoseconds:0}, new Date(iso)]) {
    assert.equal(parseDateTime(value)?.toISOString(), iso);
  }
});

test("invalid and missing result timestamps never produce invalid Date", () => {
  for (const value of [undefined, null, "", "garbage", Infinity, NaN,
    {}, {seconds:Infinity}, {seconds:"1"}, {seconds:1.5},
    {seconds:1, nanoseconds:-1}, {seconds:1, nanoseconds:1000000000},
    {seconds:9e18, nanoseconds:0}, new Date(NaN)]) {
    assert.equal(parseDateTime(value), null);
  }
});

test("elapsed minutes safely handles missing and valid timestamps", () => {
  assert.equal(minutesBetweenDates(
    "2026-11-05T12:00:00Z",
    {seconds:Date.parse("2026-11-05T12:02:20Z")/1000,nanoseconds:0}
  ), 2);
  assert.equal(minutesBetweenDates(null, "2026-11-05T12:00:00Z"), null);
  assert.equal(minutesBetweenDates("invalid", "2026-11-05T12:00:00Z"), null);
  assert.equal(minutesBetweenDates("2026-11-05T12:03:00Z",
    "2026-11-05T12:00:00Z"), 0);
});
