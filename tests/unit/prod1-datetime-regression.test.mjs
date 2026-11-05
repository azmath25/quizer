import test from "node:test";
import assert from "node:assert/strict";
import {parseDateTime,minutesBetweenDates}
  from "../../js/core/date-time.js";
test("P1-C result dates support ISO and Firestore timestamp objects",()=>{
  const iso="2026-11-05T00:10:00.000Z";
  const sec=Date.parse(iso)/1000;
  for(const input of [iso,new Date(iso),
    {seconds:sec,nanoseconds:0},{_seconds:sec,_nanoseconds:0}]){
    assert.equal(parseDateTime(input)?.toISOString(),iso);
  }
  assert.equal(minutesBetweenDates({seconds:sec-125,nanoseconds:0},iso),2);
  assert.equal(minutesBetweenDates(iso,iso),0);
});
test("P1-C malformed dates never throw or produce NaN durations",()=>{
  for(const value of [null,undefined,"",{},[],{seconds:"wrong"},
    {seconds:NaN},{seconds:Infinity},{seconds:10,nanoseconds:-1},
    {seconds:10,nanoseconds:1000000000},"not-a-date",NaN,Infinity,
    new Date(NaN)]){
    assert.equal(parseDateTime(value),null);
    assert.equal(minutesBetweenDates(value,"2026-11-05T00:10:00Z"),null);
  }
});
