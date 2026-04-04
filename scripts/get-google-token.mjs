/**
 * get-google-token.mjs
 *
 * One-time script to obtain a Google OAuth2 refresh token for the Calendar API.
 *
 * Usage:
 *   node scripts/get-google-token.mjs
 *
 * Before running:
 *   1. Go to https://console.cloud.google.com
 *   2. Create a project (or use an existing one)
 *   3. Enable the "Google Calendar API"
 *   4. Create OAuth 2.0 credentials (Desktop app type)
 *   5. Copy the client_id and client_secret into your .env file:
 *        GOOGLE_CLIENT_ID=...
 *        GOOGLE_CLIENT_SECRET=...
 */

import { createServer } from "http";
import { google } from "googleapis";
import { config } from "dotenv";

config();

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your .env file first.");
  process.exit(1);
}

const PORT = 3333;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

const auth = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, REDIRECT_URI);

const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/gmail.readonly",
];

const authUrl = auth.generateAuthUrl({
  access_type: "offline",
  scope: SCOPES,
  prompt: "consent",
});

console.log("\nAbriendo el navegador para autorizar...");
console.log("\nSi no se abre automáticamente, copia esta URL en el browser:\n");
console.log(authUrl);
console.log(`\nEsperando respuesta en http://localhost:${PORT}...\n`);

// Open browser automatically
const { exec } = await import("child_process");
const cmd =
  process.platform === "win32"
    ? `start "" "${authUrl}"`
    : process.platform === "darwin"
      ? `open "${authUrl}"`
      : `xdg-open "${authUrl}"`;
exec(cmd);

// Local HTTP server to capture the code from Google's redirect
const server = createServer(async (req, res) => {
  if (!req.url?.startsWith("/oauth2callback")) return;

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    res.end(`<h2>Error: ${error}</h2><p>Puedes cerrar esta ventana.</p>`);
    server.close();
    console.error(`\nError de autorización: ${error}`);
    process.exit(1);
  }

  try {
    const { tokens } = await auth.getToken(code);
    res.end(
      "<h2>✅ Autorización exitosa!</h2><p>Puedes cerrar esta ventana y volver a la terminal.</p>",
    );
    server.close();
    console.log("\n✅ Éxito! Agrega esto a tu archivo .env:\n");
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log("\nLuego ejecuta: node scripts/register-google-calendar.mjs\n");
  } catch (err) {
    res.end(`<h2>Error al obtener token</h2><pre>${err.message}</pre>`);
    server.close();
    console.error("Error al intercambiar el código:", err.message);
    process.exit(1);
  }
});

server.listen(PORT);
