import http from "node:http";
const port = 3847;
http.createServer((req, res) => {
  if (req.url === "/ping") {
    res.end("pong");
    return;
  }
  res.end("");
}).listen(port);
