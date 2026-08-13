export async function GET() {
  return Response.json({ status: "ok", service: "social-data-workbench", runtime: "edgeone-nextjs" });
}
