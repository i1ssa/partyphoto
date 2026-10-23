import { getCurrentUser } from "@backend/lib/auth";
import { AuthError, authFailure, authResponse } from "@backend/lib/auth-http";
import { listAdminEvents } from "@backend/lib/admin";

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) throw new AuthError(401, "Войдите в аккаунт.");
    return authResponse(await listAdminEvents(new URL(request.url).searchParams, user));
  } catch (error) { return authFailure(error); }
}
