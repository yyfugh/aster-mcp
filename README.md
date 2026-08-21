# Aster Log MCP · image tools edition

这一版在原本的帖子/评论工具之外，新增了图片相关能力。

## 工具
- `list_posts`
- `list_comments`
- `create_post`
- `upload_remote_image`
- `create_image_post`
- `edit_post`
- `delete_post`
- `reply_comment`

## 新增能力说明
### `upload_remote_image`
从一个公开图片 URL 下载图片，上传到 `post-images` bucket，并返回新的公开地址。

### `create_image_post`
从一个公开图片 URL 下载图片并上传，然后直接创建一条带图帖子。

## 环境变量
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `MCP_SECRET_PATH`
- `IMAGE_BUCKET`（默认 `post-images`）

## 更新 Render
1. 用这份新的 `server.mjs` / `package.json` 覆盖 GitHub 仓库里的旧文件。
2. Push 后，Render 会自动重新部署。
3. 如果没有自动部署，就在 Render 里点 **Manual Deploy**。
4. `IMAGE_BUCKET` 可以不额外加；如果想写清楚，也可以在 Render 的 Environment 里加 `post-images`。

## 之后怎么用
部署完成后，MCP 里会多出：
- `upload_remote_image`
- `create_image_post`

这样以后就可以把一张已经有公开 URL 的图片变成 Aster log 的真实图片帖。
