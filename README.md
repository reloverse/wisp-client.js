# wisp-client.js

A Wisp 1.2 compliant that runs in the web licensed under the [MPL](LICENSE) that is also not written in TypeShit™!

An example html (with the file pinned to commit aa1d8e3, replace with dist if you want but I would pin to a hash incase something breaks when I release new code) example would be:
```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <title>Wisp Test</title>
    <script src="https://cdn.jsdelivr.net/gh/reloverse/wisp-client.js@aa1d8e3/wisp-client.bundle.js"></script>
  </head>
  <body>
    <h1>Wisp Test</h1>
    <pre id="output"></pre>
    <script>
      const output = document.getElementById('output');
      const wispUrl = "wss://wisp.mercurywork.shop/";
      const conn = new WispClient.WispConnection(wispUrl);

      conn.addEventListener("open", () => {
        const stream = conn.create_stream("example.com", 80, "tcp");

        stream.addEventListener("message", (event) => {
          const data = event.data;
          const text = new TextDecoder().decode(data);
          output.textContent+=text;
        });

        const request = `GET / HTTP/1.1
Host: www.example.com
Connection: close

`;
        stream.send(new TextEncoder().encode(request));
      });
    </script>
  </body>
</html>
```

First install it with `npm i https://github.com/reloverse/wisp-client.js.git` then you could write something like
```js
import { WispConnection } from "wisp-client";

const wispUrl = "wss://wisp.mercurywork.shop/";
const conn = new WispConnection(wispUrl);

conn.addEventListener("open", () => {
  const stream = conn.create_stream("example.com", 80, "tcp");

  stream.addEventListener("message", (event) => {
    const data = event.data;
    const text = new TextDecoder().decode(data);
    console.log(text);
  });

  const request =`GET / HTTP/1.1
Host: example.com
Connection: close

`;

  stream.send(new TextEncoder().encode(request));
});
```

Running below Node v22.4.0 is no supported as the WebSocket API was not marked stable. It will LIKELY work fine from node 22, and in node 21 you will need to run with `--experimental-websocket`. Before that you will have to monkeypatch something on if you want it to work, I would recommed running Node v24 LTS.
