declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    STUDIO_CONNECTION_KEY?: string;
    N8N_STUDIO_WEBHOOK_TOKEN?: string;
    BREVO_API_KEY?: string;
    STUDIO_OWNER_EMAIL?: string;
    STUDIO_OWNER_USER_ID?: string;
    STUDIO_EDITOR_EMAILS?: string;
    STUDIO_MAILING_EDITOR_EMAILS?: string;
  }
}
