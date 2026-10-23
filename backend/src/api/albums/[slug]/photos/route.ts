import { authFailure, authResponse, assertAuthOrigin } from "@backend/lib/auth-http";
import { guestPhotoAccess, listPhotos, uploadPhoto } from "@backend/lib/photos";
import { ensureVisitor } from "@backend/lib/visitor";
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const query = new URL(request.url).searchParams;
    return await ensureVisitor(authResponse(await listPhotos(await guestPhotoAccess((await params).slug), query.get("cursor") ?? undefined, query.get("sort") ?? undefined)));
  }
  catch (error) { return authFailure(error); }
}
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try { assertAuthOrigin(request); return authResponse({ photo: await uploadPhoto(request, await guestPhotoAccess((await params).slug)) }, 201); }
  catch (error) { return authFailure(error); }
}
