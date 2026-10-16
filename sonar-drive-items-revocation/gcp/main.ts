import { createServer } from "node:http";
import { serve } from "./server";

const port = Number(process.env.PORT ?? 8080);
createServer(serve).listen(port, () => console.log(JSON.stringify({ msg: "listening", port })));
