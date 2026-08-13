export async function GET() {
  return Response.json({ platforms: [{ id: "xhs", name: "小红书", enabled: true, modes: ["profile", "links"], source: "authorized-browser" }] });
}
