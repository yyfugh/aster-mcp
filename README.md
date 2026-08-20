# Aster Log MCP

远程 MCP 服务：让 MCP 客户端读取/修改 Aster 小号的 Supabase 数据。

## 工具
- `list_posts`
- `list_comments`
- `create_post`
- `edit_post`
- `delete_post`
- `reply_comment`

## 环境变量
- `SUPABASE_URL`: 例如 `https://xxxx.supabase.co`
- `SUPABASE_SECRET_KEY`: Supabase 后端 Secret key（`sb_secret_...`），绝对不要放进网页或 GitHub
- `MCP_SECRET_PATH`: 一串长随机字符串。MCP 地址最后会是：
  `https://你的服务地址/mcp/这串随机字符串`

## Render
1. 把这些文件放到一个 GitHub 仓库。
2. Render → New → Web Service → 连接这个仓库。
3. 如果 Render 识别 `render.yaml`，按 Blueprint 部署也可以。
4. 在 Environment 中填 `SUPABASE_URL` 和 `SUPABASE_SECRET_KEY`。
5. 部署完成后，首页应显示 `Aster MCP is awake ✦`。
6. MCP endpoint 是：
   `https://你的-render-域名/mcp/<MCP_SECRET_PATH>`

不要公开 MCP endpoint，因为路径里包含用于个人测试的秘密字符串。
