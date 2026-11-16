
const http = require("http");

const FIELDS = [
  "treatment",
  "date",
  "time",
  "customer_name",
  "phone_number"
];

const HOURS_MESSAGE =
  "BlushHour is open every day from 9 AM to 10 PM. 💕 " +
  "Please choose a time from 9 AM through 10 PM.";

const PROMPTS = {
  treatment: "Which treatment would you prefer instead?",
  date: "What date would you prefer instead?",
  time:
    "What time would you prefer instead? 💕 " +
    "We're open every day from 9 AM to 10 PM.",
  customer_name: "What name should I use instead?",
  phone_number: "What phone number should I use instead?"
};

// FORMAT THE APPOINTMENT DATE
function formatDate(value) {
  if (!value) return "your selected date";

  const match = String(value).match(
    /^(\d{4})-(\d{2})-(\d{2})/
  );

  if (!match) return String(value);

  const [, year, month, day] = match;

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC"
  }).format(
    new Date(Date.UTC(+year, +month - 1, +day))
  );
}

// FORMAT TIME AS AM OR PM
function formatTime(value) {
  if (!value) return "your selected time";

  const match =
    String(value).match(/T(\d{2}):(\d{2})/) ||
    String(value).match(/^(\d{1,2}):(\d{2})/);

  if (!match) return String(value);

  const hour = Number(match[1]);
  const minute = match[2];

  return (
    `${hour % 12 || 12}` +
    (minute === "00" ? "" : ":" + minute) +
    (hour >= 12 ? " PM" : " AM")
  );
}

// CHECK OPENING HOURS: 9 AM TO 10 PM DAILY
function isValidOpeningTime(value) {
  if (!value) return false;

  const match =
    String(value).match(/T(\d{2}):(\d{2})/) ||
    String(value).match(/^(\d{1,2}):(\d{2})/);

  if (!match) return false;

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  if (
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return false;
  }

  const totalMinutes = hour * 60 + minute;

  return (
    totalMinutes >= 9 * 60 &&
    totalMinutes <= 22 * 60
  );
}

// APPOINTMENT SUMMARY
function appointmentDetails(p) {
  return (
    `You've requested a ${p.treatment || "treatment"} appointment ` +
    `on ${formatDate(p.date)} at ${formatTime(p.time)}, ` +
    `using ${p.phone_number || "your provided number"} ` +
    `as your contact number. Does everything look correct?`
  );
}

function summary(p) {
  return (
    `Thank you, ${p.customer_name || "there"}! 💕 ` +
    appointmentDetails(p)
  );
}

function updatedSummary(p, detail) {
  return (
    `I've updated your ${detail}, ` +
    `${p.customer_name || "there"}! 💕 ` +
    `Here's your updated appointment request: ` +
    appointmentDetails(p)
  );
}

function confirmationMessage(edited = false) {
  return (
    "Thank you for choosing BlushHour! 💕 " +
    `Your ${edited ? "updated " : ""}appointment request ` +
    "has been received successfully. " +
    "Our team will contact you shortly to confirm " +
    "availability and finalize your booking. " +
    "We look forward to welcoming you!"
  );
}

// FIND AN EXISTING DIALOGFLOW CONTEXT
function findContext(contexts, suffix) {
  return (contexts || []).find(c =>
    c.name?.toLowerCase().endsWith(
      `/contexts/${suffix.toLowerCase()}`
    )
  );
}

// IDENTIFY THE DETAIL TO CHANGE
function detectField(text) {
  const s = String(text || "").toLowerCase();

  if (/phone|number|contact|mobile/.test(s))
    return "phone_number";

  if (/date|day/.test(s))
    return "date";

  if (/time|hour/.test(s))
    return "time";

  if (
    /treatment|service|manicure|pedicure|facial|massage|hair|nail|spa/.test(s)
  )
    return "treatment";

  if (/name|spelling/.test(s))
    return "customer_name";

  return null;
}

