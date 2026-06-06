// @vitest-environment node
import { describe, test, expect, vi, beforeEach } from "vitest";
import { SignJWT, jwtVerify } from "jose";
import { NextRequest } from "next/server";

// vi.hoisted ensures these are available when vi.mock factories run
const mockCookieStore = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(() => Promise.resolve(mockCookieStore)),
}));

import { createSession, getSession, deleteSession, verifySession } from "@/lib/auth";

const JWT_SECRET = new TextEncoder().encode("development-secret-key");

async function makeToken(payload: object, expiresInSeconds = 7 * 24 * 60 * 60) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(Math.floor(Date.now() / 1000) + expiresInSeconds)
    .setIssuedAt()
    .sign(JWT_SECRET);
}

async function makeExpiredToken(payload: object) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(Math.floor(Date.now() / 1000) - 1)
    .setIssuedAt()
    .sign(JWT_SECRET);
}

describe("createSession", () => {
  beforeEach(() => vi.clearAllMocks());

  test("sets an httpOnly cookie named auth-token", async () => {
    await createSession("user-1", "a@b.com");

    expect(mockCookieStore.set).toHaveBeenCalledOnce();
    const [name, , options] = mockCookieStore.set.mock.calls[0];
    expect(name).toBe("auth-token");
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe("lax");
  });

  test("token contains userId and email", async () => {
    await createSession("user-1", "a@b.com");

    const [, token] = mockCookieStore.set.mock.calls[0];
    const { payload } = await jwtVerify(token, JWT_SECRET);
    expect(payload.userId).toBe("user-1");
    expect(payload.email).toBe("a@b.com");
  });

  test("cookie expires in approximately 7 days", async () => {
    const before = Date.now();
    await createSession("user-1", "a@b.com");
    const after = Date.now();

    const [, , options] = mockCookieStore.set.mock.calls[0];
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    expect(options.expires.getTime()).toBeGreaterThanOrEqual(before + sevenDays - 1000);
    expect(options.expires.getTime()).toBeLessThanOrEqual(after + sevenDays + 1000);
  });
});

describe("getSession", () => {
  beforeEach(() => vi.clearAllMocks());

  test("returns null when no cookie is present", async () => {
    mockCookieStore.get.mockReturnValue(undefined);
    expect(await getSession()).toBeNull();
  });

  test("returns the session payload for a valid token", async () => {
    const token = await makeToken({ userId: "user-1", email: "a@b.com", expiresAt: new Date() });
    mockCookieStore.get.mockReturnValue({ value: token });

    const session = await getSession();
    expect(session?.userId).toBe("user-1");
    expect(session?.email).toBe("a@b.com");
  });

  test("returns null for a tampered token", async () => {
    mockCookieStore.get.mockReturnValue({ value: "invalid.token.value" });
    expect(await getSession()).toBeNull();
  });

  test("returns null for an expired token", async () => {
    const token = await makeExpiredToken({ userId: "user-1", email: "a@b.com" });
    mockCookieStore.get.mockReturnValue({ value: token });
    expect(await getSession()).toBeNull();
  });
});

describe("deleteSession", () => {
  beforeEach(() => vi.clearAllMocks());

  test("deletes the auth-token cookie", async () => {
    await deleteSession();
    expect(mockCookieStore.delete).toHaveBeenCalledWith("auth-token");
  });
});

describe("verifySession", () => {
  test("returns null when no cookie in request", async () => {
    const req = new NextRequest("http://localhost/api/test");
    expect(await verifySession(req)).toBeNull();
  });

  test("returns session payload for a valid token in request", async () => {
    const token = await makeToken({ userId: "user-2", email: "b@c.com", expiresAt: new Date() });
    const req = new NextRequest("http://localhost/api/test", {
      headers: { cookie: `auth-token=${token}` },
    });

    const session = await verifySession(req);
    expect(session?.userId).toBe("user-2");
    expect(session?.email).toBe("b@c.com");
  });

  test("returns null for an invalid token in request", async () => {
    const req = new NextRequest("http://localhost/api/test", {
      headers: { cookie: "auth-token=bad.token.here" },
    });
    expect(await verifySession(req)).toBeNull();
  });

  test("returns null for an expired token in request", async () => {
    const token = await makeExpiredToken({ userId: "user-2", email: "b@c.com" });
    const req = new NextRequest("http://localhost/api/test", {
      headers: { cookie: `auth-token=${token}` },
    });
    expect(await verifySession(req)).toBeNull();
  });
});
