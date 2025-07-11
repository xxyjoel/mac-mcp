import { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express, { Request, Response } from 'express';
import open from 'open';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface GmailAccount {
  email: string;
  credentials: any;
  tokens: any;
  lastRefreshed?: Date;
}

export interface GmailAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
}

export class GmailAuthManager {
  private configPath: string;
  private accounts: Map<string, GmailAccount> = new Map();
  private defaultScopes = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.compose',
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.labels',
    'https://www.googleapis.com/auth/gmail.metadata'
  ];

  constructor(configPath?: string) {
    this.configPath = configPath || path.join(__dirname, '../../.gmail-accounts.json');
    this.loadAccounts();
  }

  /**
   * Load existing accounts from disk
   */
  private async loadAccounts(): Promise<void> {
    try {
      const data = await fs.readFile(this.configPath, 'utf-8');
      const config = JSON.parse(data);
      
      for (const account of config.accounts || []) {
        this.accounts.set(account.email, account);
      }
    } catch (error) {
      // File doesn't exist yet, that's okay
    }
  }

  /**
   * Save accounts to disk
   */
  private async saveAccounts(): Promise<void> {
    const config = {
      accounts: Array.from(this.accounts.values()),
      lastUpdated: new Date().toISOString()
    };
    
    await fs.writeFile(this.configPath, JSON.stringify(config, null, 2));
  }

  /**
   * Set up OAuth2 for a new Gmail account
   */
  async setupAccount(clientId: string, clientSecret: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const oauth2Client = new OAuth2Client({
        clientId,
        clientSecret,
        redirectUri: 'http://localhost:3000/oauth2callback'
      });

      // Generate state for security
      const state = crypto.randomBytes(32).toString('hex');
      
      // Generate auth URL
      const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: this.defaultScopes,
        state: state,
        prompt: 'consent' // Force consent to get refresh token
      });

      // Start local server to receive callback
      const app = express();
      const server = app.listen(3000);

      app.get('/oauth2callback', async (req: Request, res: Response) => {
        try {
          if (req.query.state !== state) {
            throw new Error('State mismatch - possible CSRF attack');
          }

          const code = req.query.code as string;
          const { tokens } = await oauth2Client.getToken(code);
          oauth2Client.setCredentials(tokens);

          // Get user info
          const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
          const profile = await gmail.users.getProfile({ userId: 'me' });
          const email = profile.data.emailAddress!;

          // Save account
          const account: GmailAccount = {
            email,
            credentials: {
              clientId,
              clientSecret,
              redirectUri: 'http://localhost:3000/oauth2callback'
            },
            tokens,
            lastRefreshed: new Date()
          };

          this.accounts.set(email, account);
          await this.saveAccounts();

          res.send(`
            <html>
              <body>
                <h1>Success!</h1>
                <p>Account ${email} has been authorized.</p>
                <p>You can close this window now.</p>
                <script>setTimeout(() => window.close(), 3000);</script>
              </body>
            </html>
          `);

          server.close();
          resolve(email);
        } catch (error) {
          res.status(500).send('Authentication failed: ' + (error as Error).message);
          server.close();
          reject(error);
        }
      });

      console.log('\n🔐 Opening browser for Gmail authorization...');
      console.log('If browser doesn\'t open, visit this URL:');
      console.log(authUrl);
      console.log();
      
      open(authUrl);
    });
  }

  /**
   * Get authenticated client for a specific account
   */
  async getAuthClient(email: string): Promise<OAuth2Client> {
    const account = this.accounts.get(email);
    if (!account) {
      throw new Error(`Account ${email} not found. Run setup first.`);
    }

    const oauth2Client = new OAuth2Client({
      clientId: account.credentials.clientId,
      clientSecret: account.credentials.clientSecret,
      redirectUri: account.credentials.redirectUri
    });

    oauth2Client.setCredentials(account.tokens);

    // Check if token needs refresh
    if (account.tokens.expiry_date && account.tokens.expiry_date <= Date.now()) {
      const { credentials } = await oauth2Client.refreshAccessToken();
      account.tokens = credentials;
      account.lastRefreshed = new Date();
      await this.saveAccounts();
    }

    return oauth2Client;
  }

  /**
   * Get all configured accounts
   */
  getAccounts(): string[] {
    return Array.from(this.accounts.keys());
  }

  /**
   * Remove an account
   */
  async removeAccount(email: string): Promise<void> {
    this.accounts.delete(email);
    await this.saveAccounts();
  }

  /**
   * Get Gmail API client for an account
   */
  async getGmailClient(email: string) {
    const auth = await this.getAuthClient(email);
    return google.gmail({ version: 'v1', auth });
  }
}