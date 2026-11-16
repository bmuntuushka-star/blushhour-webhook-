
const http = require("http");

const FIELDS = [
  "treatment", "date", "time",
  "customer_name", "phone_number"
];

const PROMPTS = {
  treatment: "Which treatment would you prefer instead?",
  date: "What date would you prefer instead?",
  time: "What time would you prefer instead?",
  customer_name: "What name should I use instead?",
  phone_number: "What phone number should I use instead?"
};

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
  const match = String(value).match(/T(\d{2}):(\d{2})/)
    || String(value).match(/^(\d{2}):(\d{2})/);
  if (!match) return String(value);

  const hour = Number(match[1]);
  const minute = match[2];
  return `${hour % 12 || 12}${minute === "00" ? "" : ":" + minute} ${hour >= 12 ? "PM" : "AM"}`;
}

function summary(p) {
  return `Thank you, ${p.customer_name || "there"}! 💕 ` +
    `You've requested a ${p.treatment || "treatment"} appointment ` +
    `on ${formatDate(p.date)} at ${formatTime(p.time)}, ` +
    `using ${p.phone_number || "your provided number"} ` +
    `as your contact number. Does everything look correct?`;
}

function findContext(contexts) {
  return (contexts || []).find(c =>
    c.name?.toLowerCase().endsWith("/contexts/blushhour-edit")
  );
}

function detectField(text) {
  const s = String(text || "").toLowerCase();
  if (/phone|number|contact|mobile/.test(s)) return "phone_number";
  if (/date|day/.test(s)) return "date";
  if (/time|hour/.test(s)) return "time";
  if (/treatment|service|manicure|pedicure|facial|massage|hair|nail|spa/.test(s))
    return "treatment";
  if (/name|spelling/.test(s)) return "customer_name";
  return null;
}

function replacement(field, data) {
  const p = data.queryResult?.parameters || {};
  const text = String(data.queryResult?.queryText || "").trim();

  if (field === "date") {
    const value = String(p.date || text);
    const match = value.match(/\d{4}-\d{2}-\d{2}/);
    return match ? match[0] : null;
  }

  if (field === "time") {
    const value = String(p.time || text);
    const iso = value.match(/T(\d{2}):(\d{2})/);
    if (iso) return `T${iso[1]}:${iso[2]}`;

    const m = text.match(/\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)\b/i);
    if (m) {
      const hour = Number(m[1]) % 12 +
        (m[3].toLowerCase() === "pm" ? 12 : 0);
      return `T${String(hour).padStart(2, "0")}:${m[2] || "00"}`;
    }
    const h24 = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    return h24 ? `T${h24[1].padStart(2, "0")}:${h24[2]}` : null;
  }

  if (field === "phone_number") {
    return /^\+?[\d\s()-]{8,20}$/.test(text) ? text : null;
  }

  if (field === "customer_name") {
    return /^[\p{L}][\p{L}\s.'-]{1,79}$/u.test(text) ? text : null;
  }

  if (field === "treatment") {
    return text.length >= 3 && text.length <= 100 ? text : null;
  }

  return null;
}

function send(res, message, contexts = []) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    fulfillmentText: message,
    outputContexts: contexts
  }));
}

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/webhook") {
    res.writeHead(404);
    return res.end(JSON.stringify({ error: "Not found" }));
  }

  let body = "";

  req.on("data", chunk => {
    body += chunk;
    if (body.length > 100000) req.destroy();
  });

  req.on("end", () => {
    try {
      const data = JSON.parse(body);
      const qr = data.queryResult || {};
      const session = data.session;

      if (!session) {
        return send(res, "Sorry, please try again.");
      }

      const saved = findContext(qr.outputContexts);
      const state = saved?.parameters || {};
      const current = {};

      for (const field of FIELDS) {
        current[field] = state[field] || qr.parameters?.[field] || "";
      }

      const intent = qr.intent?.displayName || "";
      const contextName = `${session}/contexts/blushhour-edit`;

      function keep(values, lifespan = 20) {
        return [{
          name: contextName,
          lifespanCount: lifespan,
          parameters: values
        }];
      }

      if (intent === "BookAppointment") {
        const p = qr.parameters || {};
        return send(res, summary(p), keep({
          ...p, stage: "review", pending: ""
        }));
      }

      if (intent === "BookAppointment - yes") {
        return send(res,
          "Thank you for choosing Blush Hour! 💕 " +
          "Your appointment request has been received. " +
          "Our team will contact you to confirm availability " +
          "and finalize your booking.",
          keep({}, 0)
        );
      }

      if (intent === "BookAppointment - no") {
        return send(res,
          "No problem at all! Which detail would you like " +
          "to change: treatment, date, time, name, or phone number?",
          keep({ ...current, stage: "choose", pending: "" })
        );
      }

      // NEW: Update the selected treatment
      if (intent === "UpdateAppointmentTreatment") {
        const treatment = qr.parameters?.treatment;

        if (!treatment) {
          return send(res,
            "Which treatment would you prefer instead?",
            keep({ ...current, stage: "replace", pending: "treatment" })
          );
        }

        current.treatment = treatment;

        return send(res,
          `I've updated your treatment! 💕 ${summary(current)}`,
          keep({ ...current, stage: "review", pending: "" })
        );
      }

      if (intent === "ChangeAppointmentDetails") {
        const field = detectField(qr.queryText)
          || detectField(qr.parameters?.detail_to_change);

        if (!field) {
          return send(res,
            "Of course! 💕 Which detail would you like to change: " +
            "treatment, date, time, name, or phone number?",
            keep({ ...current, stage: "choose", pending: "" })
          );
        }

        return send(res,
          `Of course! 💕 ${PROMPTS[field]}`,
          keep({ ...current, stage: "replace", pending: field })
        );
      }

      if (state.stage === "choose") {
        const field = detectField(qr.queryText);

        if (!field) {
          return send(res,
            "Please choose: treatment, date, time, name, or phone number.",
            keep({ ...current, stage: "choose", pending: "" })
          );
        }

        return send(res, PROMPTS[field],
          keep({ ...current, stage: "replace", pending: field })
        );
      }

      if (state.stage === "replace" && FIELDS.includes(state.pending)) {
        const field = state.pending;
        const value = replacement(field, data);

        if (!value) {
          return send(res,
            `I couldn't recognize that information. ${PROMPTS[field]}`,
            keep({ ...current, stage: "replace", pending: field })
          );
        }

        current[field] = value;

        return send(res,
          `I've updated that detail! 💕 ${summary(current)}`,
          keep({ ...current, stage: "review", pending: "" })
        );
      }

      if (state.stage === "review") {
        const answer = String(qr.queryText || "").trim();

        if (/^(yes|yep|yeah|correct|looks good|confirm|that's right|all good)[.! ]*$/i.test(answer)) {
          return send(res,
            "Thank you for choosing Blush Hour! 💕 " +
            "Your appointment request has been received. " +
            "Our team will contact you to confirm availability " +
            "and finalize your booking.",
            keep({}, 0)
          );
        }

        if (/^(no|nope|incorrect|change|edit|not quite)/i.test(answer)) {
          return send(res,
            "No problem! Which detail would you like to change?",
            keep({ ...current, stage: "choose", pending: "" })
          );
        }
      }

      return send(res,
        "How can I help you with your appointment?"
      );

    } catch (error) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid request" }));
    }
  });
});

server.listen(process.env.PORT || 3000);
