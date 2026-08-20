import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const PORT = Number(process.env.PORT || 3000);
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || "";
const MCP_SECRET_PATH = process.env.MCP_SECRET_PATH || "";

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY || !MCP_SECRET_PATH) {
  console.error("Missing SUPABASE_URL, SUPABASE_SECRET_KEY, or MCP_SECRET_PATH");
  process.exit(1);
}

const REST = `${SUPABASE_URL}/rest/v1`;

async function sb(path, options = {}) {
  const headers = {
    apikey: SUPABASE_SECRET_KEY,
    "Content-Type": "application/json",
    ...(options.headers || {})
  };
  const res = await fetch(`${REST}${path}`, { ...options, headers });
  const text = await res.text();

  if (!res.ok) {
    throw new Error(`Supabase ${res.status}: ${text}`);
  }
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

function asText(data) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data
  };
}

function makeServer() {
  const server = new McpServer({
    name: "aster-log",
    version: "1.0.0"
  });

  server.registerTool(
    "list_posts",
    {
      title: "查看 Aster 帖子",
      description: "读取 Aster 小号最近的帖子。",
      inputSchema: {
        limit: z.number().int().min(1).max(50).default(20)
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ limit }) => {
      const rows = await sb(`/posts?select=id,author,content,created_at&order=created_at.desc&limit=${limit}`);
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
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
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
      description: "以 Aster 身份在小号发布一条新帖子。",
      inputSchema: {
        content: z.string().min(1).max(5000)
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async ({ content }) => {
      const rows = await sb("/posts", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ author: "Aster", content })
      });
      return asText({ ok: true, post: rows?.[0] || null });
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
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
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
      inputSchema: {
        post_id: z.number().int()
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false
      }
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
      description: "以 Aster 身份回复一条评论。回复会显示在网站评论下面。",
      inputSchema: {
        comment_id: z.number().int(),
        reply: z.string().min(1).max(3000)
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
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
app.use(express.json({ limit: "1mb" }));

app.get("/", (_req, res) => {
  res.type("text/plain").send("Aster MCP is awake ✦");
});

app.post("/mcp/:secret", async (req, res) => {
  if (req.params.secret !== MCP_SECRET_PATH) {
    return res.status(404).send("Not found");
  }

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
    if (!res.headersSent) {
      res.status(500).json({ error: String(err?.message || err) });
    }
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