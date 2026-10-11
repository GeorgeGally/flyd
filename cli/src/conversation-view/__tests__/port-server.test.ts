import { describe, expect, it } from "vitest";
import { describeServer, nameFromLsof, pidFromLsof, sameServer } from "../port-server.js";

describe("port server", () => {
  it("reads the pid and cwd from lsof's field output", () => {
    expect(pidFromLsof("p96841\ncphp\nf5\nn127.0.0.1:8088\n")).toBe(96841);
    expect(pidFromLsof("")).toBeNull();
    expect(nameFromLsof("p96841\nfcwd\nn/Users/george/Documents/firstmate\n")).toBe("/Users/george/Documents/firstmate");
  });

  it("names php -S and the folder it serves from -t, not its working folder", () => {
    expect(describeServer("php -S 127.0.0.1:8088 -t /Users/george/Documents/good_neighbours", "/Users/george/Documents/firstmate"))
      .toEqual({ command: "php -S", folder: "/Users/george/Documents/good_neighbours" });
    expect(describeServer("php -d display_errors=1 -S 127.0.0.1:8097 -t /data/gnm-preview/site /data/gnm-preview/router.php", "/"))
      .toEqual({ command: "php -S", folder: "/data/gnm-preview/site" });
    expect(describeServer("php -S 127.0.0.1:8088 -t site/", "/work")).toEqual({ command: "php -S", folder: "/work/site" });
  });

  it("names python's http.server, node scripts and anything else by program, serving its working folder", () => {
    expect(describeServer("/usr/bin/python3.12 -m http.server 8000 --directory /srv/www", "/tmp")).toEqual({ command: "python -m http.server", folder: "/srv/www" });
    expect(describeServer("node /app/node_modules/.bin/vite --port 5173", "/app")).toEqual({ command: "node vite", folder: "/app" });
    expect(describeServer("caddy run", "/etc/caddy")).toEqual({ command: "caddy", folder: "/etc/caddy" });
  });

  it("treats a different process, command or folder as a different server", () => {
    const php = { pid: 1, command: "php -S", folder: "/a" };
    expect(sameServer(php, { ...php })).toBe(true);
    expect(sameServer(php, { ...php, pid: 2 })).toBe(false);
    expect(sameServer(php, { ...php, folder: "/b" })).toBe(false);
    expect(sameServer(null, null)).toBe(true);
    expect(sameServer(php, null)).toBe(false);
  });
});
