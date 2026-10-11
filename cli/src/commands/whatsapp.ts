import qr from "qrcode-terminal";
import { whatsappClient } from "../connectors/whatsapp.js";
import { loadFlydEnvironment } from "../lib/config.js";

export async function runWhatsApp(args: string[]): Promise<void> {
  loadFlydEnvironment();
  const [action = "status"] = args;
  const client = whatsappClient();
  const stop = () => { client.stop(); process.exit(0); };
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try {
    if (action === "status") { console.log(JSON.stringify(client.status(), null, 2)); return; }
    if (action === "connect") {
      console.log("Link Flyd from WhatsApp Settings → Linked Devices → Link a Device. Keep WhatsApp installed for account recovery.");
      await client.connect(code => qr.generate(code, { small: true }));
      console.log("WhatsApp linked. Leave this running briefly for history sync; press Ctrl+C before using WhatsApp in Flyd Core.");
      return await new Promise<void>(() => {});
    }
    if (action === "disconnect") {
      // Acquire exclusive connection ownership before destroying local credentials.
      client.disconnectLocal();
      console.log("Removed local pairing, message cache and drafts. Also unlink Flyd in WhatsApp Linked Devices."); return;
    }
    throw new Error("Use flyd whatsapp connect | status | disconnect");
  } finally { client.stop(); }
}
