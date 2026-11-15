
const http = require("http");

function formatDate(value) {
  if (!value) return "your selected date";

  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return String(value);

  const [, year, month, day] = match;

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC"
  }).format(new Date(Date.UTC(+year, +month - 1, +day)));
}

function formatTime(value) {
  if (!value) return "your selected time";

  const match = String(value).match(/T(\d{2}):(\d{2})/);
  if (!match) return String(value);

  const hour = Number(match[1]);
  const minute = match[2];
  const hour12 = hour % 12 || 12;
  const period = hour >= 12 ? "PM" : "AM";

  return `${hour12}${minute === "00" ? "" : ":" + minute} ${period}`;
}

const server = http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "POST" || req.url !== "/webhook") {
    res.writeHead(404);
    return res.end(JSON.stringify({ error: "Not found" }));
  }

  let body = "";

  req.on("data", chunk => {
    body += chunk;
  });

  req.on("end", () => {
    try {
      const data = JSON.parse(body);
      const p = data.queryResult?.parameters || {};

      const name = p.customer_name || "there";
      const treatment = p.treatment || "your treatment";
      const date = formatDate(p.date);
      const time = formatTime(p.time);
      const phone = p.phone_number || "your provided number";

      const message =
        `Thank you, ${name}! 💕 You've requested a ${treatment} ` +
        `appointment on ${date} at ${time}, using ${phone} ` +
        `as your contact number. Does everything look correct?`;

      res.writeHead(200);
      res.end(JSON.stringify({ fulfillmentText: message }));
    } catch (error) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: "Invalid request" }));
    }
  });
});

server.listen(process.env.PORT || 3000);
