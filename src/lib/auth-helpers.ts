// Action-layer auth helper. `requireUser` resolves the current Auth.js v5
// session to the corresponding User row in our DB, throwing if no session is
// active. The allowlist check happens upstream in Auth.js callbacks (§6);
// here we only assert "signed in" and load the audit-relevant User row.
import { auth } from "@/auth";
import { db } from "@/lib/db";

export async function requireUser() {
  const session = await auth();
  if (!session?.user?.email) {
    throw new Error("Unauthorized");
  }
  return db.user.findUniqueOrThrow({
    where: { email: session.user.email },
  });
}
