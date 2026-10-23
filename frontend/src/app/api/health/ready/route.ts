// Next.js route registration; implementation lives in backend.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export { GET } from "@backend/api/health/ready/route";
