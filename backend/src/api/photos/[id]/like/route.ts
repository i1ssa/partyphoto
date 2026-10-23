import { authFailure, authResponse, readAuthJson } from "@backend/lib/auth-http";
import { setPhotoLike } from "@backend/lib/likes";
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { return authResponse(await setPhotoLike((await params).id, await readAuthJson(request))); }
  catch (error) { return authFailure(error); }
}
