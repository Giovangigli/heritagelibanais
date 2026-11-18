declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    STUDIO_CONNECTION_KEY?: string;
    N8N_STUDIO_WEBHOOK_TOKEN?: string;
  }
}
