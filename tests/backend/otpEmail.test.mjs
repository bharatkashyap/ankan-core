import test from "node:test";
import assert from "node:assert/strict";
import { sendOtpEmail } from "../../convex/lib/otpEmail.ts";

test("OTP email uses ZeptoMail directly with the configured sender", async () => {
  const previous = {
    apiKey: process.env.ZEPTOMAIL_SEND_API_KEY,
    from: process.env.ZEPTOMAIL_FROM_ADDRESS,
    url: process.env.ZEPTOMAIL_API_URL,
  };
  process.env.ZEPTOMAIL_SEND_API_KEY = "test-key";
  process.env.ZEPTOMAIL_FROM_ADDRESS = "login@ankan.app";
  process.env.ZEPTOMAIL_API_URL = "https://cpaas.zoho.com/v1.1/email";

  try {
    let sent = false;
    await sendOtpEmail("person@example.com", "004271", async (url, init) => {
      sent = true;
      assert.equal(url, "https://cpaas.zoho.com/v1.1/email");
      assert.equal(init.method, "POST");
      assert.equal(init.headers.Authorization, "Zoho-enczapikey test-key");
      const body = JSON.parse(init.body);
      assert.deepEqual(body.from, { address: "login@ankan.app", name: "Ankan" });
      assert.deepEqual(body.to, [{ email_address: { address: "person@example.com" } }]);
      assert.match(body.textbody, /004271/);
      assert.match(body.htmlbody, /004271/);
      return new Response(null, { status: 200 });
    });
    assert.equal(sent, true);
  } finally {
    for (const [key, value] of Object.entries({
      ZEPTOMAIL_SEND_API_KEY: previous.apiKey,
      ZEPTOMAIL_FROM_ADDRESS: previous.from,
      ZEPTOMAIL_API_URL: previous.url,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("OTP email fails closed without a key and on provider errors", async () => {
  const previous = process.env.ZEPTOMAIL_SEND_API_KEY;
  delete process.env.ZEPTOMAIL_SEND_API_KEY;
  try {
    await assert.rejects(
      sendOtpEmail("person@example.com", "123456", async () => {
        throw new Error("must not send");
      }),
      /API key is not configured/,
    );
    process.env.ZEPTOMAIL_SEND_API_KEY = "test-key";
    await assert.rejects(
      sendOtpEmail("person@example.com", "123456", async () =>
        new Response(null, { status: 401 }),
      ),
      /ZeptoMail returned HTTP 401/,
    );
  } finally {
    if (previous === undefined) delete process.env.ZEPTOMAIL_SEND_API_KEY;
    else process.env.ZEPTOMAIL_SEND_API_KEY = previous;
  }
});

test("OTP email accepts the full authorization value copied from Zoho", async () => {
  const previous = process.env.ZEPTOMAIL_SEND_API_KEY;
  process.env.ZEPTOMAIL_SEND_API_KEY = "Zoho-enczapikey test-key";
  try {
    await sendOtpEmail("person@example.com", "123456", async (_url, init) => {
      assert.equal(init.headers.Authorization, "Zoho-enczapikey test-key");
      return new Response(null, { status: 200 });
    });
  } finally {
    if (previous === undefined) delete process.env.ZEPTOMAIL_SEND_API_KEY;
    else process.env.ZEPTOMAIL_SEND_API_KEY = previous;
  }
});
