import { getCurrentUser } from "@backend/lib/auth";
import { AuthError, authFailure, authResponse } from "@backend/lib/auth-http";
import { getAdminOverview } from "@backend/lib/admin";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) throw new AuthError(401, "Войдите в аккаунт.");
    return authResponse({ overview: await getAdminOverview(user) });
  } catch (error) { return authFailure(error); }
}
