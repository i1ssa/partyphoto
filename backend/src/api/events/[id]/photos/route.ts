import { authFailure, authResponse, assertAuthOrigin } from "@backend/lib/auth-http";
import { staffPhotoAccess, listPhotos, uploadPhoto } from "@backend/lib/photos";
import { ensureVisitor } from "@backend/lib/visitor";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const query = new URL(request.url).searchParams;
    return await ensureVisitor(authResponse(await listPhotos(await staffPhotoAccess((await params).id), query.get("cursor") ?? undefined, query.get("sort") ?? undefined)));
  }
  catch (error) { return authFailure(error); }
}
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { assertAuthOrigin(request); return authResponse({ photo: await uploadPhoto(request, await staffPhotoAccess((await params).id)) }, 201); }
  catch (error) { return authFailure(error); }
}
