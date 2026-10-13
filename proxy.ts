import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  if (!request.cookies.get("regals_session")?.value) {
    if (request.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ error: "Login required" }, { status: 401 });
    const login = new URL("/login", request.url);
    login.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}
export const config = { matcher: ["/((?!login(?:/|$)|api/auth(?:/|$)|_next/|favicon.ico|.*\\.(?:svg|png|jpg|ico)$).*)"] };
