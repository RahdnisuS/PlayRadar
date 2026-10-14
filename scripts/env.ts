// Load .env.local (Next.js convention) for standalone scripts.
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
