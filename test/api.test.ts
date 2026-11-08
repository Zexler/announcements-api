import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { once } from "node:events";
import type { Server } from "node:http";
import {
  afterAll as after,
  beforeAll as before,
  beforeEach,
  test,
} from "vitest";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

if (!process.env.TEST_DATABASE_URL)
  throw new Error("Set TEST_DATABASE_URL to run integration tests");
const schema = `test_${randomUUID().replaceAll("-", "")}`;
const databaseUrl = new URL(process.env.TEST_DATABASE_URL);
databaseUrl.searchParams.set("schema", schema);
databaseUrl.searchParams.set("application_name", schema);
process.env.DATABASE_URL = databaseUrl.href;
process.env.JWT_SECRET = randomUUID() + randomUUID();
process.env.ALLOWED_ORIGINS = "https://allowed.example";
process.env.LOG_LEVEL = "silent";

const { default: prisma } = await import("../prisma/client.ts");
const { default: app } = await import("../src/app.ts");
const { authLimiter } = await import("../src/middleware/auth-limiter.ts");
beforeEach(() => authLimiter.resetKey("127.0.0.1"));
let server: Server;
let baseUrl: string;

test("Helmet захищає відповіді API та документації", async () => {
  for (const path of ["/announcements", "/api-docs/", "/missing"]) {
    const response = await fetch(baseUrl + path);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-frame-options"), "SAMEORIGIN");
    assert.ok(response.headers.get("content-security-policy"));
    assert.equal(response.headers.get("x-powered-by"), null);
  }
});

test("CORS дозволяє визначені origins і відхиляє сторонні", async () => {
  const allowed = await fetch(baseUrl + "/announcements", {
    headers: { Origin: "https://allowed.example" },
  });
  assert.equal(allowed.status, 200);
  assert.equal(
    allowed.headers.get("access-control-allow-origin"),
    "https://allowed.example",
  );
  const denied = await fetch(baseUrl + "/announcements", {
    headers: { Origin: "https://other.example" },
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("access-control-allow-origin"), null);
  const preflight = await fetch(baseUrl + "/auth/login", {
    method: "OPTIONS",
    headers: {
      Origin: "https://allowed.example",
      "Access-Control-Request-Method": "POST",
    },
  });
  assert.equal(preflight.status, 204);
});

test("auth обмежено десятьма запитами, список залишається доступним", async () => {
  for (let i = 0; i < 10; i++) {
    const response = await fetch(baseUrl + "/auth/me");
    assert.equal(response.status, 401);
  }
  for (const path of ["/auth/me", "/auth/login"]) {
    const response = await fetch(baseUrl + path, {
      method: path.endsWith("login") ? "POST" : "GET",
    });
    assert.equal(response.status, 429);
    assert.deepEqual(await response.json(), {
      error: "Too many requests, please try again later",
    });
    const retryAfter = Number(response.headers.get("retry-after"));
    assert.ok(retryAfter > 0 && retryAfter <= 900);
  }
  assert.equal((await fetch(baseUrl + "/announcements")).status, 200);
});

test("логер приховує токен та cookies", () => {
  const child = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--eval",
      `
    const {default: logger} = await import('./src/logger.ts');
    logger.info({req:{headers:{authorization:'secret-token',cookie:'secret-cookie'}},res:{headers:{'set-cookie':'secret-session'}}}, 'test');
  `,
    ],
    { env: { ...process.env, LOG_LEVEL: "info" }, encoding: "utf8" },
  );
  assert.equal(child.status, 0);
  assert.doesNotMatch(
    child.stdout,
    /secret-token|secret-cookie|secret-session/,
  );
  assert.match(child.stdout, /Redacted/);
});

test("без власного JWT_SECRET застосунок не запускається", () => {
  assert.match(readFileSync(".env.example", "utf8"), /^JWT_SECRET=\s*$/m);
  const child = spawnSync(
    process.execPath,
    ["--import", "tsx", "--eval", "import('./src/tokens.ts')"],
    {
      env: { ...process.env, JWT_SECRET: "" },
      encoding: "utf8",
    },
  );
  assert.equal(child.status, 1);
  assert.match(child.stderr, /JWT_SECRET must contain at least 32 characters/);
});

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
  // Ліміт перевіряється окремим тестом через прямі HTTP-запити.
  if (path.startsWith("/auth/")) authLimiter.resetKey("127.0.0.1");
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

