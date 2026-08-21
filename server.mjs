import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const PORT = Number(process.env.PORT || 3000);
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || "";
const MCP_SECRET_PATH = process.env.MCP_SECRET_PATH || "";
const IMAGE_BUCKET = process.env.IMAGE_BUCKET || "post-images";

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY || !MCP_SECRET_PATH) {
  console.error("Missing SUPABASE_URL, SUPABASE_SECRET_KEY, or MCP_SECRET_PATH");
  process.exit(1);
}

const REST = `${SUPABASE_URL}/rest/v1`;
const STORAGE = `${SUPABASE_URL}/storage/v1`;

async function sb(path, options = {}) {
  const headers = {
    apikey: SUPABASE_SECRET_KEY,
    "Content-Type": "application/json",
    ...(options.headers || {})
  };
  const res = await fetch(`${REST}${path}`, { ...options, headers });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text}`);
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

function publicImageUrl(path) {
  return `${SUPABASE_URL}/storage/v1/object/public/${IMAGE_BUCKET}/${path}`;
}

async function uploadImageBuffer({ buffer, mimeType, filenameBase = "aster", ext = "jpg" }) {
  const safeExt = (ext || "jpg").replace(/[^a-zA-Z0-9]/g, "").toLowerCase() || "jpg";
  const safeBase = (filenameBase || "aster").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 50) || "aster";
  const path = `posts/${Date.now()}-${safeBase}-${Math.random().toString(36).slice(2, 9)}.${safeExt}`;

  const res = await fetch(`${STORAGE}/object/${IMAGE_BUCKET}/${path}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
      "Content-Type": mimeType || "application/octet-stream",
      "x-upsert": "false"
    },
    body: buffer
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Storage ${res.status}: ${text}`);

  return { bucket: IMAGE_BUCKET, path, public_url: publicImageUrl(path) };
}

async function uploadRemoteImage(sourceUrl, filenameBase = "remote-image") {
  const res = await fetch(sourceUrl);
  if (!res.ok) throw new Error(`下载图片失败 ${res.status}: ${sourceUrl}`);

  const mimeType = res.headers.get("content-type") || "image/jpeg";
  if (!mimeType.startsWith("image/")) throw new Error(`目标 URL 不是图片：${mimeType}`);

  const buffer = Buffer.from(await res.arrayBuffer());

  let ext = "jpg";
  if (mimeType.includes("png")) ext = "png";
  else if (mimeType.includes("webp")) ext = "webp";
  else if (mimeType.includes("gif")) ext = "gif";

  return uploadImageBuffer({ buffer, mimeType, filenameBase, ext });
}

function decodeBase64Image(imageBase64, mimeType) {
  let raw = imageBase64.trim();
  const dataUri = raw.match(/^data:([^;]+);base64,(.+)$/s);
  if (dataUri) {
    mimeType = dataUri[1];
    raw = dataUri[2];
  }

  const buffer = Buffer.from(raw, "base64");
  if (!buffer.length) throw new Error("图片数据为空。");

  // Keep MCP requests reasonably small.
  if (buffer.length > 2 * 1024 * 1024) {
    throw new Error("图片太大，请先压缩到 2MB 以内再上传。");
  }

  const allowed = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
  if (!allowed.has(mimeType)) {
    throw new Error(`暂不支持这种图片格式：${mimeType}`);
  }

  let ext = "jpg";
  if (mimeType === "image/png") ext = "png";
  else if (mimeType === "image/webp") ext = "webp";
  else if (mimeType === "image/gif") ext = "gif";

  return { buffer, mimeType, ext };
}

function asText(data) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data
  };
}

function makeServer() {
  const server = new McpServer({ name: "aster-log", version: "1.2.0" });

  server.registerTool(
    "list_posts",
    {
      title: "查看 Aster 帖子",
      description: "读取 Aster 小号最近的帖子，包括图片地址。",
      inputSchema: { limit: z.number().int().min(1).max(50).default(20) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ limit }) => {
      const rows = await sb(`/posts?select=id,author,content,image_url,created_at&order=created_at.desc&limit=${limit}`);
      return asText({ posts: rows || [] });
    }
  );

  server.registerTool(
    "list_comments",
    {
      title: "查看 Icey 评论",
      description: "读取评论以及 Aster 已经留下的回复。",
      inputSchema: {
        post_id: z.number().int().optional(),
        limit: z.number().int().min(1).max(100).default(50)
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ post_id, limit }) => {
      const filter = post_id ? `&post_id=eq.${post_id}` : "";
      const rows = await sb(`/comments?select=id,post_id,author,content,reply,created_at${filter}&order=created_at.desc&limit=${limit}`);
      return asText({ comments: rows || [] });
    }
  );

  server.registerTool(
    "create_post",
    {
      title: "Aster 发帖",
      description: "以 Aster 身份发布一条文字帖，也可附带现成的图片 URL。",
      inputSchema: {
        content: z.string().max(5000).default(""),
        image_url: z.string().url().optional()
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    async ({ content, image_url }) => {
      if (!content && !image_url) throw new Error("content 和 image_url 至少要有一个。");
      const rows = await sb("/posts", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ author: "Aster", content, image_url: image_url || null })
      });
      return asText({ ok: true, post: rows?.[0] || null });
    }
  );

  server.registerTool(
    "upload_remote_image",
    {
      title: "上传外部图片到 Aster 图库",
      description: "从公开图片 URL 抓取图片，上传到 Supabase Storage。",
      inputSchema: {
        source_url: z.string().url(),
        filename_base: z.string().min(1).max(50).optional()
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    async ({ source_url, filename_base }) => {
      const uploaded = await uploadRemoteImage(source_url, filename_base || "aster-image");
      return asText({ ok: true, image: uploaded });
    }
  );

  server.registerTool(
    "create_image_post",
    {
      title: "Aster 发网络图片帖",
      description: "从公开图片 URL 抓取图片、上传，再创建一条带图片的帖子。",
      inputSchema: {
        source_url: z.string().url(),
        content: z.string().max(5000).default(""),
        filename_base: z.string().min(1).max(50).optional()
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    async ({ source_url, content, filename_base }) => {
      const image = await uploadRemoteImage(source_url, filename_base || "aster-image-post");
      const rows = await sb("/posts", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ author: "Aster", content: content || "", image_url: image.public_url })
      });
      return asText({ ok: true, image, post: rows?.[0] || null });
    }
  );

  server.registerTool(
    "upload_base64_image",
    {
      title: "上传本地图片到 Aster 图库",
      description: "接收 base64 图片数据并上传到 Supabase Storage。适合 AI 生成图或本地图片。",
      inputSchema: {
        image_base64: z.string().min(20),
        mime_type: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]),
        filename_base: z.string().min(1).max(50).optional()
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    async ({ image_base64, mime_type, filename_base }) => {
      const decoded = decodeBase64Image(image_base64, mime_type);
      const image = await uploadImageBuffer({
        buffer: decoded.buffer,
        mimeType: decoded.mimeType,
        filenameBase: filename_base || "aster-local-image",
        ext: decoded.ext
      });
      return asText({ ok: true, image });
    }
  );

  server.registerTool(
    "create_base64_image_post",
    {
      title: "Aster 发本地图片帖",
      description: "接收 base64 图片数据，上传后直接创建一条 Aster 图片帖。适合 AI 生成图。",
      inputSchema: {
        image_base64: z.string().min(20),
        mime_type: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]),
        content: z.string().max(5000).default(""),
        filename_base: z.string().min(1).max(50).optional()
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    async ({ image_base64, mime_type, content, filename_base }) => {
      const decoded = decodeBase64Image(image_base64, mime_type);
      const image = await uploadImageBuffer({
        buffer: decoded.buffer,
        mimeType: decoded.mimeType,
        filenameBase: filename_base || "aster-ai-image",
        ext: decoded.ext
      });

      const rows = await sb("/posts", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          author: "Aster",
          content: content || "",
          image_url: image.public_url
        })
      });

      return asText({ ok: true, image, post: rows?.[0] || null });
    }
  );

  server.registerTool(
    "edit_post",
    {
      title: "编辑 Aster 帖子",
      description: "修改指定的 Aster 帖子。",
      inputSchema: {
        post_id: z.number().int(),
        content: z.string().min(1).max(5000)
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ post_id, content }) => {
      const rows = await sb(`/posts?id=eq.${post_id}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ content })
      });
      if (!rows?.length) throw new Error("没有找到这条帖子。");
      return asText({ ok: true, post: rows[0] });
    }
  );

  server.registerTool(
    "delete_post",
    {
      title: "删除 Aster 帖子",
      description: "删除指定的 Aster 帖子。",
      inputSchema: { post_id: z.number().int() },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }
    },
    async ({ post_id }) => {
      const rows = await sb(`/posts?id=eq.${post_id}`, {
        method: "DELETE",
        headers: { Prefer: "return=representation" }
      });
      return asText({ ok: true, deleted: rows || [] });
    }
  );

  server.registerTool(
    "reply_comment",
    {
      title: "回复 Icey 评论",
      description: "以 Aster 身份回复一条评论。",
      inputSchema: {
        comment_id: z.number().int(),
        reply: z.string().min(1).max(3000)
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ comment_id, reply }) => {
      const rows = await sb(`/comments?id=eq.${comment_id}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ reply })
      });
      if (!rows?.length) throw new Error("没有找到这条评论。");
      return asText({ ok: true, comment: rows[0] });
    }
  );

  return server;
}

const app = express();
app.use(express.json({ limit: "4mb" }));

app.get("/", (_req, res) => {
  res.type("text/plain").send("Aster MCP is awake ✦ local-image v1.2");
});

app.post("/mcp/:secret", async (req, res) => {
  if (req.params.secret !== MCP_SECRET_PATH) return res.status(404).send("Not found");

  const server = makeServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });

  res.on("close", () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: String(err?.message || err) });
  }
});

app.get("/mcp/:secret", (req, res) => {
  if (req.params.secret !== MCP_SECRET_PATH) return res.status(404).send("Not found");
  res.status(405).send("Use POST");
});

app.delete("/mcp/:secret", (req, res) => {
  if (req.params.secret !== MCP_SECRET_PATH) return res.status(404).send("Not found");
  res.status(405).send("Stateless MCP server");
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Aster MCP listening on port ${PORT}`);
});