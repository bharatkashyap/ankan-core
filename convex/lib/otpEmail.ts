const DEFAULT_ZEPTOMAIL_API_URL = "https://api.zeptomail.com/v1.1/email";

export async function sendOtpEmail(
  email: string,
  token: string,
  send: typeof fetch = fetch,
) {
  const apiKey = process.env.ZEPTOMAIL_SEND_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Failed to send OTP: ZeptoMail API key is not configured");
  }

  const textbody = `Your Ankan verification code is ${token}. It expires in one hour. If you did not request this code, you can ignore this email.`;
  const response = await send(
    process.env.ZEPTOMAIL_API_URL || DEFAULT_ZEPTOMAIL_API_URL,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: apiKey.startsWith("Zoho-enczapikey ")
          ? apiKey
          : `Zoho-enczapikey ${apiKey}`,
      },
      body: JSON.stringify({
        from: {
          address: process.env.ZEPTOMAIL_FROM_ADDRESS || "no-reply@ankan.app",
          name: "Ankan",
        },
        to: [{ email_address: { address: email } }],
        subject: "Your Ankan verification code",
        textbody,
        htmlbody: `<p>Your Ankan verification code is <strong>${token}</strong>.</p><p>It expires in one hour. If you did not request this code, you can ignore this email.</p>`,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to send OTP: ZeptoMail returned HTTP ${response.status}`);
  }
}