test("одночасний вихід відкликає токен, який саме оновлюється", async () => {
  const account = await registerUser();
  const requests: ReturnType<typeof request>[] = [];
  await prisma.$executeRawUnsafe(
    `CREATE FUNCTION "${schema}".wait_for_rotation() RETURNS trigger AS $$ BEGIN PERFORM pg_advisory_xact_lock(${process.pid}); RETURN NEW; END; $$ LANGUAGE plpgsql`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE TRIGGER wait_for_rotation BEFORE INSERT OR UPDATE ON "${schema}"."RefreshToken" FOR EACH ROW EXECUTE FUNCTION "${schema}".wait_for_rotation()`,
  );
  async function waitForLock(event: string) {
    for (let attempt = 0; attempt < 150; attempt++) {
      const rows = await prisma.$queryRaw<
        Array<{ pid: number }>
      >`SELECT pid FROM pg_stat_activity WHERE application_name = ${schema} AND wait_event = ${event}`;
      if (rows.length) return;
      await delay(20);
    }
    throw new Error(`Timed out waiting for ${event}`);
  }
  try {
    // Блокування фіксує порядок запитів без залежності від швидкості сервера.
    await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT true AS locked FROM pg_advisory_xact_lock(${process.pid})`;
        requests.push(
          request("/auth/refresh", "POST", {
            refreshToken: account.refreshToken,
          }),
        );
        await waitForLock("advisory");
        requests.push(
          request("/auth/logout", "POST", undefined, account.accessToken),
        );
        await waitForLock("transactionid");
      },
      { timeout: 10000 },
    );
    const [rotated, logout] = await Promise.all(requests);
    assert.equal(rotated.status, 200);
    assert.equal(logout.status, 204);
    assert.equal(
      await prisma.refreshToken.count({ where: { userId: account.user.id } }),
      0,
    );
    assert.equal(
      (
        await request("/auth/refresh", "POST", {
          refreshToken: rotated.body.refreshToken,
        })
      ).status,
      401,
    );
  } finally {
    await Promise.allSettled(requests);
    await prisma.$executeRawUnsafe(
      `DROP TRIGGER wait_for_rotation ON "${schema}"."RefreshToken"`,
    );
    await prisma.$executeRawUnsafe(
      `DROP FUNCTION "${schema}".wait_for_rotation()`,
    );
  }
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

function announcementData() {
  return {
    title: "Продам велосипед",
    description: "Гірський велосипед у доброму стані",
    price: 8000,
    category: "sale",
  };
}

