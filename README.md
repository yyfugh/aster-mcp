# Aster Log MCP · local image edition

新增两个工具：

- `upload_base64_image`
- `create_base64_image_post`

这样 AI 生成图或本地图片可以先压缩，再转成 base64，直接上传到 Supabase Storage。

## 更新方式
用这里的 `server.mjs` 和 `package.json` 覆盖 GitHub 仓库旧文件。
Render 自动部署后，建议新建/刷新 ChatGPT 连接器，让它重新读取工具 schema。

## 图片限制
单张解码后最多 2MB。
推荐先压成 JPEG 或 WebP，宽度约 1200px 以内。