function isYes(text) {
  const s = String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ");

  return /^(yes|yep|yeah|yup|sure|correct|confirmed|confirm|looks good|looks perfect|all good|that's right|everything is correct|everything looks correct|everything looks good|everything is good|all the details are correct|yes thank you|yes please|yes proceed|yes please confirm|yes everything is correct|yes everything looks correct|yes everything looks good|yes everything is good|yes that's correct|yes everything seems good|yes,? please proceed)$/i.test(s);
}

function isNo(text) {
  const s = String(text || "")
    .toLowerCase()
    .trim();

  return /^(no|nope|incorrect|not correct|not quite|change|edit|something is wrong|i want to change|i need to change)/i.test(s);
}

// EXTRACT REPLACEMENT INFORMATION
function replacement(field, data) {
  const p = data.queryResult?.parameters || {};

  const text = String(
    data.queryResult?.queryText || ""
  ).trim();

  if (field === "date") {
    const value = String(
      p.new_date || p.date || text
    );

    const match = value.match(
      /\d{4}-\d{2}-\d{2}/
    );

    return match ? match[0] : null;
  }

  if (field === "time") {
    const value = String(p.time || text);

    // Prefer the user's latest typed time over an old parameter.
    const typed = text.match(
      /\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)\b/i
    );
    if (typed) {
      const hour = Number(typed[1]) % 12 +
        (typed[3].toLowerCase() === "pm" ? 12 : 0);
      return `T${String(hour).padStart(2, "0")}:${typed[2] || "00"}`;
    }

    const iso = value.match(
      /T(\d{2}):(\d{2})/
    );

    if (iso) {
      return `T${iso[1]}:${iso[2]}`;
    }

    const m = text.match(
      /\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)\b/i
    );

    if (m) {
      const hour =
        Number(m[1]) % 12 +
        (m[3].toLowerCase() === "pm" ? 12 : 0);

      return (
        `T${String(hour).padStart(2, "0")}:` +
        `${m[2] || "00"}`
      );
    }

    const h24 = text.match(
      /\b([01]?\d|2[0-3]):([0-5]\d)\b/
    );

    return h24
      ? `T${h24[1].padStart(2, "0")}:${h24[2]}`
      : null;
  }

  if (field === "phone_number") {
    return /^\+?[\d\s()-]{8,20}$/.test(text)
      ? text
      : null;
  }

  if (field === "customer_name") {
    return /^[\p{L}][\p{L}\s.'-]{1,79}$/u.test(text)
      ? text
      : null;
  }

  if (field === "treatment") {
    return text.length >= 3 &&
      text.length <= 100
      ? text
      : null;
  }

  return null;
}

// SEND RESPONSE TO DIALOGFLOW
function send(res, message, contexts = []) {
  res.writeHead(200, {
    "Content-Type": "application/json"
  });

  res.end(JSON.stringify({
    fulfillmentText: message,
    outputContexts: contexts
  }));
}

