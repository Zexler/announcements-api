import {
  OpenApiGeneratorV3,
  OpenAPIRegistry,
} from "@asteasolutions/zod-to-openapi";
import { z } from "./zod.ts";
import {
  registerSchema,
  loginSchema,
  refreshSchema,
} from "./validators/auth.validator.ts";
import {
  createAnnouncementSchema,
  updateAnnouncementSchema,
  announcementParamsSchema,
  announcementQuerySchema,
} from "./validators/announcements.validator.ts";

export const registry = new OpenAPIRegistry();
registry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
});
const security = [{ bearerAuth: [] }];

const user = registry.register(
  "User",
  z.object({
    id: z.number().int().positive(),
    username: z.string(),
    email: z.email(),
    name: z.string(),
  }),
);
const tokens = registry.register(
  "Tokens",
  z.object({ accessToken: z.string(), refreshToken: z.string() }),
);
const session = registry.register("Session", tokens.extend({ user }));
const profile = registry.register(
  "Profile",
  user.extend({ createdAt: z.iso.datetime() }),
);
const announcement = registry.register(
  "Announcement",
  createAnnouncementSchema.extend({
    id: z.number().int().positive(),
    userId: z.number().int().positive(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    user,
  }),
);
const error = registry.register("Error", z.object({ error: z.string() }));
const validationError = registry.register(
  "ValidationError",
  error.extend({
    details: z.object({
      formErrors: z.array(z.string()),
      fieldErrors: z.record(z.string(), z.array(z.string())),
    }),
  }),
);

function json(description: string, schema: z.ZodType) {
  return { description, content: { "application/json": { schema } } };
}
const badRequest = json("Помилка валідації", validationError);
const tooManyRequests = json(
  "Перевищено ліміт 10 auth-запитів за 15 хвилин",
  error,
);
const unauthorized = json(
  "Відсутній, прострочений або невалідний токен",
  error,
);
const forbidden = json("Оголошення належить іншому користувачу", error);
const notFound = json("Оголошення не знайдено", error);
const params = announcementParamsSchema.extend({
  id: announcementParamsSchema.shape.id.openapi({
    type: "integer",
    minimum: 1,
    maximum: 2147483647,
  }),
});
const query = announcementQuerySchema.extend({
  page: announcementQuerySchema.shape.page.openapi({
    type: "integer",
    minimum: 1,
    maximum: 2147483647,
    default: 1,
  }),
});

registry.registerPath({
  method: "post",
  path: "/auth/register",
  tags: ["Автентифікація"],
  summary: "Реєстрація",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: registerSchema } },
    },
  },
  responses: {
    201: json("Користувача створено", session),
    429: tooManyRequests,
    400: badRequest,
    409: json("Username або email уже зайняті", error),
  },
});
registry.registerPath({
  method: "post",
  path: "/auth/login",
  tags: ["Автентифікація"],
  summary: "Вхід",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: loginSchema } },
    },
  },
  responses: {
    200: json("Вхід виконано", session),
    429: tooManyRequests,
    400: badRequest,
    401: json("Невірний username або пароль", error),
  },
});
registry.registerPath({
  method: "post",
  path: "/auth/refresh",
  tags: ["Автентифікація"],
  summary: "Оновлення токенів",
  description:
    "Повертає нову пару токенів. Попередній refresh token більше не діє.",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: refreshSchema } },
    },
  },
  responses: {
    200: json("Токени оновлено", tokens),
    429: tooManyRequests,
    400: badRequest,
    401: unauthorized,
  },
});
registry.registerPath({
  method: "post",
  path: "/auth/logout",
  tags: ["Автентифікація"],
  summary: "Вихід",
  security,
  description:
    "Видаляє refresh token. Access token залишається чинним до завершення його терміну дії.",
  responses: {
    204: { description: "Вихід виконано" },
    401: unauthorized,
    429: tooManyRequests,
  },
});
registry.registerPath({
  method: "get",
  path: "/auth/me",
  tags: ["Автентифікація"],
  summary: "Поточний користувач",
  security,
  responses: {
    200: json("Профіль користувача", profile),
    401: unauthorized,
    429: tooManyRequests,
  },
});
registry.registerPath({
  method: "get",
  path: "/announcements",
  tags: ["Оголошення"],
  summary: "Список оголошень",
  description:
    "Пошук підрядка у назві без урахування регістру. По 10 записів на сторінку.",
  request: { query },
  responses: {
    200: json(
      "Список і пагінація",
      z.object({
        data: z.array(announcement),
        pagination: z.object({
          total: z.number().int().nonnegative(),
          page: z.number().int().positive(),
          totalPages: z.number().int().nonnegative(),
          perPage: z.literal(10),
        }),
      }),
    ),
    400: badRequest,
  },
});
registry.registerPath({
  method: "get",
  path: "/announcements/{id}",
  tags: ["Оголошення"],
  summary: "Перегляд оголошення",
  request: { params },
  responses: {
    200: json("Оголошення з автором", announcement),
    400: badRequest,
    404: notFound,
  },
});
registry.registerPath({
  method: "post",
  path: "/announcements",
  tags: ["Оголошення"],
  summary: "Створення оголошення",
  security,
  description: "Автор визначається за access token.",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createAnnouncementSchema } },
    },
  },
  responses: {
    201: json("Оголошення створено", announcement),
    400: badRequest,
    401: unauthorized,
  },
});
registry.registerPath({
  method: "patch",
  path: "/announcements/{id}",
  tags: ["Оголошення"],
  summary: "Оновлення власного оголошення",
  security,
  description:
    "Потрібно передати хоча б одне поле: title, description, price або category.",
  request: {
    params,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: updateAnnouncementSchema.openapi({ minProperties: 1 }),
        },
      },
    },
  },
  responses: {
    200: json("Оголошення оновлено", announcement),
    400: badRequest,
    401: unauthorized,
    403: forbidden,
    404: notFound,
  },
});
registry.registerPath({
  method: "delete",
  path: "/announcements/{id}",
  tags: ["Оголошення"],
  summary: "Видалення власного оголошення",
  security,
  request: { params },
  responses: {
    204: { description: "Оголошення видалено" },
    400: badRequest,
    401: unauthorized,
    403: forbidden,
    404: notFound,
  },
});

export function generateOpenApiDocument() {
  return new OpenApiGeneratorV3(registry.definitions).generateDocument({
    openapi: "3.0.0",
    info: {
      title: "REST API дошки оголошень",
      version: "1.0.0",
      description:
        "Access token діє 15 хвилин, refresh token — 7 днів. Пароль: від 6 символів, не більше 72 байтів UTF-8.",
    },
    servers: [{ url: "/" }],
  });
}