test("текстові поля з нульовим символом повертають 400", async () => {
  const input = userData();
  for (const body of [
    { ...input, username: "user\u0000name" },
    { ...input, name: "Олена\u0000" },
  ]) {
    assert.equal((await request("/auth/register", "POST", body)).status, 400);
  }
  assert.equal(
    (
      await request("/auth/login", "POST", {
        username: "user\u0000name",
        password: input.password,
      })
    ).status,
    400,
  );
  const owner = await registerUser();
  const created = await request(
    "/announcements",
    "POST",
    announcementData(),
    owner.accessToken,
  );
  for (const body of [
    { title: "Назва\u0000" },
    { description: "Опис оголошення\u0000" },
  ]) {
    assert.equal(
      (
        await request(
          "/announcements",
          "POST",
          { ...announcementData(), ...body },
          owner.accessToken,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await request(
          `/announcements/${created.body.id}`,
          "PATCH",
          body,
          owner.accessToken,
        )
      ).status,
      400,
    );
  }
  assert.equal((await request("/announcements?search=%00")).status, 400);
});

test("створення бере автора з токена, а публічний перегляд не розкриває пароль", async () => {
  const owner = await registerUser();
  const other = await registerUser();
  const input = { ...announcementData(), userId: other.user.id };
  assert.equal((await request("/announcements", "POST", input)).status, 401);
  const created = await request(
    "/announcements",
    "POST",
    input,
    owner.accessToken,
  );
  assert.equal(created.status, 201);
  assert.equal(created.body.user.id, owner.user.id);
  assert.deepEqual(Object.keys(created.body.user).sort(), [
    "email",
    "id",
    "name",
    "username",
  ]);
  const stored = await prisma.announcement.findUniqueOrThrow({
    where: { id: created.body.id },
  });
  assert.equal(stored.userId, owner.user.id);
  const details = await request(`/announcements/${created.body.id}`);
  assert.equal(details.status, 200);
  assert.deepEqual(details.body, created.body);
  assert.equal((await request("/announcements/2147483647")).status, 404);
});

test("створення перевіряє всі поля, категорії та числову ціну", async () => {
  const owner = await registerUser();
  const input = announcementData();
  const invalid = [
    {},
    { ...input, title: "1234" },
    { ...input, title: "a".repeat(51) },
    { ...input, description: "123456789" },
    { ...input, price: 0 },
    { ...input, price: -1 },
    { ...input, price: "100" },
    { ...input, category: "invalid" },
    { ...input, price: null },
  ];
  for (const body of invalid) {
    const response = await request(
      "/announcements",
      "POST",
      body,
      owner.accessToken,
    );
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.ok(response.body.details);
  }
  for (const category of ["sale", "service", "job", "other"]) {
    const response = await request(
      "/announcements",
      "POST",
      {
        title: "a".repeat(50),
        description: "1234567890",
        price: 0.01,
        category,
      },
      owner.accessToken,
    );
    assert.equal(response.status, 201);
  }
});

test("власник частково оновлює оголошення, порожні та сторонні поля не проходять", async () => {
  const owner = await registerUser();
  const created = await request(
    "/announcements",
    "POST",
    announcementData(),
    owner.accessToken,
  );
  const path = `/announcements/${created.body.id}`;
  assert.equal((await request(path, "PATCH", { price: 7000 })).status, 401);
  for (const body of [
    {},
    { userId: owner.user.id },
    { title: "bad" },
    { price: 0 },
  ]) {
    assert.equal(
      (await request(path, "PATCH", body, owner.accessToken)).status,
      400,
    );
  }
  const updated = await request(
    path,
    "PATCH",
    { price: 6500 },
    owner.accessToken,
  );
  assert.equal(updated.status, 200);
  assert.equal(updated.body.price, 6500);
  assert.equal(updated.body.title, created.body.title);
  assert.equal(updated.body.createdAt, created.body.createdAt);
  assert.ok(
    Date.parse(updated.body.updatedAt) > Date.parse(created.body.updatedAt),
  );
  assert.equal(
    (
      await request(
        "/announcements/2147483647",
        "PATCH",
        { price: 10 },
        owner.accessToken,
      )
    ).status,
    404,
  );
});

test("чуже оголошення не можна змінити або видалити", async () => {
  const owner = await registerUser();
  const other = await registerUser();
  const created = await request(
    "/announcements",
    "POST",
    announcementData(),
    owner.accessToken,
  );
  const path = `/announcements/${created.body.id}`;
  for (const method of ["PATCH", "DELETE"]) {
    const response = await request(
      path,
      method,
      method === "PATCH" ? { price: 1 } : undefined,
      other.accessToken,
    );
    assert.equal(response.status, 403);
    assert.deepEqual(response.body, { error: "Access denied" });
  }
  assert.deepEqual((await request(path)).body, created.body);
  assert.equal((await request(path, "DELETE")).status, 401);
  const deleted = await request(path, "DELETE", undefined, owner.accessToken);
  assert.equal(deleted.status, 204);
  assert.equal(deleted.text, "");
  assert.equal((await request(path)).status, 404);
  assert.equal(
    (await request(path, "DELETE", undefined, owner.accessToken)).status,
    404,
  );
});

test("список має пагінацію, пошук без урахування регістру та стабільне сортування", async () => {
  const owner = await registerUser();
  const prefix = `Пошук-${randomUUID().slice(0, 8)}`;
  await prisma.announcement.createMany({
    data: Array.from({ length: 23 }, (_, i) => ({
      ...announcementData(),
      userId: owner.user.id,
      title: `${prefix} ${i}`,
      createdAt: new Date(Date.UTC(2025, 0, 1, 0, 0, i)),
    })),
  });
  const search = encodeURIComponent(prefix.toUpperCase());
  const first = await request(`/announcements?search=${search}`);
  assert.equal(first.status, 200);
  assert.equal(first.body.data.length, 10);
  assert.deepEqual(first.body.pagination, {
    total: 23,
    page: 1,
    totalPages: 3,
    perPage: 10,
  });
  assert.equal(first.body.data[0].title, `${prefix} 22`);
  assert.equal(first.body.data[0].user.password, undefined);
  const second = await request(`/announcements?search=${search}&page=2`);
  assert.equal(second.body.data.length, 10);
  assert.equal(second.body.data[0].title, `${prefix} 12`);
  const third = await request(`/announcements?search=${search}&page=3`);
  assert.equal(third.body.data.length, 3);
  const oldest = await request(`/announcements?search=${search}&sort=oldest`);
  assert.equal(oldest.body.data[0].title, `${prefix} 0`);
  const outside = await request(`/announcements?search=${search}&page=4`);
  assert.equal(outside.body.data.length, 0);
  assert.equal(outside.body.pagination.total, 23);
  const all = await request("/announcements");
  const emptySearch = await request("/announcements?search=");
  assert.deepEqual(emptySearch.body, all.body);
  assert.equal(all.body.pagination.total, await prisma.announcement.count());
  const missing = await request(
    "/announcements?search=not-found-" + randomUUID(),
  );
  assert.deepEqual(missing.body.pagination, {
    total: 0,
    page: 1,
    totalPages: 0,
    perPage: 10,
  });
});

test("пошук сприймає символи LIKE як звичайний текст", async () => {
  const owner = await registerUser();
  for (const title of ["Знижка 50%_сьогодні", "Знижка 50abcсьогодні"]) {
    await request(
      "/announcements",
      "POST",
      { ...announcementData(), title },
      owner.accessToken,
    );
  }
  const result = await request(
    "/announcements?search=" + encodeURIComponent("50%_"),
  );
  assert.equal(result.status, 200);
  assert.equal(result.body.pagination.total, 1);
  assert.equal(result.body.data[0].title, "Знижка 50%_сьогодні");
});

test("невалідні ID та параметри списку повертають 400", async () => {
  for (const id of ["abc", "0", "-1", "1.5", "2147483648", "1e2"]) {
    const response = await request(`/announcements/${id}`);
    assert.equal(response.status, 400, id);
    assert.ok(response.body.details);
  }
  for (const query of [
    "page=0",
    "page=-1",
    "page=1.5",
    "page=1e2",
    "page=999999999999999999999",
    "page=",
    "page=1&page=2",
    "sort=unknown",
    "search=a&search=b",
  ]) {
    const response = await request(`/announcements?${query}`);
    assert.equal(response.status, 400, query);
    assert.ok(response.body.details);
  }
});

test("OpenAPI описує всі маршрути, тіло запитів і захист", async () => {
  const response = await request("/openapi.json");
  assert.equal(response.status, 200);
  const document = response.body;
  assert.equal(document.openapi, "3.0.0");
  assert.equal(document.components.securitySchemes.bearerAuth.scheme, "bearer");
  const protectedRoutes = [
    ["/auth/logout", "post"],
    ["/auth/me", "get"],
    ["/announcements", "post"],
    ["/announcements/{id}", "patch"],
    ["/announcements/{id}", "delete"],
  ];
  const publicRoutes = [
    ["/auth/register", "post"],
    ["/auth/login", "post"],
    ["/auth/refresh", "post"],
    ["/announcements", "get"],
    ["/announcements/{id}", "get"],
  ];
  for (const [path, method] of protectedRoutes) {
    assert.deepEqual(document.paths[path][method].security, [
      { bearerAuth: [] },
    ]);
    assert.ok(document.paths[path][method].responses[401]);
  }
  for (const [path, method] of publicRoutes) {
    assert.ok(document.paths[path][method]);
    assert.equal(document.paths[path][method].security, undefined);
  }
  for (const path of [
    "/auth/register",
    "/auth/login",
    "/auth/refresh",
    "/announcements",
  ]) {
    assert.equal(document.paths[path].post.requestBody.required, true);
  }
  assert.equal(document.components.schemas.User.properties.password, undefined);
  assert.equal(
    document.paths["/auth/logout"].post.responses[204].content,
    undefined,
  );
  const page = document.paths["/announcements"].get.parameters.find(
    (parameter: { name: string }) => parameter.name === "page",
  );
  assert.equal(page.schema.type, "integer");
  assert.equal(page.schema.default, 1);
  assert.equal(
    document.paths["/announcements/{id}"].patch.requestBody.content[
      "application/json"
    ].schema.minProperties,
    1,
  );
  const ui = await fetch(baseUrl + "/api-docs/");
  assert.equal(ui.status, 200);
  assert.match(await ui.text(), /swagger-ui/);
});
