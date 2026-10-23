import { z } from "zod";
import { authFailure, authResponse, AuthError, readAuthJson } from "@backend/lib/auth-http";
import { guestPhotoAccess } from "@backend/lib/photos";
import { getZip, queueZip } from "@backend/lib/zips";
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try { return authResponse({ job: await getZip(await guestPhotoAccess((await params).slug)) }); }
  catch (error) { return authFailure(error); }
}
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    if (!z.object({}).strict().safeParse(await readAuthJson(request)).success) throw new AuthError(400, "Некорректный запрос архива.");
    const job = await queueZip(await guestPhotoAccess((await params).slug));
    return authResponse({ job }, job.status === "DONE" ? 200 : 202);
  } catch (error) { return authFailure(error); }
}
