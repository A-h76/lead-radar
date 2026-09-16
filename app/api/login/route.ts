import { NextRequest, NextResponse } from "next/server";
import { signSessionToken } from "@/lib/auth";
import { clientKey, rateLimit } from "@/lib/rateLimit";

export async function POST(request: NextRequest) {
  // Blunt brute-forcing the single shared password: 10 attempts / 15 min per IP.
  const limit = rateLimit(`login:${clientKey(request)}`, 10, 15 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again in a few minutes." },
      { status: 429 }
    );
  }

  const { password } = await request.json();
  const appPassword = process.env.APP_PASSWORD;

  if (!appPassword || password !== appPassword) {
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  const res = NextResponse.json({ success: true });
  res.cookies.set("lr_auth", signSessionToken(appPassword), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return res;
}
