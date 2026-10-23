import { getCurrentUser } from "@backend/lib/auth";
import { authFailure, authResponse, AuthError, readAuthJson } from "@backend/lib/auth-http";
import { consumeRateLimit } from "@backend/lib/auth-rate-limit";
import { createEvent, listEvents } from "@backend/lib/events";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) throw new AuthError(401, "Войдите в аккаунт.");
    return authResponse({ events: await listEvents(user) });
  } catch (error) { return authFailure(error); }
}

export async function POST(request: Request) {
  try {
    const input = await readAuthJson(request);
    const user = await getCurrentUser();
    if (!user) throw new AuthError(401, "Войдите в аккаунт.");
    await consumeRateLimit(`event:create:${user.id}`, 60, 3600);
    return authResponse({ event: await createEvent(input, user) }, 201);
  } catch (error) { return authFailure(error); }
}
