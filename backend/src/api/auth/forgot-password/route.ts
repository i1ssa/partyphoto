import { after } from "next/server";
import { appOrigin, authFailure, authResponse, readAuthJson } from "@backend/lib/auth-http";
import { deliverForgotPassword, forgotPasswordMessage, limitForgotPassword, parseForgotPassword } from "@backend/lib/forgot-password";
import { getResetMailConfig } from "@backend/lib/reset-email";


export async function POST(request: Request) {
  try {
    const input = parseForgotPassword(await readAuthJson(request));
    // Missing mail configuration fails uniformly, before any account lookup.
    const config = getResetMailConfig();
    const origin = appOrigin();
    await limitForgotPassword(input.email);
    after(() => deliverForgotPassword(input.email, origin, config));
    const response = authResponse({ ok: true, message: forgotPasswordMessage });
    // The adapter validates this override as loopback-only and forbids it in
    // production. Tests verify transport before requesting any real fixture.
    if (config.endpoint.startsWith("http://")) response.headers.set("X-PartyPhoto-Mail-Transport", "local-test");
    return response;
  } catch (error) { return authFailure(error); }
}
