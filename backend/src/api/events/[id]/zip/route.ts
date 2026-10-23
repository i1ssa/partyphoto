import { z } from "zod";
import { authFailure, authResponse, AuthError, readAuthJson } from "@backend/lib/auth-http";
import { staffPhotoAccess } from "@backend/lib/photos";
import { getZip, queueZip } from "@backend/lib/zips";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { return authResponse({ job: await getZip(await staffPhotoAccess((await params).id)) }); }
  catch (error) { return authFailure(error); }
}
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!z.object({}).strict().safeParse(await readAuthJson(request)).success) throw new AuthError(400, "Некорректный запрос архива.");
    const job = await queueZip(await staffPhotoAccess((await params).id));
    return authResponse({ job }, job.status === "DONE" ? 200 : 202);
  } catch (error) { return authFailure(error); }
}
