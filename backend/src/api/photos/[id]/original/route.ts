import { authFailure } from "@backend/lib/auth-http";
import { readPhoto } from "@backend/lib/photos";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { return await readPhoto((await params).id, "original"); }
  catch (error) { return authFailure(error); }
}
