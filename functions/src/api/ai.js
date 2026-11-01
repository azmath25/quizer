import { define, path } from "../domain/runtime.js";
import { id, assert, text, enumeration, bounded } from "../../shared/schema.js";

const MAX_CHATS = 100;
const MAX_MESSAGES = 100;
const chatPath = (uid, chatId) => `users/${uid}/chats/${id(chatId, "chat ID")}`;
const preview = (s) => String(s).replace(/\s+/g, " ").trim().slice(0, 60);

define(
  "createChat",
  "teacher",
  ["title"],
  async (c, r) => {
    const title = text(r.title ?? "New chat", "Title", 120, true).trim();
    await c.rate("chat.create", 60);
    const existing = await c.list(
      `users/${c.actor.uid}/chats`,
      [],
      { limit: MAX_CHATS },
      "updatedAt",
    );
    assert(
      existing.items.length < MAX_CHATS,
      "QUOTA_EXCEEDED",
      "You have reached the chat limit. Delete an old chat first.",
    );
    const chatId = c.key("cht_");
    const chat = {
      title,
      autoTitle: !r.title,
      messageCount: 0,
      createdAt: c.now,
      updatedAt: c.now,
    };
    c.set(chatPath(c.actor.uid, chatId), chat);
    return { chatId, chat: { ...chat, id: chatId } };
  },
  { mutation: true },
);

define("listChats", "teacher", ["limit", "cursor"], (c, r) =>
  c.list(`users/${c.actor.uid}/chats`, [], r, "updatedAt"),
);

define("getChat", "teacher", ["chatId"], async (c, r) => {
  const p = chatPath(c.actor.uid, r.chatId),
    chat = await c.get(p),
    messages = await c.list(
      `${p}/messages`,
      [],
      { limit: MAX_MESSAGES },
      "seq",
      "asc",
    );
  return { chat: { ...chat, id: r.chatId }, messages: messages.items };
});

define(
  "appendChatMessages",
  "teacher",
  ["chatId", "messages"],
  async (c, r) => {
    const p = chatPath(c.actor.uid, r.chatId),
      chat = await c.get(p);
    assert(
      Array.isArray(r.messages) &&
        r.messages.length >= 1 &&
        r.messages.length <= 4,
      "INVALID_FIELDS",
      "Send 1–4 messages.",
    );
    assert(
      chat.messageCount + r.messages.length <= MAX_MESSAGES,
      "QUOTA_EXCEEDED",
      "This chat is full. Start a new chat.",
    );
    await c.rate("chat.message", 600);
    let first = null;
    r.messages.forEach((m, i) => {
      assert(m && typeof m === "object", "INVALID_FIELDS", "Invalid message.");
      const role = enumeration(m.role, ["user", "assistant"], "message role"),
        body = text(m.text ?? "", "Message", 20000);
      assert(
        body.length > 0 || m.batch || m.jobId,
        "INVALID_FIELDS",
        "Message is empty.",
      );
      const files = Array.isArray(m.files) ? m.files.slice(0, 10) : [];
      files.forEach((f) => text(f, "File name", 180, true));
      if (m.batch) {
        assert(
          typeof m.batch === "object" && Array.isArray(m.batch.problems),
          "INVALID_FIELDS",
          "Invalid extracted problems.",
        );
        bounded(m.batch, 200000);
      }
      const seq = chat.messageCount + i;
      if (role === "user" && first === null) first = body;
      c.set(`${p}/messages/${c.key("msg_", String(seq))}`, {
        seq,
        role,
        text: body,
        files,
        batch: m.batch ?? null,
        jobId: m.jobId ? id(m.jobId, "job ID") : null,
        createdAt: c.now,
      });
    });
    const next = {
      ...chat,
      messageCount: chat.messageCount + r.messages.length,
      updatedAt: c.now,
    };
    if (chat.autoTitle && first) {
      next.title = preview(first) || chat.title;
      next.autoTitle = false;
    }
    c.set(p, next);
    return { messageCount: next.messageCount, title: next.title };
  },
  { mutation: true },
);

define(
  "deleteChat",
  "teacher",
  ["chatId"],
  async (c, r) => {
    const p = chatPath(c.actor.uid, r.chatId);
    await c.get(p);
    const messages = await c.list(
      `${p}/messages`,
      [],
      { limit: MAX_MESSAGES },
      "seq",
      "asc",
    );
    for (const m of messages.items) c.delete(`${p}/messages/${m.id}`);
    c.delete(p);
    return { deleted: true };
  },
  { mutation: true },
);

define(
  "createExtractionJob",
  "teacher",
  ["assetId", "name", "target", "chatId"],
  async (c, r) => {
    const asset = await c.get(path("assets", id(r.assetId, "asset ID")));
    assert(
      asset.ownerId === c.actor.uid &&
        asset.status === "ready" &&
        ["image", "document"].includes(asset.kind),
      "RESOURCE_UNAVAILABLE",
      "This file is unavailable.",
    );
    const target = enumeration(
      r.target ?? "bulk",
      ["bulk", "quiz"],
      "import target",
    );
    await c.rate("ai.extract", 30);
    const active = await c.list(
      "jobs",
      [
        ["requestedBy", "==", c.actor.uid],
        ["kind", "==", "ai_extract"],
      ],
      { limit: 25 },
      "createdAt",
    );
    assert(
      active.items.filter((j) => ["queued", "running"].includes(j.status))
        .length < 10,
      "RATE_LIMITED",
      "Too many extractions are already waiting. Wait for one to finish.",
    );
    const jobId = await c.job("ai_extract", r.assetId, {
      assetId: r.assetId,
      name: text(r.name ?? asset.originalName, "Name", 200, true),
      target,
      chatId: r.chatId ? id(r.chatId, "chat ID") : null,
    });
    return { jobId };
  },
  { mutation: true },
);

define("listMyJobs", "teacher", ["limit", "cursor"], async (c, r) => {
  const page = await c.list(
    "jobs",
    [
      ["requestedBy", "==", c.actor.uid],
      ["kind", "==", "ai_extract"],
    ],
    r,
    "createdAt",
  );
  return {
    nextCursor: page.nextCursor,
    items: page.items.map((j) => ({
      jobId: j.id,
      name: j.input?.name ?? "Extraction",
      target: j.input?.target ?? "bulk",
      chatId: j.input?.chatId ?? null,
      status: j.status,
      stage: j.progress?.stage ?? "",
      error: j.error,
      problemCount: j.result?.problemCount ?? null,
      createdAt: j.createdAt,
      updatedAt: j.updatedAt,
      completedAt: j.completedAt,
    })),
  };
});

define("getExtractionResult", "teacher", ["jobId"], async (c, r) => {
  const job = await c.get(path("jobs", id(r.jobId, "job ID")));
  assert(
    job.kind === "ai_extract" &&
      (job.requestedBy === c.actor.uid || c.actor.role === "admin"),
    "RESOURCE_UNAVAILABLE",
    "This job is unavailable.",
  );
  return {
    jobId: r.jobId,
    name: job.input.name,
    target: job.input.target,
    chatId: job.input.chatId,
    status: job.status,
    stage: job.progress?.stage ?? "",
    error: job.error,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
    result:
      job.status === "succeeded"
        ? {
            title: job.result.title,
            problemCount: job.result.problemCount,
            latex: job.result.latex,
          }
        : null,
  };
});
