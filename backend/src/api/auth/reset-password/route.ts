import { authFailure, authResponse, readAuthJson } from "@backend/lib/auth-http";
import { resetPassword } from "@backend/lib/password-reset";


export async function POST(request: Request) {
  try { return authResponse(await resetPassword(await readAuthJson(request))); }
  catch (error) { return authFailure(error); }
}
