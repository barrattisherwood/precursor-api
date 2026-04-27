import fs from 'fs';

export interface GGGCharacter {
  name: string;
  class: string;
  ascendancyClass: string;
  level: number;
  experience: number;
  depth?: { default: number; solo: number };
  skills?: Array<{ id: string; level: number }>;
  passives?: { hashes: number[] };
  items?: GGGItem[];
}

export interface GGGItem {
  name: string;
  typeLine: string;
  explicitMods?: string[];
  implicitMods?: string[];
  craftedMods?: string[];
  enchantMods?: string[];
}

interface GGGToken {
  access_token: string;
  refresh_token: string;
  expires_at: number; // Unix ms
}

class GGGApiAdapter {
  private token: GGGToken | null = null;
  private readonly tokenPath = process.env.GGG_TOKEN_STORE ?? './ggg-token.json';

  async init(): Promise<void> {
    if (fs.existsSync(this.tokenPath)) {
      this.token = JSON.parse(fs.readFileSync(this.tokenPath, 'utf-8')) as GGGToken;
    }
  }

  private async ensureValidToken(): Promise<string> {
    if (!this.token) {
      throw new Error('GGG token not initialised. Run tools/ggg-auth.ts first.');
    }
    if (Date.now() > this.token.expires_at - 300_000) {
      this.token = await this.refreshToken(this.token.refresh_token);
      fs.writeFileSync(this.tokenPath, JSON.stringify(this.token, null, 2));
    }
    return this.token.access_token;
  }

  private async refreshToken(refreshToken: string): Promise<GGGToken> {
    const res = await fetch('https://www.pathofexile.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: process.env.GGG_CLIENT_ID!,
        client_secret: process.env.GGG_CLIENT_SECRET!,
        refresh_token: refreshToken,
      }),
    });
    if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
    const data = await res.json() as { access_token: string; refresh_token: string; expires_in: number };
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000,
    };
  }

  async fetchLadder(league: string, limit = 1000): Promise<GGGCharacter[]> {
    const token = await this.ensureValidToken();
    const characters: GGGCharacter[] = [];
    const pageSize = 200;

    for (let offset = 0; offset < limit; offset += pageSize) {
      const res = await this.fetchWithRetry(
        `${process.env.GGG_API_BASE}/league/${encodeURIComponent(league)}/ladder` +
          `?limit=${Math.min(pageSize, limit - offset)}&offset=${offset}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const data = await res.json() as { entries: Array<{ character: GGGCharacter }> };
      characters.push(...data.entries.map(e => e.character));
      if (data.entries.length < pageSize) break;
    }

    return characters;
  }

  async fetchCurrencyExchange(league: string): Promise<unknown> {
    const token = await this.ensureValidToken();
    const res = await this.fetchWithRetry(
      `${process.env.GGG_API_BASE}/trade2/data/stats?league=${encodeURIComponent(league)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    return res.json();
  }

  // Exponential backoff — GGG rate limits are strict
  private async fetchWithRetry(
    url: string,
    options: RequestInit,
    retries = 4,
  ): Promise<Response> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      const res = await fetch(url, options);
      if (res.ok) return res;
      if (res.status === 429 || res.status >= 500) {
        if (attempt === retries) {
          throw new Error(`GGG API failed after ${retries} retries: ${res.status}`);
        }
        const delay = Math.pow(2, attempt) * 1000 + Math.random() * 500;
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw new Error(`GGG API error: ${res.status} ${url}`);
    }
    throw new Error('Unreachable');
  }
}

export const gggApi = new GGGApiAdapter();
