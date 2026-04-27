"use strict";
// Run once to acquire the initial GGG OAuth token pair:
// npx ts-node tools/ggg-auth.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const http_1 = __importDefault(require("http"));
const url_1 = require("url");
const fs_1 = __importDefault(require("fs"));
const CLIENT_ID = process.env.GGG_CLIENT_ID;
const CLIENT_SECRET = process.env.GGG_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:9999/callback';
const SCOPES = 'service:leagues service:leagues:ladder service:trade';
const authUrl = `https://www.pathofexile.com/oauth/authorize?` +
    `client_id=${CLIENT_ID}&response_type=code&scope=${encodeURIComponent(SCOPES)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&state=precursor_init`;
console.log('\nOpen this URL in your browser to authorise:\n');
console.log(authUrl);
console.log('\nWaiting for callback on http://localhost:9999/callback ...\n');
const server = http_1.default.createServer(async (req, res) => {
    const url = new url_1.URL(req.url, 'http://localhost:9999');
    const code = url.searchParams.get('code');
    if (!code) {
        res.end('No code received. Try again.');
        return;
    }
    const tokenRes = await fetch('https://www.pathofexile.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            redirect_uri: REDIRECT_URI,
            code,
        }),
    });
    if (!tokenRes.ok) {
        const body = await tokenRes.text();
        res.end(`Token exchange failed: ${tokenRes.status} ${body}`);
        server.close();
        return;
    }
    const token = await tokenRes.json();
    const stored = {
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        expires_at: Date.now() + token.expires_in * 1000,
    };
    const tokenPath = process.env.GGG_TOKEN_STORE ?? './ggg-token.json';
    fs_1.default.writeFileSync(tokenPath, JSON.stringify(stored, null, 2));
    console.log(`Token saved to ${tokenPath}`);
    res.end('Auth complete. You can close this tab.');
    server.close();
});
server.listen(9999);
//# sourceMappingURL=ggg-auth.js.map