# REST API дошки оголошень

JSON API дошки оголошень на Express, TypeScript і PostgreSQL з JWT-автентифікацією.

Початкові залежності та конфігурація взяті з [бойлерплейта курсу](https://github.com/BetterED-Neoversity/Boilerplate-REST-API-Nodejs).

Потрібні Node.js 24 та PostgreSQL 16 або новіший. Для пошуку кирилицею використовуйте базу з Unicode-локаллю, наприклад ICU `und`, а не `C`.

Скопіюйте `.env.example` у `.env`, вкажіть підключення до PostgreSQL та випадковий `JWT_SECRET` довжиною щонайменше 32 символи. Приклад створення бази в PostgreSQL із підтримкою ICU:

```sql
CREATE DATABASE announcements TEMPLATE template0 ENCODING 'UTF8'
  LOCALE_PROVIDER icu ICU_LOCALE 'und';
```

Після створення бази виконайте:

```sh
npm ci
npm run prisma:generate
npm run prisma:deploy
npm start
```

Сервер працює на порту `3000`. Змінити його можна через `PORT`.

Документація з можливістю виконувати запити: [Swagger UI](http://localhost:3000/api-docs). Специфікація OpenAPI доступна на `/openapi.json`.

## Автентифікація

| Метод | Маршрут          | Призначення                                         |
| ----- | ---------------- | --------------------------------------------------- |
| POST  | `/auth/register` | Реєстрація: `username`, `email`, `password`, `name` |
| POST  | `/auth/login`    | Вхід: `username`, `password`                        |
| POST  | `/auth/refresh`  | Оновлення пари токенів: `refreshToken`              |
| POST  | `/auth/logout`   | Вихід, потрібен access token                        |
| GET   | `/auth/me`       | Профіль, потрібен access token                      |

Передавайте access token у заголовку `Authorization: Bearer <token>`. Він діє 15 хвилин, refresh token — 7 днів. Повторний вхід замінює попередній refresh token. Після оновлення старий refresh token більше не діє. Вихід видаляє refresh token; виданий access token залишається чинним до закінчення своїх 15 хвилин.

`username` має містити 3–30 символів, `name` — від 2, пароль — від 6 символів і не більше 72 байтів UTF-8 через обмеження bcrypt. `email` має бути валідною адресою. Username та email унікальні.

```sh
curl -X POST http://localhost:3000/auth/register -H "Content-Type: application/json" -d '{"username":"olena","email":"olena@example.com","password":"test-password","name":"Олена"}'
```

Для роботи із захищеними маршрутами у Swagger UI натисніть **Authorize** та вставте отриманий `accessToken`.

## Оголошення

| Метод  | Маршрут              | Призначення                            |
| ------ | -------------------- | -------------------------------------- |
| GET    | `/announcements`     | Публічний список                       |
| GET    | `/announcements/:id` | Публічний перегляд оголошення          |
| POST   | `/announcements`     | Створення, потрібен access token       |
| PATCH  | `/announcements/:id` | Часткове оновлення власного оголошення |
| DELETE | `/announcements/:id` | Видалення власного оголошення          |

Список приймає `search` (підрядок у назві без урахування регістру), `sort=newest|oldest` і `page` (додатне ціле число). За замовчуванням показує першу сторінку та новіші записи першими. На сторінці 10 записів. Відповідь містить `data` та `pagination` з `total`, `page`, `totalPages`, `perPage`.

Для створення передайте `title` (5–50 символів), `description` (від 10 символів), `price` (число більше нуля) та `category` (`sale`, `service`, `job`, `other`). Автор визначається за токеном. PATCH приймає хоча б одне з цих полів. Спроба змінити або видалити чуже оголошення повертає `403`, відсутнє оголошення — `404`.

```sh
curl "http://localhost:3000/announcements?search=велосипед&sort=oldest&page=1"
```

```sh
curl -X POST http://localhost:3000/announcements -H "Authorization: Bearer <accessToken>" -H "Content-Type: application/json" -d '{"title":"Продам велосипед","description":"Гірський велосипед у доброму стані","price":8000,"category":"sale"}'
```

## Розробка та перевірка

```sh
npm run dev
npm run typecheck
npm test
```

Для тестів створіть окрему базу `announcements_test` та вкажіть `TEST_DATABASE_URL`. Тести застосовують міграції у власній тимчасовій схемі й видаляють її після завершення. Користувач бази повинен мати право створювати схеми.

Після зміни Prisma schema створіть міграцію командою `npm run prisma:migrate -- --name назва`, потім запустіть `npm run prisma:generate`.
