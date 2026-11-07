import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../../js/services/mimo-chat.js", import.meta.url), "utf8");
let session, services;
globalThis.__mimoTestSession = () => session;
globalThis.__mimoTestServices = async () => services;
const mockedSource = source.replace(
  /import \{ getFirebaseServices, getSession \} from "\.\.\/firebase-client\.js";/,
  "const getSession = globalThis.__mimoTestSession; const getFirebaseServices = globalThis.__mimoTestServices;"
);
assert.notEqual(mockedSource, source, "Firebase dependency must be mocked");
const api = await import("data:text/javascript;base64," + Buffer.from(mockedSource).toString("base64"));

const allowedSession = () => ({
  roleResolved: true, accountStatus: "active", epoch: 7,
  user: {uid: "teacher-1", emailVerified: true},
  capabilities: {teach: true, admin: false},
});

test("teacher and admin verification gates the Mimo callable", () => {
  assert.equal(api.canUseMimoTeacherChat(allowedSession()), true);
  assert.equal(api.canUseMimoTeacherChat({...allowedSession(), capabilities: {admin: true}}), true);
  for (const patch of [
    {user: null}, {roleResolved: false}, {accountStatus: "suspended"},
    {user: {uid: "teacher-1", emailVerified: false}},
    {capabilities: {teach: false, admin: false}},
  ]) assert.equal(api.canUseMimoTeacherChat({...allowedSession(), ...patch}), false);
});

test("each teacher submission uses exactly one existing Firebase callable", async () => {
  session = allowedSession();
  const calls = [];
  services = {
    functions: {region: "europe-west1"},
    functionsSDK: {httpsCallable: (functions, name, options) => {
      assert.equal(functions, services.functions);
      assert.equal(name, "mimoAiHub");
      assert.equal(options.timeout, 115000);
      return async payload => {
        calls.push(payload);
        return {data: {reply: "The answer is \\(x=2\\).", runId: "run_1"}};
      };
    }},
  };
  const history = Array.from({length: 15}, (_, n) => ({
    role: n % 2 ? "assistant" : "user",
    content: "a".repeat(1300),
  }));
  const answer = await api.sendTeacherChatMessage({
    message: " Explain ", context: "C".repeat(6000), history, requestId: "unique-1",
  });
  assert.equal(answer.reply, "The answer is \\(x=2\\).");
  assert.equal(answer.runId, "run_1");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, "chat.send");
  assert.equal(calls[0].requestId, "unique-1");
  assert.equal(calls[0].message, "Explain");
  assert.equal(calls[0].context.length, 4000);
  assert.equal(calls[0].history.length, 8);
  assert.ok(calls[0].history.every(item => item.content.length === 1200));
  await api.sendTeacherChatMessage({message: "Next", requestId: "unique-2"});
  assert.deepEqual(calls.map(item => item.requestId), ["unique-1", "unique-2"]);
});

test("missing teacher access blocks requests before Firebase can be called", async () => {
  session = {...allowedSession(), capabilities: {teach: false, admin: false}};
  services = null;
  await assert.rejects(
    api.sendTeacherChatMessage({message: "Hello"}),
    error => error.code === "functions/permission-denied",
  );
});

test("account switch while a call is pending invalidates the reply without retry", async () => {
  session = allowedSession();
  let resolve, callCount = 0;
  services = {functions: {}, functionsSDK: {httpsCallable: () => async () => {
    callCount++;
    return new Promise(r => {resolve = r;});
  }}};
  const ongoing = api.sendTeacherChatMessage({message: "Check", requestId: "uncertain-1"});
  for (let i = 0; i < 5 && !resolve; i++) await Promise.resolve();
  assert.equal(callCount, 1);
  session = {...allowedSession(), epoch: 8, user: {uid: "other", emailVerified: true}};
  resolve({data: {reply: "Private result"}});
  await assert.rejects(ongoing, error => error.code === "functions/unauthenticated");
  assert.equal(callCount, 1);
});

test("quota, uncertain-outcome and authentication errors have actionable safe messages", () => {
  for (const reason of ["RATE_LIMITED", "MIMO_RATE_LIMITED", "MIMO_OUTCOME_UNKNOWN", "MIMO_NOT_COMPLETED"]) {
    const msg = api.mimoChatErrorMessage({details: {reason}});
    assert.ok(msg.length > 20);
    assert.doesNotMatch(msg, /secret|token|api key/i);
  }
  assert.match(api.mimoChatErrorMessage({code: "functions/unauthenticated"}), /Sign in/i);
  assert.match(api.mimoChatErrorMessage({code: "functions/permission-denied"}), /teacher/i);
  assert.match(api.mimoChatErrorMessage({code: "functions/unavailable"}), /unavailable/i);
  assert.match(api.mimoChatErrorMessage({details: {reason: "MIMO_OUTCOME_UNKNOWN"}}), /Do not resend/i);
});
