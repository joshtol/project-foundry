export { auth as middleware } from "@/auth";

// Matcher per design §6: protect everything except Auth.js's own callback
// endpoints, the sign-in page, and Next's static asset paths.
export const config = {
  matcher: ["/((?!api/auth|sign-in|_next/static|_next/image|favicon.ico).*)"],
};
