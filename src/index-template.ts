const indexHtml = `
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>URL to Markdown Pro</title>
    <meta name="description" content="Convert any URL to clean Markdown with paywall bypass support">
    <style>
        :root {
            --font-size: 14px;
            --primary: #6366f1;
            --primary-hover: #4f46e5;
            --success: #22c55e;
            --warning: #f59e0b;
        }

        @media screen and (min-width: 600px) {
            :root {
                --font-size: 16px;
            }
        }

        @media (prefers-color-scheme: dark) {
            :root {
                --background-colour: #0f0f0f;
                --card-colour: #1a1a1a;
                --text-colour: #ececec;
                --text-muted: #888;
                --tint-colour: #1e1e1e;
                --border-colour: #333;
                --invalid-colour: #e1e1e1;
            }
        }

        @media (prefers-color-scheme: light) {
            :root {
                --background-colour: #f5f5f5;
                --card-colour: #ffffff;
                --text-colour: #1a1a1a;
                --text-muted: #666;
                --tint-colour: #f8f8f8;
                --border-colour: #e0e0e0;
                --invalid-colour: #e1e1e1;
            }
        }

        * {
            box-sizing: border-box;
        }

        html {
            font-size: var(--font-size);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            background-color: var(--background-colour);
            color: var(--text-colour);
        }

        body {
            margin: 0;
            padding: 1rem;
            min-height: 100vh;
        }

        a {
            color: var(--primary);
            text-decoration: none;
        }

        a:hover {
            text-decoration: underline;
        }

        #app {
            max-width: 700px;
            margin: 0 auto;
        }

        header {
            text-align: center;
            margin-bottom: 2rem;
        }

        header h1 {
            margin: 0;
            font-size: 2rem;
            background: linear-gradient(135deg, var(--primary), #a855f7);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }

        header p {
            color: var(--text-muted);
            margin: 0.5rem 0 0;
        }

        form {
            background-color: var(--card-colour);
            padding: 1.5rem;
            border-radius: 1rem;
            border: 1px solid var(--border-colour);
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        }

        #url-input {
            display: flex;
            gap: 0.75rem;
            align-items: stretch;
            flex-wrap: wrap;
        }

        input[type="url"] {
            border: 1px solid var(--border-colour);
            border-radius: 0.5rem;
            flex: 1;
            font-size: 1rem;
            min-width: 200px;
            padding: 0.75rem 1rem;
            background: var(--tint-colour);
            color: var(--text-colour);
            transition: border-color 0.2s, box-shadow 0.2s;
        }

        input[type="url"]:focus {
            outline: none;
            border-color: var(--primary);
            box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2);
        }

        input[type="url"]:not(:placeholder-shown):invalid {
            background: var(--invalid-colour);
        }

        input[type="submit"] {
            background: var(--primary);
            color: white;
            border: none;
            padding: 0.75rem 1.5rem;
            border-radius: 0.5rem;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
            transition: background 0.2s, transform 0.1s;
        }

        input[type="submit"]:hover {
            background: var(--primary-hover);
        }

        input[type="submit"]:active {
            transform: scale(0.98);
        }

        #options {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 1rem;
            margin-top: 1.25rem;
            padding-top: 1.25rem;
            border-top: 1px solid var(--border-colour);
        }

        .option-group {
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }

        .option-group label {
            cursor: pointer;
            font-size: 0.9rem;
        }

        input[type="checkbox"] {
            width: 1.1rem;
            height: 1.1rem;
            accent-color: var(--primary);
            cursor: pointer;
        }

        .badge {
            display: inline-block;
            font-size: 0.7rem;
            padding: 0.15rem 0.4rem;
            border-radius: 0.25rem;
            font-weight: 600;
            text-transform: uppercase;
        }

        .badge-new {
            background: var(--success);
            color: white;
        }

        .badge-pro {
            background: linear-gradient(135deg, var(--primary), #a855f7);
            color: white;
        }

        .strategy-select {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            grid-column: span 2;
        }

        select {
            padding: 0.5rem;
            border-radius: 0.5rem;
            border: 1px solid var(--border-colour);
            background: var(--tint-colour);
            color: var(--text-colour);
            font-size: 0.9rem;
            cursor: pointer;
        }

        article {
            margin-top: 2rem;
        }

        article h2 {
            font-size: 1.2rem;
            margin-bottom: 0.5rem;
        }

        article p {
            color: var(--text-muted);
            line-height: 1.6;
            margin: 0.5rem 0;
        }

        article ul, article ol {
            color: var(--text-muted);
            line-height: 1.8;
            padding-left: 1.5rem;
        }

        .features {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 1rem;
            margin-top: 1.5rem;
        }

        .feature-card {
            background: var(--card-colour);
            padding: 1rem;
            border-radius: 0.75rem;
            border: 1px solid var(--border-colour);
        }

        .feature-card h3 {
            margin: 0 0 0.5rem;
            font-size: 1rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }

        .feature-card p {
            margin: 0;
            font-size: 0.85rem;
        }

        .api-section {
            margin-top: 2rem;
            padding: 1rem;
            background: var(--tint-colour);
            border-radius: 0.75rem;
            border: 1px solid var(--border-colour);
        }

        .api-section h3 {
            margin: 0 0 1rem;
        }

        code {
            background: var(--background-colour);
            padding: 0.2rem 0.4rem;
            border-radius: 0.25rem;
            font-size: 0.85rem;
            word-break: break-all;
        }

        pre {
            background: var(--background-colour);
            padding: 1rem;
            border-radius: 0.5rem;
            overflow-x: auto;
            margin: 0.5rem 0;
        }

        pre code {
            background: none;
            padding: 0;
        }

        footer {
            margin-top: 2rem;
            padding-top: 1rem;
            border-top: 1px solid var(--border-colour);
            text-align: center;
            color: var(--text-muted);
            font-size: 0.85rem;
        }
    </style>
</head>

<body>
    <div id="app">
        <header>
            <h1>🚀 URL to Markdown Pro</h1>
            <p>Convert any URL to clean Markdown with paywall bypass</p>
        </header>

        <main>
            <form action="" method="post">
                <div id="url-input">
                    <input
                        title="URL of the webpage you want to convert"
                        placeholder="https://example.com/article"
                        type="url"
                        name="url"
                        id="url"
                        pattern="http(s)?://.*"
                        required
                        autofocus
                    />
                    <input type="submit" value="Convert" />
                </div>

                <div id="options">
                    <div class="option-group">
                        <input type="checkbox" name="bypass" id="bypass" />
                        <label for="bypass" title="Try multiple strategies to bypass paywalls">
                            🛡️ Paywall Bypass <span class="badge badge-pro">PRO</span>
                        </label>
                    </div>
                    <div class="option-group">
                        <input type="checkbox" name="images" id="images" value="true" checked />
                        <label for="images" title="Keep images in the Markdown output">
                            🖼️ Keep Images <span class="badge badge-new">NEW</span>
                        </label>
                    </div>
                    <div class="option-group">
                        <input type="checkbox" name="download" id="download" />
                        <label for="download" title="Automatically download the converted Markdown as a file">
                            📥 Download File
                        </label>
                    </div>
                    <div class="option-group">
                        <input type="checkbox" name="json" id="json" />
                        <label for="json" title="Export the converted URL in JSON format">
                            📦 JSON Format
                        </label>
                    </div>
                    <div class="strategy-select">
                        <label for="strategy">⚡ Strategy:</label>
                        <select name="strategy" id="strategy">
                            <option value="">Auto (Cascade)</option>
                            <option value="direct">Direct</option>
                            <option value="googlebot">Googlebot</option>
                            <option value="12ft">12ft.io</option>
                            <option value="archive">Archive.org</option>
                            <option value="jina">Jina Reader</option>
                        </select>
                    </div>
                </div>
            </form>

            <article>
                <h2>✨ Features</h2>
                <div class="features">
                    <div class="feature-card">
                        <h3>🛡️ Paywall Bypass</h3>
                        <p>Multi-strategy approach: Googlebot, 12ft.io, Archive.org, Jina Reader</p>
                    </div>
                    <div class="feature-card">
                        <h3>🖼️ Image Support</h3>
                        <p>Preserve images with proper alt text and captions</p>
                    </div>
                    <div class="feature-card">
                        <h3>⚡ Fast & Free</h3>
                        <p>Powered by Deno Deploy edge network</p>
                    </div>
                    <div class="feature-card">
                        <h3>🤖 LLM Ready</h3>
                        <p>Clean Markdown perfect for AI context</p>
                    </div>
                </div>

                <div class="api-section">
                    <h3>🔌 API Usage</h3>
                    <p><strong>GET Request:</strong></p>
                    <pre><code>GET /api?url=https://example.com&bypass=true&images=true</code></pre>
                    <p><strong>Parameters:</strong></p>
                    <ul>
                        <li><code>url</code> - Target URL (required)</li>
                        <li><code>bypass</code> - Enable paywall bypass (true/false)</li>
                        <li><code>images</code> - Keep images (true/false, default: true)</li>
                        <li><code>strategy</code> - Specific strategy (direct/googlebot/12ft/archive/jina)</li>
                        <li><code>format</code> - Output format (json/text)</li>
                    </ul>
                </div>

                <div class="api-section">
                    <h3>🤖 MCP Integration <span class="badge badge-new">NEW</span></h3>
                    <p>Connect with Claude CLI, OpenAI Agents, or any MCP-compatible AI client:</p>
                    <pre><code>claude mcp add --transport sse url2md https://url2md-pro.deno.dev/mcp/sse</code></pre>
                    <p><strong>Available Tools:</strong></p>
                    <ul>
                        <li><code>fetch_url</code> - Fetch single URL and convert to Markdown</li>
                        <li><code>fetch_urls</code> - Batch fetch multiple URLs (max 10)</li>
                    </ul>
                    <p><strong>SSE Endpoints:</strong></p>
                    <ul>
                        <li><code>GET /mcp/sse</code> - Establish SSE connection</li>
                        <li><code>POST /mcp/message?sessionId=...</code> - Send MCP messages</li>
                    </ul>
                </div>
            </article>
        </main>

        <footer>
            <p>
                Enhanced fork by <a href="https://github.com/myh">myh</a> • 
                Original by <a href="https://coderonfire.com">Andrew Mason</a> • 
                <a href="https://github.com/andymason/url-to-markdown">Source</a> • 
                Powered by <a href="https://deno.com/deploy">Deno Deploy</a>
            </p>
        </footer>
    </div>
</body>

</html>
`;

export { indexHtml };
