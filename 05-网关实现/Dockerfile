# ---- Creen2API 网关（bun 运行时）----
# 关键：必须使用 bun。Node 原生 TLS 指纹会被上游 Cloudflare WAF 拦截（403）。
FROM oven/bun:1.3-debian AS base
LABEL org.opencontainers.image.title="creen-2api" \
      org.opencontainers.image.description="Creen (creen.ai) 图像/视频生成 → OpenAI 兼容 API 网关（bun）" \
      org.opencontainers.image.licenses="MIT"

WORKDIR /app

# 依赖清单（当前无运行时依赖，仅类型；保留层缓存结构以便后续扩展）
COPY package.json bun.lock* tsconfig.json ./
RUN bun install --production --frozen-lockfile || bun install --production

# 源码
COPY src ./src

# 非 root 运行
RUN useradd --system --create-home --uid 10001 appuser && chown -R appuser:appuser /app
USER appuser

# 运行时数据（账号池 / 媒体落盘）与配置由 volume 挂载
VOLUME ["/app/data"]

EXPOSE 47840

# 配置路径可用 -e CREEN_CONFIG=/app/config.json 覆盖；默认读取工作目录 config.json
ENV CREEN_CONFIG=/app/config.json
ENTRYPOINT ["bun", "run", "src/index.ts"]