const server = http.createServer((req, res) => {
  if (
    req.method !== "POST" ||
    req.url !== "/webhook"
  ) {
    res.writeHead(404, {
      "Content-Type": "application/json"
    });

    return res.end(
      JSON.stringify({ error: "Not found" })
    );
  }

  let body = "";

  req.on("data", chunk => {
    body += chunk;

    if (body.length > 100000) {
      req.destroy();
    }
  });

  req.on("end", () => {
    try {
      const data = JSON.parse(body);
      const qr = data.queryResult || {};
      const session = data.session;

      if (!session) {
        return send(
          res,
          "Sorry, please try again."
        );
      }

      const intent =
        qr.intent?.displayName || "";

      const text = String(
        qr.queryText || ""
      ).trim();

      // SEPARATE BOOKING AND EDITING CONTEXTS
      const bookingContextName =
        `${session}/contexts/blushhour-booking`;

      const editContextName =
        `${session}/contexts/blushhour-edit`;

      const bookingContext = findContext(
        qr.outputContexts,
        "blushhour-booking"
      );

      const editContext = findContext(
        qr.outputContexts,
        "blushhour-edit"
      );

      const activeContext =
        editContext || bookingContext;

      const state =
        activeContext?.parameters || {};

      const current = {};

      for (const field of FIELDS) {
        current[field] =
          state[field] ||
          qr.parameters?.[field] ||
          "";
      }

      function keepBooking(
        values,
        lifespan = 20
      ) {
        return [{
          name: bookingContextName,
          lifespanCount: lifespan,
          parameters: values
        }];
      }

      function keepEdit(
        values,
        lifespan = 20
      ) {
        return [{
          name: editContextName,
          lifespanCount: lifespan,
          parameters: values
        }];
      }

      // CLEAR OLD EDIT AND FOLLOW-UP CONTEXTS
      function clearOldFlowContexts() {
        return [
          "blushhour-edit",
          "BookAppointment-no-followup",
          "BookAppointmentChangeDate-followup",
          "BookAppointmentChangedDate-followup"
        ].map(name => ({
          name: `${session}/contexts/${name}`,
          lifespanCount: 0
        }));
      }

      // CLEAR ALL APPOINTMENT CONTEXTS
      function clearAppointment() {
        return [
          {
            name: bookingContextName,
            lifespanCount: 0
          },
          {
            name: editContextName,
            lifespanCount: 0
          },
          {
            name:
              `${session}/contexts/BookAppointment-followup`,
            lifespanCount: 0
          },
          {
            name:
              `${session}/contexts/BookAppointment-no-followup`,
            lifespanCount: 0
          },
          {
            name:
              `${session}/contexts/BookAppointmentChangeDate-followup`,
            lifespanCount: 0
          },
          {
            name:
              `${session}/contexts/BookAppointmentChangedDate-followup`,
            lifespanCount: 0
          }
        ];
      }

      // HANDLE A PENDING REPLACEMENT BEFORE INTENT ROUTING.
      // This lets a reply such as "10 am" work even if Dialogflow
      // matches Default Fallback Intent or BookAppointment.
      // 9. SAVE REPLACEMENT INFORMATION
      if (
        state.stage === "replace" &&
        FIELDS.includes(state.pending)
      ) {
        const field = state.pending;
        const value = replacement(
          field,
          data
        );

        if (!value) {
          return send(
            res,
            `I couldn't recognize that information. ${PROMPTS[field]}`,
            editContext
              ? keepEdit({
                  ...current,
                  stage: "replace",
                  pending: field
                })
              : keepBooking({
                  ...current,
                  stage: "replace",
                  pending: field
                })
          );
        }

        if (
          field === "time" &&
          !isValidOpeningTime(value)
        ) {
          return send(
            res,
            HOURS_MESSAGE,
            editContext
              ? keepEdit({
                  ...current,
                  stage: "replace",
                  pending: "time"
                })
              : keepBooking({
                  ...current,
                  stage: "replace",
                  pending: "time"
                })
          );
        }

        current[field] = value;

        const detailName = {
          treatment: "treatment",
          date: "appointment date",
          time: "appointment time",
          customer_name: "name",
          phone_number: "phone number"
        };

        return send(
          res,
          updatedSummary(
            current,
            detailName[field]
          ),
          editContext
            ? keepEdit({
                ...current,
                stage: "review",
                pending: ""
              })
            : keepBooking({
                ...current,
                stage: "review",
                pending: ""
              })
        );
      }

      // 1. NEW APPOINTMENT REQUEST
      if (intent === "BookAppointment") {
        const p = qr.parameters || {};

        if (!isValidOpeningTime(p.time)) {
          return send(
            res,
            HOURS_MESSAGE,
            keepBooking({
              ...p,
              stage: "replace",
              pending: "time"
            })
          );
        }

        return send(
          res,
          summary(p),
          [
            ...keepBooking({
              ...p,
              stage: "review",
              pending: ""
            }),
            ...clearOldFlowContexts()
          ]
        );
      }

      // 2. CONFIRM ORIGINAL APPOINTMENT
      if (intent === "BookAppointment - yes") {
        return send(
          res,
          confirmationMessage(false),
          clearAppointment()
        );
      }

      // 3. CUSTOMER WANTS TO CHANGE DETAILS
      if (intent === "BookAppointment - no") {
        return send(
          res,
          "No problem at all! 💕 Which detail would you like to change: treatment, date, time, name, or phone number?",
          [
            ...keepEdit({
              ...current,
              stage: "choose",
              pending: ""
            }),
            {
              name: bookingContextName,
              lifespanCount: 0
            }
          ]
        );
      }

      // 4. CHANGE APPOINTMENT DATE
      if (intent === "BookAppointmentChangeDate") {
        const rawDate = String(
          qr.parameters?.new_date || ""
        );

        const match = rawDate.match(
          /\d{4}-\d{2}-\d{2}/
        );

        if (!match) {
          return send(
            res,
            "Sorry, I couldn't recognize that date. Could you please provide it again?",
            keepEdit({
              ...current,
              stage: "replace",
              pending: "date"
            })
          );
        }

        current.date = match[0];

        return send(
          res,
          updatedSummary(
            current,
            "appointment date"
          ),
          keepEdit({
            ...current,
            stage: "review",
            pending: ""
          })
        );
      }

      // 5. CHANGE APPOINTMENT TREATMENT
      if (
        intent === "UpdateAppointmentTreatment"
      ) {
        const treatment =
          qr.parameters?.treatment;

        if (!treatment) {
          return send(
            res,
            PROMPTS.treatment,
            keepEdit({
              ...current,
              stage: "replace",
              pending: "treatment"
            })
          );
        }

        current.treatment = treatment;

        return send(
          res,
          updatedSummary(
            current,
            "treatment"
          ),
          keepEdit({
            ...current,
            stage: "review",
            pending: ""
          })
        );
      }

      // 6. IDENTIFY DETAIL TO CHANGE
      if (
        intent === "ChangeAppointmentDetails"
      ) {
        const field =
          detectField(text) ||
          detectField(
            qr.parameters?.detail_to_change
          );

        if (!field) {
          return send(
            res,
            "Of course! 💕 Which detail would you like to change: treatment, date, time, name, or phone number?",
            keepEdit({
              ...current,
              stage: "choose",
              pending: ""
            })
          );
        }

        return send(
          res,
          `Of course! 💕 ${PROMPTS[field]}`,
          keepEdit({
            ...current,
            stage: "replace",
            pending: field
          })
        );
      }

      // 7. CONFIRM EDITED APPOINTMENT
      if (
        intent === "ConfirmEditedAppointment"
      ) {
        if (isYes(text)) {
          return send(
            res,
            confirmationMessage(true),
            clearAppointment()
          );
        }

        if (isNo(text)) {
          return send(
            res,
            "No problem! Which detail would you like to change?",
            keepEdit({
              ...current,
              stage: "choose",
              pending: ""
            })
          );
        }
      }

      // 8. CUSTOMER CHOOSES DETAIL TO EDIT
      if (state.stage === "choose") {
        const field = detectField(text);

        if (!field) {
          return send(
            res,
            "Please choose: treatment, date, time, name, or phone number.",
            keepEdit({
              ...current,
              stage: "choose",
              pending: ""
            })
          );
        }

        return send(
          res,
          PROMPTS[field],
          keepEdit({
            ...current,
            stage: "replace",
            pending: field
          })
        );
      }

      // 10. FINAL REVIEW AND CONFIRMATION
      if (state.stage === "review") {
        if (isYes(text)) {
          const wasEdited =
            Boolean(editContext);

          return send(
            res,
            confirmationMessage(wasEdited),
            clearAppointment()
          );
        }

        if (isNo(text)) {
          return send(
            res,
            "No problem! Which detail would you like to change?",
            keepEdit({
              ...current,
              stage: "choose",
              pending: ""
            })
          );
        }
      }

      // 11. DEFAULT WEBHOOK RESPONSE
      return send(
        res,
        "How can I help you with your appointment?"
      );

    } catch (error) {
      console.error(
        "Webhook error:",
        error
      );

      res.writeHead(400, {
        "Content-Type": "application/json"
      });

      res.end(JSON.stringify({
        error: "Invalid request"
      }));
    }
  });
});

server.listen(
  process.env.PORT || 3000
);
