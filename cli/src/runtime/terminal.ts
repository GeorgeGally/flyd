import { createInterface } from "readline/promises";
import type { Interface } from "readline/promises";
import { stdin, stdout } from "process";

export class NodeTerminal {
  private readonly interface: Interface;

  constructor() {
    this.interface = createInterface({ input: stdin, output: stdout });
  }

  write(message: string): void {
    stdout.write(message);
  }

  async ask(prompt: string): Promise<string> {
    return this.interface.question(`${prompt} `);
  }

  async confirm(prompt: string): Promise<boolean> {
    const answer = (await this.ask(`${prompt} [y/N]`)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  }

  async close(): Promise<void> {
    this.interface.close();
  }
}
