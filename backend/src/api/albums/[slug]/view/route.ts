import { authFailure, authResponse, readAuthJson } from "@backend/lib/auth-http";
import { recordAlbumView } from "@backend/lib/views";


export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try { return authResponse(await recordAlbumView((await params).slug, await readAuthJson(request))); }
  catch (error) { return authFailure(error); }
}
