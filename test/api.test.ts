import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import type { Server } from "node:http";
import { after, before, test } from "node:test";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

if (!process.env.TEST_DATABASE_URL)
  throw new Error("Set TEST_DATABASE_URL to run integration tests");
const schema = `test_${randomUUID().replaceAll("-", "")}`;
const databaseUrl = new URL(process.env.TEST_DATABASE_URL);
databaseUrl.searchParams.set("schema", schema);
process.env.DATABASE_URL = databaseUrl.href;
process.env.JWT_SECRET = randomUUID() + randomUUID();

const { default: prisma } = await import("../prisma/client.ts");
const { default: app } = await import("../src/app.ts");
let server: Server;
let baseUrl: string;

before(async () => {
  execFileSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    {
      env: process.env,
      stdio: "pipe",
    },
  );
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (server)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await prisma.$disconnect();
});

async function request(
  path: string,
  method = "GET",
  body?: unknown,
  token?: string,
) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
    text,
  };
}

function userData() {
  const username = `user_${randomUUID().slice(0, 8)}`;
  return {
    username,
    email: `${username}@example.com`,
    password: "test-password",
    name: "Олена",
  };
}

async function registerUser() {
  const input = userData();
  const response = await request("/auth/register", "POST", input);
  assert.equal(response.status, 201);
  return { input, ...response.body };
}

test("реєстрація зберігає хеш і видає токени з потрібним терміном дії", async () => {
  const account = await registerUser();
  assert.deepEqual(Object.keys(account.user).sort(), [
    "email",
    "id",
    "name",
    "username",
  ]);
  const stored = await prisma.user.findUniqueOrThrow({
    where: { id: account.user.id },
  });
  assert.notEqual(stored.password, account.input.password);
  assert.equal(
    await bcrypt.compare(account.input.password, stored.password),
    true,
  );
  const token = await prisma.refreshToken.findUniqueOrThrow({
    where: { userId: stored.id },
  });
  assert.equal(token.token, account.refreshToken);
  for (const [value, ttl] of [
    [account.accessToken, 900],
    [account.refreshToken, 604800],
  ] as const) {
    const payload = jwt.verify(
      value,
      process.env.JWT_SECRET!,
    ) as jwt.JwtPayload;
    assert.equal(payload.sub, stored.id);
    assert.equal(payload.exp! - payload.iat!, ttl);
  }
  const profile = await request(
    "/auth/me",
    "GET",
    undefined,
    account.accessToken,
  );
  assert.equal(profile.status, 200);
  assert.deepEqual(Object.keys(profile.body).sort(), [
    "createdAt",
    "email",
    "id",
    "name",
    "username",
  ]);
  assert.equal(profile.body.id, account.user.id);
});

