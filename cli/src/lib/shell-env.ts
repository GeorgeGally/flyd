// The environment a shell Flyd runs for George gets: everything Core has,
// minus anything that looks like a credential. A command (or a model reading
// its output) can't print a key it was never given.

const SECRET_NAME = /(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|BEARER|CREDENTIAL|PRIVATE|AUTH|SESSION|COOKIE)/i;

export function shellEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !SECRET_NAME.test(name)));
}
