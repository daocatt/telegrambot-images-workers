export const landingHtml = `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Image Host - Telegram Bot Service</title>
    <style>
      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }
      body {
        font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Source Han Sans CN", monospace;
        background: #f3f4f6;
        color: #000000;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        position: relative;
      }
      .bg-overlay {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-image: url('__RANDOM_BG__');
        background-size: cover;
        background-position: center;
        filter: brightness(0.6) contrast(1.05);
        z-index: 1;
        transition: filter 0.5s ease;
      }
      .container {
        position: relative;
        z-index: 10;
        width: 90%;
        max-width: 460px;
        padding: 2.5rem 2rem;
        background: #ffffff;
        color: #000000;
        border: 3px solid #000000;
        border-radius: 0;
        box-shadow: 8px 8px 0px #000000;
        text-align: center;
        animation: slideUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      }
      @keyframes slideUp {
        from {
          opacity: 0;
          transform: translateY(20px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
      .logo-wrapper {
        margin-bottom: 1.5rem;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 64px;
        height: 64px;
        background: #000000;
        border: 2px solid #000000;
        border-radius: 0;
        box-shadow: 4px 4px 0px rgba(0, 0, 0, 0.15);
      }
      .logo-icon {
        width: 32px;
        height: 32px;
        fill: #ffffff;
      }
      h1 {
        font-size: 1.75rem;
        font-weight: 900;
        margin-bottom: 0.5rem;
        letter-spacing: -0.5px;
        text-transform: uppercase;
      }
      .subtitle {
        font-size: 0.95rem;
        color: #4b5563;
        margin-bottom: 2rem;
        font-weight: bold;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .info-box {
        background: #f9fafb;
        border: 1px solid #000000;
        padding: 1.25rem 1rem;
        border-radius: 0;
        margin-bottom: 2rem;
        font-size: 0.9rem;
        line-height: 1.6;
        color: #000000;
        text-align: left;
      }
      .info-box p {
        margin-bottom: 0.5rem;
        font-weight: 500;
      }
      .info-box p:last-child {
        margin-bottom: 0;
      }
      .bullet {
        color: #000000;
        margin-right: 6px;
        font-weight: 900;
      }
      .btn-cta {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        padding: 1rem;
        background: #000000;
        color: #ffffff;
        font-weight: 800;
        font-size: 1rem;
        text-decoration: none;
        border-radius: 0;
        border: 2px solid #000000;
        box-shadow: 4px 4px 0px #000000;
        transition: all 0.2s ease;
        margin-bottom: 1.25rem;
        cursor: pointer;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .btn-cta:hover {
        background: #1f2937;
        transform: translate(-2px, -2px);
        box-shadow: 6px 6px 0px #000000;
      }
      .btn-cta:active {
        transform: translate(0, 0);
        box-shadow: 2px 2px 0px #000000;
      }
      .btn-cta svg {
        margin-right: 8px;
        width: 20px;
        height: 20px;
      }
      .footer-links {
        display: flex;
        justify-content: center;
        gap: 1.5rem;
        font-size: 0.85rem;
      }
      .footer-links a {
        color: #000000;
        text-decoration: underline;
        font-weight: bold;
        transition: opacity 0.2s ease;
      }
      .footer-links a:hover {
        opacity: 0.8;
      }
    </style>
  </head>
  <body>
    <div class="bg-overlay"></div>
    <div class="container">
      <div class="logo-wrapper">
        <svg class="logo-icon" viewBox="0 0 24 24">
          <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0-2-.9-2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
        </svg>
      </div>
      <h1>📷 SnapFlare</h1>
      <div class="subtitle">Telegram 智能图床服务</div>
      
      <div class="info-box">
        <p><span class="bullet">■</span> 关注 Telegram 机器人即可开始使用</p>
        <p><span class="bullet">■</span> 发送图片至 Bot 即可立即生成高速外链</p>
        <p><span class="bullet">■</span> 自动接入 D1 与 CDN，享受极速访问体验</p>
      </div>

      <a href="__BOT_LINK__" target="_blank" rel="noopener noreferrer" class="btn-cta">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69.01-.03.01-.14-.07-.2-.08-.06-.19-.04-.27-.02-.12.02-1.96 1.24-5.54 3.65-.52.36-.97.53-1.33.52-.4-.01-1.17-.23-1.74-.41-.7-.23-1.26-.35-1.21-.74.03-.2.3-.41.82-.62 3.18-1.38 5.3-2.29 6.36-2.73 3.02-1.26 3.65-1.48 4.06-1.49.09 0 .29.02.42.13.11.09.14.21.15.3-.01.08-.01.17-.02.2z"/>
        </svg>
        关注 __BOT_NAME__
      </a>

      <div class="footer-links">
        <a href="/admin">管理后台 (Admin Console)</a>
      </div>
    </div>
  </body>
</html>
`
