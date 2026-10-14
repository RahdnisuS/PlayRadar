// Scripts share the app's DB module; importing ./env first loads .env.local.
import "./env";
export { q, tx, closeDb } from "../lib/db";