test("повторні username та email повертають 409, зокрема при одночасних запитах", async () => {
  const account = await registerUser();
  for (const input of [
    { ...userData(), username: account.input.username },
    { ...userData(), email: account.input.email },
  ]) {
    const response = await request("/auth/register", "POST", input);
    assert.equal(response.status, 409);
    assert.equal(response.body.error, "Username or email already taken");
  }
  const input = userData();
  const responses = await Promise.all([
    request("/auth/register", "POST", input),
    request("/auth/register", "POST", input),
  ]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
});

test("валідація реєстрації перевіряє довжини, email і типи", async () => {
  const input = userData();
  const invalid = [
    {},
    { ...input, username: "ab" },
    { ...input, username: "a".repeat(31) },
    { ...input, email: "invalid" },
    { ...input, password: "12345" },
    { ...input, password: "я".repeat(37) },
    { ...input, name: "О" },
    { ...input, username: 123 },
    { ...input, password: null },
  ];
  for (const body of invalid) {
    const response = await request("/auth/register", "POST", body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.ok(response.body.details);
  }
  const boundary = await request("/auth/register", "POST", {
    ...userData(),
    username: "a".repeat(30),
    password: "123456",
    name: "Юя",
  });
  assert.equal(boundary.status, 201);
});

test("вхід повертає однакову помилку для невідомого користувача і хибного пароля", async () => {
  const account = await registerUser();
  for (const body of [
    { username: "unknown-user", password: "test-password" },
    { username: account.input.username, password: "wrong-password" },
  ]) {
    const response = await request("/auth/login", "POST", body);
    assert.equal(response.status, 401);
    assert.deepEqual(response.body, { error: "Invalid credentials" });
  }
  const login = await request("/auth/login", "POST", account.input);
  assert.equal(login.status, 200);
  assert.equal(login.body.user.password, undefined);
  assert.notEqual(login.body.refreshToken, account.refreshToken);
  assert.equal(
    (
      await request("/auth/refresh", "POST", {
        refreshToken: account.refreshToken,
      })
    ).status,
    401,
  );
  assert.equal(
    await prisma.refreshToken.count({ where: { userId: account.user.id } }),
    1,
  );
});

test("оновлення токенів одноразове і працює без затримки між запитами", async () => {
  const account = await registerUser();
  const first = await request("/auth/refresh", "POST", {
    refreshToken: account.refreshToken,
  });
  assert.equal(first.status, 200);
  assert.notEqual(first.body.refreshToken, account.refreshToken);
  const second = await request("/auth/refresh", "POST", {
    refreshToken: first.body.refreshToken,
  });
  assert.equal(second.status, 200);
  assert.notEqual(second.body.refreshToken, first.body.refreshToken);
  assert.equal(
    (
      await request("/auth/refresh", "POST", {
        refreshToken: account.refreshToken,
      })
    ).status,
    401,
  );
  assert.equal(
    (await request("/auth/me", "GET", undefined, second.body.accessToken))
      .status,
    200,
  );
});

test("два одночасні оновлення одного refresh token мають лише один успішний результат", async () => {
  const account = await registerUser();
  const body = { refreshToken: account.refreshToken };
  const responses = await Promise.all([
    request("/auth/refresh", "POST", body),
    request("/auth/refresh", "POST", body),
  ]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 401]);
  assert.equal(
    await prisma.refreshToken.count({ where: { userId: account.user.id } }),
    1,
  );
});

test("захищені маршрути відхиляють відсутні, підроблені, прострочені та refresh токени", async () => {
  const account = await registerUser();
  const expired = jwt.sign(
    { sub: account.user.id, type: "access" },
    process.env.JWT_SECRET!,
    { expiresIn: -1 },
  );
  const forged = jwt.sign(
    { sub: account.user.id, type: "access" },
    "wrong-secret",
    { expiresIn: 60 },
  );
  const withoutExpiry = jwt.sign(
    { sub: account.user.id, type: "access" },
    process.env.JWT_SECRET!,
  );
  for (const token of [
    undefined,
    "invalid",
    expired,
    forged,
    withoutExpiry,
    account.refreshToken,
  ]) {
    assert.equal(
      (await request("/auth/me", "GET", undefined, token)).status,
      401,
    );
    assert.equal(
      (await request("/auth/logout", "POST", undefined, token)).status,
      401,
    );
  }
  for (const refreshToken of [
    "invalid",
    account.accessToken,
    jwt.sign(
      { sub: account.user.id, type: "refresh" },
      process.env.JWT_SECRET!,
      { expiresIn: -1 },
    ),
    jwt.sign({ sub: account.user.id, type: "refresh" }, "wrong-secret", {
      expiresIn: 60,
    }),
  ]) {
    assert.equal(
      (await request("/auth/refresh", "POST", { refreshToken })).status,
      401,
    );
  }
  assert.equal((await request("/auth/refresh", "POST", {})).status, 400);
});

test("вихід видаляє refresh token і повторно повертає порожню відповідь 204", async () => {
  const account = await registerUser();
  for (let i = 0; i < 2; i++) {
    const response = await request(
      "/auth/logout",
      "POST",
      undefined,
      account.accessToken,
    );
    assert.equal(response.status, 204);
    assert.equal(response.text, "");
  }
  assert.equal(
    await prisma.refreshToken.count({ where: { userId: account.user.id } }),
    0,
  );
  assert.equal(
    (
      await request("/auth/refresh", "POST", {
        refreshToken: account.refreshToken,
      })
    ).status,
    401,
  );
});

test("невідомий маршрут і пошкоджений JSON повертають JSON-помилки", async () => {
  assert.deepEqual(await request("/missing"), {
    status: 404,
    body: { error: "Not found" },
    text: '{"error":"Not found"}',
  });
  const response = await fetch(baseUrl + "/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{",
  });
  assert.equal(response.status, 400);
  const body = (await response.json()) as { error: string };
  assert.equal(body.error, "Validation failed");
});
