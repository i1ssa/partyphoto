import { getCurrentUser } from "@backend/lib/auth";
import { authFailure, authResponse } from "@backend/lib/auth-http";


export async function GET() {
  try {
    const user = await getCurrentUser();
    return user ? authResponse({ user }) : authResponse({ error: "Войдите в аккаунт." }, 401);
  } catch (error) { return authFailure(error); }
}
